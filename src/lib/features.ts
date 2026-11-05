import type { Frame, HandFeature, Side } from "../types";

/** Fixed, versioned input contract for the locally trained temporal network. */
export const FEATURE_VERSION = 1;
export const TIME_STEPS = 32;
export const HAND_FEATURES = 83;
export const FEATURE_COUNT = HAND_FEATURES * 2 + 6;
export const SIDES: Side[] = ["Left", "Right"];
const bound = (n: number, limit = 1) =>
  Number.isFinite(n) ? Math.max(-limit, Math.min(limit, n)) : 0;
const handAt = (frame: Frame, side: Side) =>
  frame.hands.find((h) => h.side === side);

function handVector(
  hand: HandFeature | undefined,
  origin: number[],
  previous: HandFeature | undefined,
  dt: number,
): number[] {
  if (!hand) return Array(HAND_FEATURES).fill(0);
  const wrist = hand.wrist;
  // Shape is rotation-normalized in geometry.ts. Keep the camera-frame 6D
  // basis separately: removing orientation would erase meaningful differences.
  const shape = Array.from({ length: 63 }, (_, i) =>
    bound((hand.shape[i] ?? 0) / 3),
  );
  const basis = [...hand.radial, ...hand.forward].map((v) => bound(v));
  const imageScale = Math.hypot(
    hand.landmarks[5].x - hand.landmarks[17].x,
    hand.landmarks[5].y - hand.landmarks[17].y,
  );
  const velocity =
    previous && dt > 0
      ? [0, 1].map((i) => bound((wrist[i] - previous.wrist[i]) / dt / 4))
      : [0, 0];
  return [
    1,
    ...shape,
    ...basis,
    bound(wrist[0]),
    bound(wrist[1]),
    bound(wrist[0] - origin[0]),
    bound(wrist[1] - origin[1]),
    ...velocity,
    ...Array.from({ length: 5 }, (_, i) => bound(hand.curls[i] ?? 0)),
    bound(hand.spread / 3),
    bound(imageScale * 2),
  ];
}

/** Timestamp-based sampling retains duration, missing-hand masks and hand identity. */
export function encodeClip(input: Frame[], steps = TIME_STEPS): number[][] {
  const frames = input
    .filter((f) => Number.isFinite(f.t))
    .slice()
    .sort((a, b) => a.t - b.t);
  if (!frames.length)
    return Array.from({ length: steps }, () => Array(FEATURE_COUNT).fill(0));
  const start = frames[0].t,
    duration = Math.max(0, frames.at(-1)!.t - start);
  const origins = SIDES.map(
    (side) =>
      frames.map((f) => handAt(f, side)).find(Boolean)?.wrist ?? [0, 0, 0],
  );
  const sampled: Frame[] = [];
  let cursor = 0;
  for (let i = 0; i < steps; i++) {
    const t = start + (duration * i) / Math.max(1, steps - 1);
    while (
      cursor + 1 < frames.length &&
      Math.abs(frames[cursor + 1].t - t) <= Math.abs(frames[cursor].t - t)
    )
      cursor++;
    sampled.push(frames[cursor]);
  }
  return sampled.map((frame, i) => {
    const dt = i ? (frame.t - sampled[i - 1].t) / 1000 : 0;
    const hands = SIDES.map((side, n) =>
      handVector(
        handAt(frame, side),
        origins[n],
        i ? handAt(sampled[i - 1], side) : undefined,
        dt,
      ),
    );
    const left = handAt(frame, "Left"),
      right = handAt(frame, "Right");
    // Both wrists are in the SAME image coordinate frame. MediaPipe's world
    // coordinates are centered independently per hand and cannot give this distance.
    const dx = left && right ? right.wrist[0] - left.wrist[0] : 0;
    const dy = left && right ? right.wrist[1] - left.wrist[1] : 0;
    return [
      ...hands.flat(),
      left && right ? 1 : 0,
      bound(dx),
      bound(dy),
      bound(Math.hypot(dx, dy)),
      bound(duration / 6000),
      i / Math.max(1, steps - 1),
    ];
  });
}

/** Compact statistics for a conservative support-distance rejection heuristic. */
export function describeClip(sequence: number[][]): number[] {
  if (!sequence.length) return Array(FEATURE_COUNT * 3).fill(0);
  const mean = Array.from(
    { length: FEATURE_COUNT },
    (_, j) => sequence.reduce((s, row) => s + row[j], 0) / sequence.length,
  );
  const std = mean.map((m, j) =>
    Math.sqrt(
      sequence.reduce((s, row) => s + (row[j] - m) ** 2, 0) / sequence.length,
    ),
  );
  const movement = mean.map((_, j) => sequence.at(-1)![j] - sequence[0][j]);
  return [...mean, ...std, ...movement];
}

export function featureDistance(a: number[], b: number[]): number {
  return Math.sqrt(
    a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) /
      Math.max(1, a.length),
  );
}

export function clipUsable(frames: Frame[]): boolean {
  if (frames.length < 8 || frames.at(-1)!.t - frames[0].t < 500) return false;
  return (
    frames.filter((f) =>
      f.hands.some((h) => h.shape.length === 63 && h.landmarks.length === 21),
    ).length /
      frames.length >=
    0.65
  );
}
