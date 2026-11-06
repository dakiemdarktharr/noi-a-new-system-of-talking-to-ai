import type { Frame } from "../types";
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
  visible.forEach((frame, i) => {
    if (poseDelta(anchor, frame) > .035) {
      if (first < 0) first = Math.max(0, i - 2);
      last = i;
      anchor = frame;
    }
  });
  if (first < 0 || motionExtent(visible) < .12) {
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
  return encodeClip(frames, MOTION_STEPS).map(row => [0, HAND_FEATURES].flatMap(offset => [
    row[offset], ...row.slice(offset + 72, offset + 74),
    ...row.slice(offset + 64, offset + 70), ...row.slice(offset + 76, offset + 81),
  ]).map(value => Math.round(value * 1000) / 1000));
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

/** Closed DTW endpoints prevent a prefix from matching only part of a template. */
export function motionDistance(a: number[][], b: number[][]): number {
  const n = a.length, m = b.length;
  const costs = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  costs[0][0] = 0;
  for (let i = 1; i <= n; i++) for (let j = Math.max(1, i - 4); j <= Math.min(m, i + 4); j++) {
    costs[i][j] = motionPointDistance(a[i - 1], b[j - 1]) + Math.min(costs[i - 1][j], costs[i][j - 1], costs[i - 1][j - 1]);
  }
  return costs[n][m] / Math.max(n, m) + .4 * motionPointDistance(a[n - 1], b[m - 1]);
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
  return extent >= .12 && motionTravel(sequence) >= profile.minTravel &&
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
  revision = 0;

  reset() {
    this.frames = []; this.anchor = null; this.consumed = false;
    this.stableSince = 0; this.attemptedAt = -Infinity; this.revision++;
  }

  push(frame: Frame) {
    const last = this.frames.at(-1);
    if (!frame.hands.length || (last && (frame.t - last.t > 250 || frame.t <= last.t))) this.reset();
    if (!frame.hands.length) return;
    if (!this.anchor) { this.anchor = frame; this.stableSince = frame.t; }
    if (poseDelta(this.anchor, frame) > .035) {
      if (this.consumed) { this.frames = last ? [last] : []; this.consumed = false; }
      this.anchor = frame; this.stableSince = frame.t; this.revision++;
    }
    this.frames.push(frame);
    // Never silently turn the tail of a long dynamic sign into a static word.
    if (this.frames.at(-1)!.t - this.frames[0].t > 5000) {
      this.frames = [frame]; this.anchor = frame; this.stableSince = frame.t;
      this.consumed = true; this.revision++;
    }
  }

  candidate(): Frame[] | null {
    const last = this.frames.at(-1);
    if (!last || this.consumed || this.frames.length < 8 || last.t - this.attemptedAt < 100) return null;
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
    return trimMotion(this.frames);
  }

  confirm(revision: number) {
    if (revision === this.revision) this.consumed = true;
  }
}
