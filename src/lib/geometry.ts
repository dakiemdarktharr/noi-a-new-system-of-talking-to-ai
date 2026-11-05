import type { Vec3, Quat, RawHand, HandFeature } from "../types";
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const sub = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3) => Math.hypot(...a);
export const unit = (a: Vec3): Vec3 => mul(a, 1 / Math.max(norm(a), 1e-10));
export const clamp = (v: number, a = -1, b = 1) => Math.max(a, Math.min(b, v));
export const degrees = (v: number) => (v * 180) / Math.PI;
export function quaternion(x: Vec3, y: Vec3, z: Vec3): Quat {
  const m00 = x[0],
    m01 = y[0],
    m02 = z[0],
    m10 = x[1],
    m11 = y[1],
    m12 = z[1],
    m20 = x[2],
    m21 = y[2],
    m22 = z[2];
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  const len = Math.hypot(...q);
  return q.map((v) => v / len) as Quat;
}
export function quaternionDistance(a: Quat, b: Quat) {
  return (
    2 * Math.acos(clamp(Math.abs(a.reduce((s, v, i) => s + v * b[i], 0)), 0, 1))
  );
}
export function extractHand(raw: RawHand, aspect = 4 / 3): HandFeature | null {
  if (
    raw.world.length !== 21 ||
    raw.landmarks.length !== 21 ||
    !raw.world.every((p) => [p.x, p.y, p.z].every(Number.isFinite)) ||
    !raw.landmarks.every((p) => [p.x, p.y, p.z].every(Number.isFinite))
  )
    return null;
  // Camera coordinates: +X image-right, +Y up, +Z towards the camera.
  // World positions are centered separately for each hand: never subtract
  // left-world and right-world coordinates to infer metric inter-hand distance.
  const p = raw.world.map((v) => [v.x, -v.y, -v.z] as Vec3);
  const long = sub(p[9], p[0]),
    across = sub(p[5], p[17]);
  const scale = norm(across);
  if (
    scale < 0.005 ||
    norm(long) < 0.01 ||
    norm(cross(unit(across), unit(long))) < 0.15
  )
    return null;
  const forward = unit(long);
  const radial = unit(sub(across, mul(forward, dot(across, forward))));
  // Geometric right-handed basis. Side remains an explicit feature; left/right
  // are not silently mirrored or merged. Raw handedness is NOT presence confidence.
  const normal = unit(cross(radial, forward));
  const q = quaternion(radial, forward, normal);
  const shape = p.flatMap((point) => {
    const local = mul(sub(point, p[0]), 1 / scale);
    return [dot(local, radial), dot(local, forward), dot(local, normal)];
  });
  const joint = (a: number, b: number, c: number) =>
    degrees(
      Math.acos(clamp(dot(unit(sub(p[a], p[b])), unit(sub(p[c], p[b]))))),
    );
  const curls = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
  ].map(([a, b, c, d]) =>
    clamp((360 - joint(a, b, c) - joint(b, c, d)) / 220, 0, 1),
  );
  const w = raw.landmarks[0];
  return {
    ...raw,
    quaternion: q,
    forward,
    radial,
    normal,
    shape,
    curls,
    spread: norm(sub(p[8], p[20])) / scale,
    wrist: [(w.x - 0.5) * aspect, 0.5 - w.y, 0],
    roll: degrees(Math.atan2(forward[0], forward[1])),
    elevation: degrees(Math.asin(clamp(forward[2]))),
  };
}
export function direction(hand: HandFeature, mirrored = false) {
  const x = hand.forward[0] * (mirrored ? -1 : 1),
    y = hand.forward[1];
  if (Math.hypot(x, y) < 0.35) return "Hướng gần trục camera";
  const angle = (degrees(Math.atan2(y, x)) + 360) % 360;
  return [
    "Sang phải",
    "Chéo phải lên",
    "Hướng lên",
    "Chéo trái lên",
    "Sang trái",
    "Chéo trái xuống",
    "Hướng xuống",
    "Chéo phải xuống",
  ][Math.round(angle / 45) % 8];
}
export const CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];
