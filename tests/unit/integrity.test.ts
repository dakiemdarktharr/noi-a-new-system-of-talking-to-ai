import { describe, it, expect } from "vitest";
import { fixtureHand, fixtureSequence } from "../../src/lib/fixtures";
import {
  extractHand,
  quaternionDistance,
  degrees,
} from "../../src/lib/geometry";
import { quality, sequenceDistance } from "../../src/lib/recognizer";
import { validateImport, mergeSamples } from "../../src/lib/storage";
import type { Sample } from "../../src/types";
describe("orientation and movement remain distinct", () => {
  it("measures a rigid 90° turn despite identical finger shape, and q/-q equivalence", () => {
    const a = extractHand(fixtureHand())!,
      b = extractHand(fixtureHand(90))!;
    expect(degrees(quaternionDistance(a.quaternion, b.quaternion))).toBeCloseTo(
      90,
      5,
    );
    expect(
      quaternionDistance(
        a.quaternion,
        a.quaternion.map((n) => -n) as typeof a.quaternion,
      ),
    ).toBeCloseTo(0, 5);
    a.shape.forEach((v, i) => expect(v).toBeCloseTo(b.shape[i], 5));
    expect(
      sequenceDistance(fixtureSequence(0), fixtureSequence(90)),
    ).toBeGreaterThan(0.3);
  });
  it("does not merge horizontal and vertical trajectories", () => {
    expect(
      sequenceDistance(fixtureSequence(0, "right"), fixtureSequence(0, "up")),
    ).toBeGreaterThan(0.05);
  });
  it("rejects collapsed geometry instead of inventing a rotation", () => {
    const raw = fixtureHand();
    raw.world = raw.world.map(() => ({ x: 0, y: 0, z: 0 }));
    expect(extractHand(raw)).toBeNull();
  });
});
describe("recording and import integrity", () => {
  const sample = (): Sample => ({
    id: "source",
    labelId: "A",
    label: "A",
    schema: 1,
    sessionId: "one",
    createdAt: new Date().toISOString(),
    durationMs: 2950,
    frames: fixtureSequence(),
  });
  it("rejects a camera stall even if every processed frame has a hand", () => {
    const frames = fixtureSequence().filter((f) => f.t < 700 || f.t > 1700);
    expect(quality(frames).valid).toBe(false);
  });
  it("round trips valid landmarks and strips untrusted JSON blob fields", () => {
    const s = { ...sample(), videoBlob: { type: "fake" }, unexpected: "drop" };
    const [actual] = validateImport(
      { schema: 1, samples: [s] },
      new Set(["A"]),
    );
    expect(actual.frames).toHaveLength(60);
    expect(actual.videoBlob).toBeUndefined();
    expect(actual).not.toHaveProperty("unexpected");
  });
  it("rejects duplicate timestamps, unknown meanings and invalid quaternions", () => {
    const s = sample();
    s.frames[1].t = s.frames[0].t;
    expect(() =>
      validateImport({ schema: 1, samples: [s] }, new Set(["A"])),
    ).toThrow();
    expect(() =>
      validateImport({ schema: 1, samples: [sample()] }, new Set(["B"])),
    ).toThrow();
    const broken = sample();
    broken.frames[0].hands[0].quaternion = [0, 0, 0, 0];
    expect(() =>
      validateImport({ schema: 1, samples: [broken] }, new Set(["A"])),
    ).toThrow();
  });
  it("rejects duplicate IDs and ambiguous label names before writing anything", () => {
    const a = sample();
    expect(() => validateImport({ schema: 1, samples: [a, a] }, new Set(["A"]))).toThrow(/Trùng/);
    expect(() => validateImport({ schema: 1, samples: [a, { ...a, id: "two", label: "different" }] }, new Set(["A"]))).toThrow(/nhiều tên/);
  });
  it("preserves videos and cloud acknowledgement on JSON reimport and detects conflicting IDs", () => {
    const original = { ...sample(), videoBlob: new Blob(["original"]), backupStatus: "saved" as const, gestureKind: "dynamic" as const };
    const [merged] = mergeSamples([original], [sample()]);
    expect(merged.videoBlob).toBe(original.videoBlob);
    expect(merged.backupStatus).toBe("saved");
    expect(merged.gestureKind).toBe("dynamic");
    expect(() => mergeSamples([original], [{ ...sample(), labelId: "B" }])).toThrow(/nhãn/);
    const changed = sample(); changed.frames[0].hands[0].curls[0] += .1;
    expect(() => mergeSamples([original], [changed])).toThrow(/chuyển động/);
    expect(() => mergeSamples([], [sample(), sample()])).toThrow(/Trùng/);
  });
  it("round trips explicit dynamic/static semantics", () => {
    const [loaded] = validateImport({ schema: 1, samples: [{ ...sample(), gestureKind: "dynamic" }] }, new Set(["A"]));
    expect(loaded.gestureKind).toBe("dynamic");
    expect(() => validateImport({ schema: 1, samples: [{ ...sample(), gestureKind: "other" }] }, new Set(["A"]))).toThrow(/Loại/);
  });
});
