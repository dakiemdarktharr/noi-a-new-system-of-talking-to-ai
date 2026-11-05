import type { Frame, HandFeature, Sample, Recognition } from "../types";
import { quaternionDistance, norm, sub } from "./geometry";
const rms = (a: number[], b: number[]) =>
  Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length);
export function handDistance(a: HandFeature, b: HandFeature) {
  // Do not remove orientation: rigid rotation leaves shape unchanged but must
  // still affect the match. 90° contributes 0.35 before trajectory terms.
  return (
    0.35 * Math.min(rms(a.shape, b.shape), 2) +
    (0.7 * quaternionDistance(a.quaternion, b.quaternion)) / Math.PI +
    0.18 * rms(a.curls, b.curls)
  );
}
function normalized(frames: Frame[]) {
  // One shared origin preserves the relative positions of the two hands.
  const origin = frames.find((f) => f.hands.length)?.hands[0].wrist || [
    0, 0, 0,
  ];
  return frames.map((frame) => ({
    ...frame,
    hands: frame.hands.map((h) => {
      return { ...h, wrist: sub(h.wrist, origin as HandFeature["wrist"]) };
    }),
  }));
}
function frameDistance(a: Frame, b: Frame) {
  let total = 0,
    count = 0;
  for (const side of ["Left", "Right"] as const) {
    const x = a.hands.find((h) => h.side === side),
      y = b.hands.find((h) => h.side === side);
    if (!x && !y) continue;
    count++;
    total +=
      x && y
        ? handDistance(x, y) + 0.6 * Math.min(norm(sub(x.wrist, y.wrist)), 1)
        : 1.1;
  }
  return count ? total / count : 0.5;
}
export function sequenceDistance(a: Frame[], b: Frame[]) {
  if (!a.length || !b.length) return Infinity;
  // Downsample uniformly, preserving order. A bounded DTW band tolerates pace
  // differences without making a reversed trajectory equivalent.
  const sample = (f: Frame[]) =>
    normalized(
      f.filter((_, i) => i % Math.max(1, Math.ceil(f.length / 48)) === 0),
    );
  const x = sample(a),
    y = sample(b),
    n = x.length,
    m = y.length,
    band = Math.max(Math.abs(n - m), Math.ceil(Math.max(n, m) * 0.3));
  const cost = Array.from({ length: n + 1 }, () =>
    new Float64Array(m + 1).fill(Infinity),
  );
  const lengths = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  cost[0][0] = 0;
  for (let i = 1; i <= n; i++)
    for (let j = Math.max(1, i - band); j <= Math.min(m, i + band); j++) {
      const options = [
        [i - 1, j - 1],
        [i - 1, j],
        [i, j - 1],
      ];
      const [pi, pj] = options.reduce((best, p) =>
        cost[p[0]][p[1]] < cost[best[0]][best[1]] ? p : best,
      );
      cost[i][j] = cost[pi][pj] + frameDistance(x[i - 1], y[j - 1]);
      lengths[i][j] = lengths[pi][pj] + 1;
    }
  return cost[n][m] / Math.max(1, lengths[n][m]);
}
export function quality(frames: Frame[]) {
  const valid = frames.filter((f) => f.hands.length > 0);
  let longestGap = 0,
    start: number | null = null;
  for (let i = 1; i < frames.length; i++)
    longestGap = Math.max(longestGap, frames[i].t - frames[i - 1].t);
  for (const f of frames) {
    if (!f.hands.length) {
      start ??= f.t;
      longestGap = Math.max(longestGap, f.t - start);
    } else start = null;
  }
  const duration = frames.length ? frames.at(-1)!.t - frames[0].t : 0;
  const coverage = valid.length / Math.max(1, frames.length);
  const sideCounts = { Left: 0, Right: 0 };
  for (const f of frames)
    for (const s of ["Left", "Right"] as const)
      if (f.hands.some((h) => h.side === s)) sideCounts[s]++;
  const intermittent = Object.values(sideCounts).some(
    (c) => c > frames.length * 0.2 && c < frames.length * 0.75,
  );
  let reason = "Mẫu đủ dữ liệu để thử đối chiếu.";
  if (duration < 1200) reason = "Mẫu quá ngắn. Thu ít nhất 1,2 giây.";
  else if (valid.length < 12)
    reason = "Quá ít frame có bàn tay. Đưa tay rõ vào camera.";
  else if (coverage < 0.8 || longestGap > 400 || intermittent)
    reason = "Tracking bị mất quá nhiều. Thu lại với hai bàn tay nhìn rõ.";
  return {
    valid:
      duration >= 1200 &&
      valid.length >= 12 &&
      coverage >= 0.8 &&
      longestGap <= 400 &&
      !intermittent,
    reason,
    coverage,
    duration,
    validFrames: valid.length,
  };
}
export function recognize(frames: Frame[], samples: Sample[]): Recognition {
  const q = quality(frames);
  if (!q.valid) return { accepted: false, reason: q.reason, matches: [] };
  const groups = new Map<string, Sample[]>();
  for (const s of samples) {
    const g = groups.get(s.labelId) || [];
    g.push(s);
    groups.set(s.labelId, g);
  }
  const matches = [...groups]
    .filter(([, items]) => items.length >= 3)
    .map(([labelId, items]) => {
      const distances = items
        .map((s) => sequenceDistance(frames, s.frames))
        .sort((a, b) => a - b);
      const distance = (distances[0] + distances[1]) / 2;
      return {
        labelId,
        label: items[0].label,
        distance,
        score: Math.round(Math.max(0, 1 - distance) * 100),
        samples: items.length,
      };
    })
    .sort((a, b) => a.distance - b.distance);
  if (!matches.length)
    return {
      accepted: false,
      reason: "Cần ít nhất 3 mẫu cho một nhãn trước khi đối chiếu.",
      matches,
    };
  const accepted =
    matches[0].distance < 0.24 &&
    (!matches[1] || matches[1].distance - matches[0].distance > 0.055);
  return {
    accepted,
    reason: accepted
      ? "Gợi ý gần nhất từ mẫu cá nhân; hãy xác nhận nghĩa."
      : "Chưa phân biệt chắc. Hướng, hình tay hoặc chuyển động chưa khớp đủ.",
    matches: matches.slice(0, 3),
  };
}
