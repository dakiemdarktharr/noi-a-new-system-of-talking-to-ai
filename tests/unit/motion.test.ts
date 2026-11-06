import { describe, expect, it } from "vitest";
import { fixtureHand, fixtureSequence } from "../../src/lib/fixtures";
import { extractHand } from "../../src/lib/geometry";
import { buildMotionProfile, HandIdentityTracker, matchesMotion, motionSequence, motionTravel, SignSegmenter, trimMotion } from "../../src/lib/motion";
import type { Frame } from "../../src/types";

function loop(reverse = false): Frame[] {
  return Array.from({ length: 31 }, (_, i) => {
    const phase = i / 30, theta = phase * Math.PI * 2;
    return { t: i * 40, hands: [extractHand(fixtureHand(180 * (1 - phase), 0,
      [(reverse ? -1 : 1) * .1 * Math.sin(theta), .1 * (Math.cos(theta) - 1), 0]))!] };
  });
}

describe("static/dynamic prefix regressions using synthetic geometry", () => {
  it("requires the whole loop, finger direction and traveled path", () => {
    const full = loop(), profile = buildMotionProfile([full, full, full]);
    expect(profile.kind).toBe("dynamic");
    expect(matchesMotion(full, profile)).toBe(true);
    expect(matchesMotion(fixtureSequence(180), profile)).toBe(false);
    expect(matchesMotion(full.slice(0, 12), profile)).toBe(false);
    expect(matchesMotion(loop(true), profile)).toBe(false);
    expect(motionTravel(motionSequence(full))).toBeGreaterThan(1);
    for (const pace of [.65, 1.4]) expect(matchesMotion(full.map(f => ({ ...f, t: f.t * pace })), profile)).toBe(true);
  });

  it("never accepts movement as a held static pose", () => {
    const still = fixtureSequence(180), profile = buildMotionProfile([still, still, still]);
    expect(profile.kind).toBe("static");
    expect(matchesMotion(still, profile)).toBe(true);
    expect(matchesMotion(loop(), profile)).toBe(false);
  });

  it("waits through a shared static prefix then returns the whole motion after settling", () => {
    const segmenter = new SignSegmenter(), motion = loop();
    for (let t = 0; t <= 280; t += 40) {
      segmenter.push({ ...motion[0], t });
      expect(segmenter.candidate()).toBeNull();
    }
    for (const frame of motion) {
      segmenter.push({ ...frame, t: frame.t + 320 });
      expect(segmenter.candidate()).toBeNull();
    }
    for (let t = 1560; t <= 1840; t += 40) segmenter.push({ ...motion.at(-1)!, t });
    const candidate = segmenter.candidate();
    expect(candidate).not.toBeNull();
    expect(matchesMotion(trimMotion(candidate!), buildMotionProfile([trimMotion(motion)]))).toBe(true);
    const revision = segmenter.revision;
    segmenter.confirm(revision);
    segmenter.push({ ...motion.at(-1)!, t: 1880 });
    expect(segmenter.candidate()).toBeNull();
    segmenter.push({ ...motion[0], t: 1920 });
    expect(segmenter.revision).toBeGreaterThan(revision);
  });

  it("emits a held pose once and resets on tracking loss or timestamp gaps", () => {
    const segmenter = new SignSegmenter(), pose = fixtureSequence(180)[0];
    for (let t = 0; t <= 680; t += 40) segmenter.push({ ...pose, t });
    expect(segmenter.candidate()).not.toBeNull();
    segmenter.confirm(segmenter.revision);
    for (let t = 720; t <= 1200; t += 40) {
      segmenter.push({ ...pose, t });
      expect(segmenter.candidate()).toBeNull();
    }
    segmenter.push({ t: 1240, hands: [] });
    segmenter.push({ t: 1480, hands: [] });
    for (let t = 1520; t <= 2200; t += 40) segmenter.push({ ...pose, t });
    expect(segmenter.candidate()).not.toBeNull();
    segmenter.push({ ...pose, t: 2500 });
    expect(segmenter.candidate()).toBeNull();
  });

  it("invalidates an asynchronous decision when the signer continues moving", () => {
    const segmenter = new SignSegmenter(), pose = fixtureSequence(180)[0];
    for (let t = 0; t <= 680; t += 40) segmenter.push({ ...pose, t });
    expect(segmenter.candidate()).not.toBeNull();
    const revision = segmenter.revision;
    segmenter.push({ ...loop()[10], t: 720 });
    expect(segmenter.revision).not.toBe(revision);
    segmenter.confirm(revision);
    expect(segmenter.candidate()).toBeNull();
  });

  it("allows a static hold after positioning the hand and rejecting that movement", () => {
    const segmenter = new SignSegmenter();
    const movement = fixtureSequence(180, "right", 20);
    movement.forEach(frame => segmenter.push(frame));
    const pose = movement.at(-1)!;
    for (let t = 1000; t <= 1750; t += 50) segmenter.push({ ...pose, t });
    const candidate = segmenter.candidate();
    expect(candidate).not.toBeNull();
    const profile = buildMotionProfile([fixtureSequence(180)]);
    expect(matchesMotion(candidate!, profile)).toBe(true);
  });

  it("keeps offering unrecognized holds beyond five seconds", () => {
    const segmenter = new SignSegmenter(), pose = fixtureSequence(180)[0];
    for (let t = 0; t <= 6000; t += 40) segmenter.push({ ...pose, t });
    expect(segmenter.candidate()).not.toBeNull();
    segmenter.push({ t: 6040, hands: [] });
    for (let t = 6080; t <= 6800; t += 40) segmenter.push({ ...pose, t });
    expect(segmenter.candidate()).not.toBeNull();
  });

  it("offers a static candidate despite small alternating landmark jitter", () => {
    const segmenter = new SignSegmenter();
    let candidates = 0;
    for (let i = 0; i < 100; i++) {
      const sign = i % 2 ? 1 : -1;
      segmenter.push({ t: i * 40, hands: [extractHand(fixtureHand(180 + sign * 2, 0, [sign * .003, 0, 0]))!] });
      if (segmenter.candidate()) candidates++;
    }
    expect(candidates).toBeGreaterThan(0);
  });

  it("offers the complete dynamic candidate when its endpoint has landmark jitter", () => {
    const segmenter = new SignSegmenter(), movement = loop();
    movement.forEach(frame => segmenter.push(frame));
    const candidates: Frame[][] = [];
    for (let i = 1; i <= 14; i++) {
      const sign = i % 2 ? 1 : -1;
      segmenter.push({ t: 1200 + i * 40, hands: [extractHand(fixtureHand(sign * 2, 0, [sign * .003, 0, 0]))!] });
      const candidate = segmenter.candidate();
      if (candidate) candidates.push(candidate);
    }
    expect(candidates.some(candidate => matchesMotion(trimMotion(candidate), buildMotionProfile([trimMotion(movement)])))).toBe(true);
  });

  it("accepts a deliberately labelled small dynamic gesture against its own profile", () => {
    const movement = fixtureSequence(180, "right", 30).map(frame => ({ ...frame,
      hands: frame.hands.map(hand => ({ ...hand, wrist: [0.5 + (hand.wrist[0] - .5) * .05, hand.wrist[1], hand.wrist[2]] as [number, number, number] })),
    }));
    expect(matchesMotion(movement, buildMotionProfile([movement], "dynamic"))).toBe(true);
    expect(matchesMotion(fixtureSequence(180), buildMotionProfile([movement], "dynamic"))).toBe(false);
  });

  it("tolerates one missing frame without duplicating a confirmed hold", () => {
    const segmenter = new SignSegmenter(), pose = fixtureSequence(180)[0];
    let candidates = 0;
    for (let i = 0; i < 50; i++) {
      segmenter.push({ ...pose, t: i * 40, hands: i % 8 === 7 ? [] : pose.hands });
      if (segmenter.candidate()) { candidates++; segmenter.confirm(segmenter.revision); }
    }
    expect(candidates).toBe(1);
  });

  it("does not let noisy 3D orientation block a visibly stationary hand", () => {
    const decoder = new SignSegmenter(), pose = fixtureSequence(0)[0];
    for (let i = 0; i < 35; i++) {
      const rotation = extractHand(fixtureHand(i % 2 ? 45 : -45))!;
      decoder.push({ t: i * 33, hands: [{ ...pose.hands[0], quaternion: rotation.quaternion }] });
    }
    expect(decoder.candidate()).not.toBeNull();
    expect(decoder.staticReady).toBe(true);
  });

  it("keeps brief side flips in the physical hand channel and recovers a wrong first label", () => {
    const identity = new HandIdentityTracker(), pose = fixtureSequence(0)[0];
    const seen = Array.from({ length: 20 }, (_, i) => identity.push({ t: i * 33,
      hands: [{ ...pose.hands[0], side: i === 0 || i === 12 ? "Left" : "Right" }],
    }).hands[0].side);
    expect(seen.slice(2).every(side => side === "Right")).toBe(true);
    identity.push({ t: 2000, hands: [] });
    expect(identity.push({ t: 2300, hands: [{ ...pose.hands[0], side: "Left" }] }).hands[0].side).toBe("Left");
  });

  it("can propose a moving candidate without accepting a prefix as a full sign", () => {
    const frames = loop(), decoder = new SignSegmenter();
    frames.slice(0, 12).forEach(frame => decoder.push(frame));
    const candidate = decoder.candidate(true);
    expect(candidate).not.toBeNull();
    expect(decoder.staticReady).toBe(false);
    expect(matchesMotion(candidate!, buildMotionProfile([frames], "dynamic"))).toBe(false);
  });
});
