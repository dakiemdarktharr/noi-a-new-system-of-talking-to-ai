import { describe, it, expect } from "vitest";
import { MeaningCycleGesture, nextMeaning } from "../../src/lib/meaning-cycle";
import { HandIdentityTracker } from "../../src/lib/hand-identity";
import { extractHand, quaternionDistance, degrees } from "../../src/lib/geometry";
import { fixtureHand } from "../../src/lib/fixtures";
import type { Frame, HandFeature, Side } from "../../src/types";

const hand = (side: Side = "Right", x = 0, curl = 0, angle = 0): HandFeature => ({
  ...extractHand(fixtureHand(angle))!, side, wrist: [x, 0, 0], curls: [0, curl, curl, curl, curl],
});
describe("meaning cycle temporal command", () => {
  function run(curls: (number | null)[], step = 33) {
    const cycle = new MeaningCycleGesture(); cycle.arm({ t: 0, hands: [hand()] });
    return curls.map((curl, i) => cycle.push({ t: (i + 1) * step, hands: curl === null ? [] : [hand("Right", 0, curl)] }));
  }
  it("counts one, two, three cycles separately, including 180° wrist orientation", () => {
    for (const angle of [0, 90, 180]) {
      const cycle = new MeaningCycleGesture(); cycle.arm({ t: 0, hands: [hand()] });
      const frames = Array.from({ length: 3 }, () => [...Array(4).fill(.9), ...Array(4).fill(.05)]).flat();
      const results = frames.map((curl, i) => cycle.push({ t: (i + 1) * 33, hands: [hand("Right", 0, curl, angle)] }));
      expect(results.reduce((sum, event) => sum + event.presses, 0)).toBe(3);
    }
    expect(nextMeaning(["tôi", "chúng tôi"], 0, 2)).toBe(0);
    expect(nextMeaning(["a", "b", "c", "d"], 0, 3)).toBe(3);
  });
  it("does not autorepeat a hold or accept a one-frame flicker or incomplete fist", () => {
    expect(run([...Array(30).fill(.9), ...Array(8).fill(0)]).reduce((s, e) => s + e.presses, 0)).toBe(1);
    expect(run([.9, 0, 0, 0, .3, .3, .3, 0, 0, 0]).some(e => e.presses)).toBe(false);
  });
  it("cancels a broken track, timeout, or opening the other hand", () => {
    expect(run([.9, .9, .9, .9, null, 0, 0, 0, 0]).some(e => e.presses)).toBe(false);
    const cycle = new MeaningCycleGesture(); cycle.arm({ t: 0, hands: [hand()] });
    for (let t = 33; t <= 165; t += 33) cycle.push({ t, hands: [hand("Right", 0, .9)] });
    expect(cycle.push({ t: 198, hands: [hand("Left")] }).presses).toBe(0);
    expect(cycle.push({ t: 5500, hands: [hand()] }).presses).toBe(0);
    expect(new MeaningCycleGesture().push({ t: 10, hands: [hand()] }).presses).toBe(0);
  });
});
describe("two physical hand channels", () => {
  it("keeps both hands when the raw classifier calls both Right", () => {
    const tracker = new HandIdentityTracker();
    const result = tracker.push({ t: 0, hands: [hand("Right", -.3), hand("Right", .3)] });
    expect(result.hands).toHaveLength(2);
    expect(new Set(result.hands.map(h => h.side)).size).toBe(2);
  });
  it("follows crossing hands despite reversed detection order and wrong side labels", () => {
    const tracker = new HandIdentityTracker();
    for (let i = 0; i <= 20; i++) {
      const left = hand(i > 3 ? "Right" : "Left", -.4 + i * .04, .1);
      const right = hand("Right", .4 - i * .04, .8);
      const frame: Frame = { t: i * 33, hands: i % 2 || i === 10 ? [right, left] : [left, right] };
      const found = tracker.push(frame);
      expect(found.hands.find(h => h.curls[1] === .1)!.side).toBe("Left");
      expect(found.hands.find(h => h.curls[1] === .8)!.side).toBe("Right");
    }
  });
  it("locks a hand after acquisition through sustained handedness flips; preserves a short missing second track", () => {
    const tracker = new HandIdentityTracker();
    for (let i = 0; i < 40; i++) {
      const raw = hand(i < 12 ? "Right" : "Left", 0, 0, i * 5);
      expect(tracker.push({ t: i * 33, hands: [raw] }).hands[0].side).toBe("Right");
    }
    tracker.reset();
    tracker.push({ t: 0, hands: [hand("Left", -.3), hand("Right", .3)] });
    tracker.push({ t: 40, hands: [hand("Left", -.3)] });
    const recovered = tracker.push({ t: 80, hands: [hand("Left", .3), hand("Left", -.3)] });
    expect(recovered.hands.find(h => h.wrist[0] === .3)!.side).toBe("Right");
  });
});
describe("orientation numerical regressions", () => {
  it("preserves finger shape but separates 180° in-plane and out-of-plane rotations", () => {
    const base = extractHand(fixtureHand())!;
    for (const [roll, tilt] of [[0, 0], [90, 0], [180, 0], [0, 180], [179, 0], [-179, 0]]) {
      const rotated = extractHand(fixtureHand(roll, tilt))!;
      expect(rotated).not.toBeNull();
      base.shape.forEach((v, i) => expect(v).toBeCloseTo(rotated.shape[i], 6));
      base.curls.forEach((v, i) => expect(v).toBeCloseTo(rotated.curls[i], 6));
      expect(degrees(quaternionDistance(base.quaternion, rotated.quaternion))).toBeCloseTo(Math.max(Math.abs(roll), tilt), 5);
    }
    expect(degrees(quaternionDistance(extractHand(fixtureHand(179))!.quaternion, extractHand(fixtureHand(-179))!.quaternion))).toBeCloseTo(2, 5);
  });
});
