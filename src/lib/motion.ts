import type { Frame, Quat, Vec3 } from "../types";
import { encodeClip, HAND_FEATURES } from "./features";
import { handDistance } from "./recognizer";

export const MOTION_STEPS = 16;
export const MOTION_WIDTH = 28;
export interface MotionProfile {
  kind: "static" | "dynamic";
  templates: number[][][];
  minTravel: number;
  tolerance: number;
}

/** Denoise boundary and trajectory checks. The CNN still receives measured
 * landmarks, so fast finger motion and rotation remain in its input. */
function averagedPose(frames: Frame[], center?: Frame): Frame {
  const latest = center ?? frames.at(-1)!;
  const recent = center ? frames : frames.filter(frame => frame.t >= latest.t - 100);
  return {
    ...latest,
    hands: latest.hands.map(hand => {
      const observations = recent.flatMap(frame => frame.hands.filter(other => other.side === hand.side));
      const mean = (rows: number[][]) => rows[0].map((_, i) => rows.reduce((sum, row) => sum + row[i], 0) / rows.length);
      const quaternions = observations.map(other => {
        const dot = other.quaternion.reduce((sum, value, i) => sum + value * hand.quaternion[i], 0);
        return other.quaternion.map(value => dot < 0 ? -value : value);
      });
      const rotation = mean(quaternions);
      const length = Math.hypot(...rotation);
      return {
        ...hand,
        wrist: mean(observations.map(other => other.wrist)) as Vec3,
        shape: mean(observations.map(other => other.shape)),
        curls: mean(observations.map(other => other.curls)),
        radial: mean(observations.map(other => other.radial)) as Vec3,
        forward: mean(observations.map(other => other.forward)) as Vec3,
        quaternion: rotation.map(value => value / length) as Quat,
      };
    }),
  };
}

export function prepareMotion(frames: Frame[], kind?: "static" | "dynamic"): Frame[] {
  if (kind !== "static") return trimMotion(frames);
  let start = 0, best: Frame[] = [];
  for (let end = 0; end < frames.length; end++) {
    if (!frames[end].hands.length || poseDelta(frames[start], frames[end]) > .035) start = end;
    if (end - start + 1 > best.length) best = frames.slice(start, end + 1);
  }
  return trimMotion(best.length >= 8 ? best : frames);
}

/** Camera displacement, hand rotation AND finger articulation drive boundaries. */
export function poseDelta(a: Frame, b: Frame): number {
  let distance = 0;
  for (const side of ["Left", "Right"] as const) {
    const x = a.hands.find(h => h.side === side), y = b.hands.find(h => h.side === side);
    if (!x && !y) continue;
    if (!x || !y) return 1;
    distance = Math.max(distance, handDistance(x, y) + 3 * Math.hypot(x.wrist[0] - y.wrist[0], x.wrist[1] - y.wrist[1]));
  }
  return distance;
}

/** Remove idle lead/tail using the same movement criterion as live decoding. */
export function trimMotion(frames: Frame[]): Frame[] {
  const visible = frames.filter(f => f.hands.length);
  if (visible.length < 8) return frames;
  let anchor = visible[0], first = -1, last = -1;
  visible.forEach((_frame, i) => {
    const pose = averagedPose(visible.slice(Math.max(0, i - 10), i + 1));
    if (poseDelta(anchor, pose) > .035) {
      if (first < 0) first = Math.max(0, i - 2);
      last = i;
      anchor = pose;
    }
  });
  if (first < 0) {
    const middle = visible[Math.floor(visible.length / 2)].t;
    const hold = visible.filter(f => Math.abs(f.t - middle) <= 300);
    return hold.length >= 8 ? hold : visible;
  }
  const start = visible[first].t - 100, end = visible[last].t + 180;
  return frames.filter(f => f.t >= start && f.t <= end);
}

export function motionExtent(frames: Frame[]): number {
  const first = frames.find(f => f.hands.length);
  return first ? Math.max(0, ...frames.filter(f => f.hands.length).map(f => poseDelta(first, f))) : 0;
}

/** Compact ordered templates, independently normalized for clip position. */
export function motionSequence(frames: Frame[]): number[][] {
  // Reduce interior jitter before downsampling, while preserving measured
  // endpoints. Averaging endpoints would shift the origin and final pose.
  const poses = frames.map((frame, i) =>
    i === 0 || i === frames.length - 1 ? frame : averagedPose(frames.slice(i - 1, i + 2), frame));
  const points = encodeClip(poses, Math.max(MOTION_STEPS, Math.min(128, poses.length))).map(row => [0, HAND_FEATURES].flatMap(offset => [
    row[offset], ...row.slice(offset + 72, offset + 74),
    ...row.slice(offset + 64, offset + 70), ...row.slice(offset + 76, offset + 81),
  ]));
  return resamplePath(points).map(row => row.map(value => Math.round(value * 1000) / 1000));
}

export function motionPointDistance(a: number[], b: number[]): number {
  let total = 0, count = 0;
  for (const offset of [0, 14]) {
    if (!a[offset] && !b[offset]) continue;
    count++;
    if (a[offset] !== b[offset]) { total += 1; continue; }
    const rotation = Math.sqrt(a.slice(offset + 3, offset + 9).reduce((sum, value, i) => sum + (value - b[offset + 3 + i]) ** 2, 0) / 6);
    const fingers = Math.sqrt(a.slice(offset + 9, offset + 14).reduce((sum, value, i) => sum + (value - b[offset + 9 + i]) ** 2, 0) / 5);
    total += 3 * Math.hypot(a[offset + 1] - b[offset + 1], a[offset + 2] - b[offset + 2]) + .5 * rotation + .3 * fingers;
  }
  return total / Math.max(1, count);
}

export function motionTravel(sequence: number[][]): number {
  return sequence.slice(1).reduce((sum, row, i) => sum + motionPointDistance(row, sequence[i]), 0);
}

/** Parameterize the verifier by progress along the path. Extra held frames at
 * either end must not consume the few available trajectory points. The CNN
 * retains timestamps and duration separately. Also supports older templates. */
function resamplePath(points: number[][]): number[][] {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++)
    cumulative.push(cumulative[i - 1] + motionPointDistance(points[i], points[i - 1]));
  const total = cumulative.at(-1)!;
  if (total < 1e-8) return Array.from({ length: MOTION_STEPS }, () => points[0].slice());
  let cursor = 1;
  return Array.from({ length: MOTION_STEPS }, (_, i) => {
    const target = total * i / (MOTION_STEPS - 1);
    while (cursor < points.length - 1 && cumulative[cursor] < target) cursor++;
    const fraction = (target - cumulative[cursor - 1]) / Math.max(1e-8, cumulative[cursor] - cumulative[cursor - 1]);
    return points[cursor - 1].map((value, j) => {
      if (j === 0 || j === 14) return fraction < .5 ? value : points[cursor][j];
      return value + fraction * (points[cursor][j] - value);
    });
  });
}

/** Closed DTW endpoints prevent a prefix from matching only part of a template. */
export function motionDistance(a: number[][], b: number[][]): number {
  a = resamplePath(a);
  b = resamplePath(b);
  const n = a.length, m = b.length;
  const costs = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  const lengths = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  costs[0][0] = 0;
  for (let i = 1; i <= n; i++) for (let j = Math.max(1, i - 4); j <= Math.min(m, i + 4); j++) {
    const previous = [[i - 1, j - 1], [i - 1, j], [i, j - 1]].reduce((best, cell) =>
      costs[cell[0]][cell[1]] < costs[best[0]][best[1]] ? cell : best);
    costs[i][j] = motionPointDistance(a[i - 1], b[j - 1]) + costs[previous[0]][previous[1]];
    lengths[i][j] = lengths[previous[0]][previous[1]] + 1;
  }
  return costs[n][m] / Math.max(1, lengths[n][m]) + .4 * motionPointDistance(a[n - 1], b[m - 1]);
}

export function buildMotionProfile(clips: Frame[][], kind?: "static" | "dynamic"): MotionProfile {
  const dynamic = kind ? kind === "dynamic" : clips.filter(frames => motionExtent(frames) >= .12).length >= clips.length / 2;
  const sequences = clips.map(motionSequence);
  const ranked = sequences.map((sequence, index) => ({ index, cost: sequences.reduce((sum, other) => sum + motionDistance(sequence, other), 0) })).sort((a, b) => a.cost - b.cost);
  const templates = ranked.slice(0, 2).map(({ index }) => sequences[index]);
  const distances = sequences.map(sequence => Math.min(...templates.map(template => motionDistance(sequence, template)))).sort((a, b) => a - b);
  const travels = sequences.map(motionTravel).sort((a, b) => a - b);
  return {
    kind: dynamic ? "dynamic" : "static", templates,
    minTravel: dynamic ? travels[Math.floor((travels.length - 1) * .2)] * .6 : 0,
    tolerance: Math.max(.09, Math.min(.3, distances[Math.floor((distances.length - 1) * .9)] * 1.6 + .045)),
  };
}

export function matchesMotion(frames: Frame[], profile: MotionProfile): boolean {
  const sequence = motionSequence(frames);
  const extent = motionExtent(frames);
  if (profile.kind === "static") return extent < .12;
  const templateExtent = Math.min(...profile.templates.map(template =>
    Math.max(...template.map(row => motionPointDistance(row, template[0])))));
  const observedExtent = Math.max(...sequence.map(row => motionPointDistance(row, sequence[0])));
  return observedExtent >= Math.max(.025, templateExtent * .45) && motionTravel(sequence) >= profile.minTravel &&
    profile.templates.some(template => motionDistance(sequence, template) <= profile.tolerance);
}

/** Streaming endpoint detector. A held prefix and a completed word can be
 * visually identical, so static words retain a deliberate hold interval. */
export class SignSegmenter {
  private frames: Frame[] = [];
  private anchor: Frame | null = null;
  private stableSince = 0;
  private consumed = false;
  private attemptedAt = -Infinity;
  private lastObservation: Frame | null = null;
  private visible = false;
  revision = 0;

  reset() {
    this.frames = []; this.anchor = null; this.consumed = false;
    this.stableSince = 0; this.attemptedAt = -Infinity; this.revision++;
    this.lastObservation = null; this.visible = false;
  }

  push(frame: Frame) {
    const previous = this.lastObservation;
    if (previous && (frame.t - previous.t > 250 || frame.t <= previous.t)) this.reset();
    if (!frame.hands.length) {
      if (this.visible) this.revision++;
      this.visible = false;
      if (previous && frame.t - previous.t > 120) this.reset();
      return;
    }
    if (!this.visible && previous && (frame.t - previous.t > 120 || poseDelta(previous, frame) > .12)) this.reset();
    this.visible = true;
    this.lastObservation = frame;
    const last = this.frames.at(-1);
    const pose = averagedPose([...this.frames.slice(-10), frame]);
    if (!this.anchor) { this.anchor = pose; this.stableSince = frame.t; }
    if (poseDelta(this.anchor, pose) > .035) {
      if (this.consumed) { this.frames = last ? [last] : []; this.consumed = false; }
      this.anchor = pose; this.stableSince = frame.t; this.revision++;
    }
    this.frames.push(frame);
    // Bound memory without marking an unrecognized gesture as already emitted.
    this.frames = this.frames.filter(item => item.t >= frame.t - 5000);
  }

  candidate(): Frame[] | null {
    const last = this.frames.at(-1);
    if (!last || !this.visible || this.consumed || this.frames.length < 8 || last.t - this.attemptedAt < 100) return null;
    const dynamic = motionExtent(this.frames) >= .12;
    const settleMs = dynamic ? 180 : 650;
    if (last.t - this.stableSince < settleMs || last.t - this.frames[0].t < 240) return null;
    this.attemptedAt = last.t;
    // If a movement was rejected, a deliberate 650ms hold can start a static
    // word. This also permits positioning a hand before a static sign.
    if (dynamic && last.t - this.stableSince >= 650) {
      this.frames = this.frames.filter(f => f.t >= this.stableSince);
      this.revision++;
    }
    // Preprocessing belongs to the classifier, once, as it does during train.
    return this.frames.slice();
  }

  confirm(revision: number) {
    if (revision === this.revision) this.consumed = true;
  }
}
