import type { Frame, HandFeature, Side } from "../types";
import { quaternionDistance } from "./geometry";

export const DEFAULT_MEANINGS: Record<string, string[]> = { NOI0001: ["tôi", "chúng tôi"] };
export function nextMeaning(meanings: string[], index: number, presses = 1) {
  return meanings.length ? (index + presses) % meanings.length : 0;
}
const closed = (h: HandFeature) => h.curls.slice(1).every(v => v >= .62);
const opened = (h: HandFeature) => h.curls.slice(1).every(v => v <= .28);

/** Reserved command after a recognized word. Count CLOSED -> OPEN edges,
 * not frames, so holding a fist and repeated cycles have different meanings. */
export class MeaningCycleGesture {
  private side: Side | null = null;
  private phase: "ready" | "closing" | "closed" | "opening" = "ready";
  private since = 0;
  private last = -Infinity;
  private expires = -Infinity;
  private cooldown = -Infinity;
  private baseline = false;
  private endpoint: HandFeature | null = null;
  arm(frame: Frame) {
    this.reset();
    this.expires = frame.t + 5000;
    this.baseline = frame.hands.some(h => !closed(h));
  }
  reset() {
    this.side = null; this.phase = "ready"; this.since = 0;
    this.last = -Infinity; this.expires = -Infinity; this.cooldown = -Infinity; this.baseline = false; this.endpoint = null;
  }
  push(frame: Frame): { consumed: boolean; presses: number } {
    if (frame.t > this.expires || frame.t <= this.last) { this.reset(); return { consumed: false, presses: 0 }; }
    if (frame.t - this.last > 180) { this.phase = "ready"; this.side = null; }
    this.last = frame.t;
    let hand = this.side ? frame.hands.find(h => h.side === this.side) : undefined;
    if (this.side && !hand) {
      this.phase = "ready"; this.side = null; this.baseline = false;
      return { consumed: true, presses: 0 };
    }
    if (!this.baseline) { this.baseline = frame.hands.some(h => !closed(h)); return { consumed: false, presses: 0 }; }
    if (this.phase === "ready") {
      hand = frame.hands.find(closed);
      if (hand) { this.side = hand.side; this.phase = "closing"; this.since = frame.t; }
      else if (this.endpoint) {
        const end = this.endpoint, current = frame.hands.find(h => h.side === end.side);
        if (current && opened(current) && Math.hypot(...current.wrist.map((v, i) => v - end.wrist[i])) < .08 &&
            quaternionDistance(current.quaternion, end.quaternion) < .4 && Math.abs(current.curls[0] - end.curls[0]) < .2)
          return { consumed: true, presses: 0 };
        this.endpoint = null;
      }
    } else if (this.phase === "closing") {
      if (!closed(hand!)) { this.phase = "ready"; this.side = null; }
      else if (frame.t - this.since >= 65) this.phase = "closed";
    } else if (this.phase === "closed") {
      if (opened(hand!)) { this.phase = "opening"; this.since = frame.t; }
    } else if (this.phase === "opening") {
      if (!opened(hand!)) { this.phase = "closed"; }
      else if (frame.t - this.since >= 50) {
        this.endpoint = hand!;
        this.phase = "ready"; this.side = null; this.expires = frame.t + 5000; this.cooldown = frame.t + 200;
        return { consumed: true, presses: 1 };
      }
    }
    // A stalled, incomplete command cannot block word recognition indefinitely.
    if (this.phase !== "ready" && frame.t - this.since > 1800) {
      this.phase = "ready"; this.side = null; this.baseline = false;
    }
    return { consumed: this.phase !== "ready" || frame.t < this.cooldown, presses: 0 };
  }
}
