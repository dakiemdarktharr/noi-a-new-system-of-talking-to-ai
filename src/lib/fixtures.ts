import type { RawHand, Vec3, Frame } from "../types";
import { extractHand } from "./geometry";
// Explicitly synthetic geometry for math regression and the orientation lab.
// Never added to user samples, never presented as webcam/model output.
const points: Vec3[] = [
  [0, 0, 0],
  [-0.025, 0.025, 0],
  [-0.045, 0.045, 0.003],
  [-0.062, 0.06, 0.005],
  [-0.078, 0.075, 0.008],
  [-0.035, 0.065, 0],
  [-0.038, 0.1, 0],
  [-0.04, 0.126, 0],
  [-0.042, 0.15, 0],
  [0, 0.075, 0],
  [0, 0.115, 0],
  [0, 0.145, 0],
  [0, 0.168, 0],
  [0.029, 0.068, 0],
  [0.032, 0.103, 0],
  [0.034, 0.13, 0],
  [0.035, 0.149, 0],
  [0.054, 0.05, 0],
  [0.063, 0.077, 0],
  [0.069, 0.1, 0],
  [0.075, 0.118, 0],
];
export function fixtureHand(
  angle = 0,
  tilt = 0,
  offset: Vec3 = [0, 0, 0],
): RawHand {
  const a = (angle * Math.PI) / 180,
    b = (tilt * Math.PI) / 180;
  const p = points.map(([x, y, z]) => {
    const xx = x * Math.cos(a) - y * Math.sin(a),
      yy = x * Math.sin(a) + y * Math.cos(a);
    return [
      xx + offset[0],
      yy * Math.cos(b) - z * Math.sin(b) + offset[1],
      yy * Math.sin(b) + z * Math.cos(b) + offset[2],
    ] as Vec3;
  });
  return {
    side: "Right",
    score: 1,
    world: p.map(([x, y, z]) => ({ x, y: -y, z: -z })),
    landmarks: p.map(([x, y, z]) => ({
      x: 0.5 + x * 2,
      y: 0.7 - y * 2,
      z: -z * 2,
    })),
  };
}
export function fixtureSequence(
  angle = 0,
  move: "up" | "right" | "still" = "still",
  count = 60,
): Frame[] {
  return Array.from({ length: count }, (_, i) => {
    const d = (i / (count - 1)) * 0.1;
    const raw = fixtureHand(
      angle,
      0,
      move === "up" ? [0, d, 0] : move === "right" ? [d, 0, 0] : [0, 0, 0],
    );
    return { t: i * 50, hands: [extractHand(raw)!] };
  });
}
