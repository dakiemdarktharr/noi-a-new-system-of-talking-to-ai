import { useEffect, useRef } from "react";
import type { HandFeature } from "../types";
import { CONNECTIONS } from "../lib/geometry";
export function Overlay({
  hands,
  mirrored,
}: {
  hands: HandFeature[];
  mirrored: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect(),
      dpr = devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const c = canvas.getContext("2d")!;
    c.scale(dpr, dpr);
    const w = rect.width,
      h = rect.height;
    for (const hand of hands) {
      const color = hand.side === "Left" ? "#5bd7be" : "#b6a3ff";
      const p = hand.landmarks.map((v) => [
        (mirrored ? 1 - v.x : v.x) * w,
        v.y * h,
      ]);
      c.lineWidth = 2.4;
      c.strokeStyle = color;
      c.lineCap = "round";
      for (const [a, b] of CONNECTIONS) {
        c.beginPath();
        c.moveTo(...(p[a] as [number, number]));
        c.lineTo(...(p[b] as [number, number]));
        c.stroke();
      }
      for (let i = 0; i < p.length; i++) {
        c.beginPath();
        c.arc(
          p[i][0],
          p[i][1],
          [4, 8, 12, 16, 20].includes(i) ? 4.5 : 2.5,
          0,
          Math.PI * 2,
        );
        c.fillStyle = color;
        c.fill();
      }
      const base = p[0],
        scale = Math.max(25, Math.hypot(p[9][0] - base[0], p[9][1] - base[1]));
      for (const [v, col] of [
        [hand.forward, "#ffd38a"],
        [hand.radial, "#a7dfff"],
        [hand.normal, "#ff9fb7"],
      ] as const) {
        const dx = v[0] * scale * (mirrored ? -1 : 1),
          dy = -v[1] * scale;
        c.strokeStyle = col;
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(base[0], base[1]);
        c.lineTo(base[0] + dx, base[1] + dy);
        c.stroke();
        c.beginPath();
        c.arc(base[0] + dx, base[1] + dy, 3, 0, Math.PI * 2);
        c.fillStyle = col;
        c.fill();
      }
    }
  }, [hands, mirrored]);
  return <canvas ref={ref} className="overlay" aria-hidden="true" />;
}
