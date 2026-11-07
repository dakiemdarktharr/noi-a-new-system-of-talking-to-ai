import { describe, expect, it } from "vitest";
import * as tf from "@tensorflow/tfjs";
import JSZip from "jszip";
import type { Frame, Sample } from "../../src/types";
import { extractHand } from "../../src/lib/geometry";
import { fixtureHand, fixtureSequence } from "../../src/lib/fixtures";
import {
  clipUsable,
  encodeClip,
  FEATURE_COUNT,
  HAND_FEATURES,
  TIME_STEPS,
} from "../../src/lib/features";
import { splitSamples, TemporalClassifier } from "../../src/lib/temporal";

function sample(
  id: string,
  labelId: string,
  sessionId: string,
  angle = 0,
): Sample {
  return {
    id,
    labelId,
    label: labelId,
    sessionId,
    createdAt: `2026-11-05T10:00:${id.replace(/\D/g, "").padStart(2, "0").slice(-2)}Z`,
    durationMs: 1450,
    schema: 1,
    frames: fixtureSequence(angle, "still", 30),
  };
}

describe("temporal features (synthetic geometry only)", () => {
  it("has fixed finite bounded dimensions and explicit missing-hand masks", () => {
    const encoded = encodeClip(fixtureSequence());
    expect(encoded).toHaveLength(TIME_STEPS);
    expect(
      encoded.every(
        (row) =>
          row.length === FEATURE_COUNT &&
          row.every((v) => Number.isFinite(v) && Math.abs(v) <= 1),
      ),
    ).toBe(true);
    expect(encoded[0][0]).toBe(0);
    expect(encoded[0][HAND_FEATURES]).toBe(1);
    expect(
      encodeClip([])
        .flat()
        .every((v) => v === 0),
    ).toBe(true);
    expect(
      clipUsable(
        Array.from({ length: 30 }, (_, i) => ({ t: i * 50, hands: [] })),
      ),
    ).toBe(false);
  });

  it("retains rotation despite normalized hand shape", () => {
    const a = encodeClip(fixtureSequence(0))[0],
      b = encodeClip(fixtureSequence(90))[0];
    a.slice(HAND_FEATURES + 1, HAND_FEATURES + 64).forEach((v, i) =>
      expect(v).toBeCloseTo(b[HAND_FEATURES + 1 + i], 5),
    );
    expect(a.slice(HAND_FEATURES + 64, HAND_FEATURES + 70)).not.toEqual(
      b.slice(HAND_FEATURES + 64, HAND_FEATURES + 70),
    );
  });

  it("uses shared image coordinates for two-hand spacing, regardless of hand-local world origin", () => {
    const left = extractHand({ ...fixtureHand(), side: "Left" })!;
    const right = extractHand(fixtureHand())!;
    const close: Frame[] = [
      { t: 0, hands: [left, right] },
      { t: 1000, hands: [left, right] },
    ];
    const shifted = {
      ...right,
      wrist: [right.wrist[0] + 0.4, right.wrist[1], 0] as [
        number,
        number,
        number,
      ],
    };
    const far = close.map((f) => ({ ...f, hands: [left, shifted] }));
    expect(encodeClip(close)[0][HAND_FEATURES * 2 + 1]).toBeCloseTo(0);
    expect(encodeClip(far)[0][HAND_FEATURES * 2 + 1]).toBeCloseTo(0.4);
  });

  it("preserves movement direction and elapsed duration", () => {
    const forward = fixtureSequence(0, "right", 30);
    const backward = forward.map((f, i) => ({
      t: f.t,
      hands: forward[forward.length - 1 - i].hands,
    }));
    expect(encodeClip(forward).at(-1)![HAND_FEATURES + 72]).toBeGreaterThan(0);
    expect(encodeClip(backward).at(-1)![HAND_FEATURES + 72]).toBeLessThan(0);
    expect(encodeClip(forward)[0][FEATURE_COUNT - 2]).toBeCloseTo(1450 / 6000);
  });
});

describe("whole-clip evaluation partition", () => {
  it("does not silently discard bad clips or duplicate IDs or relabel a class", async () => {
    const classifier = new TemporalClassifier(), a = sample("1", "A", "one");
    await expect(classifier.train([a, a])).rejects.toThrow(/trùng/);
    await expect(classifier.train([{ ...a, frames: [] }])).rejects.toThrow(/không tự bỏ mẫu/);
    await expect(classifier.train([a, { ...a, id: "2", label: "wrong" }])).rejects.toThrow(/nhiều tên/);
    await expect(classifier.train([{ ...a, gestureKind: "static" }, { ...a, id: "2", gestureKind: "dynamic" }])).rejects.toThrow(/cả tĩnh và động/);
  });
  it("holds an entire session out without frame or session leakage", () => {
    const samples = ["a", "b"].flatMap((label) =>
      Array.from({ length: 6 }, (_, i) =>
        sample(`${label}${i}`, label, `session${Math.floor(i / 2)}`),
      ),
    );
    const split = splitSamples(samples);
    expect(split.mode).toBe("session");
    expect(split.validation).toHaveLength(4);
    expect(
      new Set(split.train.map((s) => s.sessionId)).has(
        split.validation[0].sessionId,
      ),
    ).toBe(false);
    expect(split.train.some((s) => split.validation.includes(s))).toBe(false);
  });

  it("labels single-session clip holdout honestly and does not invent validation for tiny sets", () => {
    expect(
      splitSamples(
        Array.from({ length: 5 }, (_, i) => sample(`${i}`, "a", "one")),
      ).mode,
    ).toBe("clip");
    expect(
      splitSamples(
        Array.from({ length: 3 }, (_, i) => sample(`${i}`, "a", "one")),
      ).mode,
    ).toBe("none");
  });
});

// Pure-JS Node CPU backpropagation is substantially slower than the browser's
// WebGL backend. Keep the same epochs/assertions while allowing slow CI hosts.
describe("real TensorFlow.js execution — synthetic software regression, NOT human sign accuracy", () => {
  it("learns up versus right with the same handshape and orientation", async () => {
    await tf.setBackend("cpu");
    const model = new TemporalClassifier();
    const directions = ["up", "right"] as const;
    const samples = directions.flatMap((move) =>
      Array.from({ length: 6 }, (_, i) => ({
        ...sample(`${move}${i}`, move, `session${Math.floor(i / 2)}`),
        frames: fixtureSequence(i % 2 ? 1 : -1, move, 30),
      })),
    );
    try {
      await model.train(samples, undefined, {
        epochs: 32,
        persist: false,
        seed: 23,
      });
      for (const move of directions) {
        const prediction = await model.predict(fixtureSequence(0, move, 30));
        expect(prediction.matches[0].labelId).toBe(move);
        expect(prediction.accepted).toBe(true);
      }
    } finally {
      model.dispose();
    }
  }, 600000);
  it("learns two synthetic orientations, reports held-out clips, rejects no hands, and disposes inference tensors", async () => {
    await tf.setBackend("cpu");
    const baselineTensors = tf.memory().numTensors;
    const classifier = new TemporalClassifier();
    const samples = ["A", "NO_SIGN"].flatMap((label, labelIndex) =>
      Array.from({ length: 6 }, (_, i) =>
        sample(
          `${label}${i}`,
          label,
          `session${Math.floor(i / 2)}`,
          labelIndex * 90 + (i % 2 ? 2 : -2),
        ),
      ),
    );
    const progress: number[] = [];
    const summary = await classifier.train(
      samples,
      (p) => progress.push(p.loss),
      { epochs: 20, batchSize: 8, persist: false, seed: 17 },
    );
    expect(summary.parameters).toBeGreaterThan(1000);
    expect(summary.parameters).toBeLessThan(100000);
    expect(summary.validationMode).toBe("session");
    expect(summary.validationCount).toBe(4);
    expect(summary.validationAccuracy).toBeGreaterThan(0.9);
    expect(progress.at(-1)!).toBeLessThan(progress[0]);
    const result = await classifier.predict(fixtureSequence(0, "still", 30));
    expect(result.matches[0].labelId).toBe("A");
    expect(result.accepted).toBe(true);
    const negative = await classifier.predict(fixtureSequence(90, "still", 30));
    expect(negative.matches[0].labelId).toBe("NO_SIGN");
    expect(negative.accepted).toBe(false);
    expect((await classifier.predict([])).accepted).toBe(false);
    // A real trained model survives an inference-only portable ZIP round trip.
    // These fixtures establish serialization fidelity, not human sign accuracy.
    const archive = await classifier.exportModel();
    const zip = await JSZip.loadAsync(await archive.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(["model.json", "weights.bin"]);
    const manifest = JSON.parse(await zip.file("model.json")!.async("string"));
    expect(manifest.weightSpecs).toHaveLength(10);
    expect(manifest.weightBytes).toBe(summary.parameters * 4);
    expect(manifest.trainingConfig).toBeUndefined();
    expect(manifest.metadata.summary.labels.map((label: { labelId: string }) => label.labelId)).toEqual(["A", "NO_SIGN"]);
    expect(archive.size).toBeLessThan(250_000);
    console.info(`PORTABLE_MODEL two-class: ${archive.size} ZIP bytes, ${manifest.weightBytes} float32 weight bytes, ${summary.parameters} parameters; no optimizer or videos`);
    const imported = new TemporalClassifier();
    try {
      const importedSummary = await imported.importModel(archive);
      expect(importedSummary.labels).toEqual(summary.labels);
      expect(importedSummary.persisted).toBe(false); // Node has no browser IndexedDB.
      expect(await imported.predict(fixtureSequence(0, "still", 30))).toEqual(result);
      expect(await imported.predict(fixtureSequence(90, "still", 30))).toEqual(negative);
      // A re-exported inference-only model is also a valid portable model.
      await imported.importModel(await imported.exportModel());
      expect(await imported.predict(fixtureSequence(0, "still", 30))).toEqual(result);

      const corrupt = async (mutate: (data: typeof manifest, z: JSZip) => void) => {
        const z = await JSZip.loadAsync(await archive.arrayBuffer());
        const data = JSON.parse(await z.file("model.json")!.async("string"));
        mutate(data, z); z.file("model.json", JSON.stringify(data));
        return z.generateAsync({ type: "blob", compression: "DEFLATE" });
      };
      const beforeBadImports = tf.memory().numTensors;
      for (const bad of [
        await corrupt(data => { data.version = 99; }),
        await corrupt(data => { data.metadata.supports[0].center = [0]; }),
        await corrupt(data => { data.metadata.summary.labels[1].labelId = "A"; }),
        await corrupt(data => { data.modelTopology.config.layers[0].config.batch_input_shape = [null, 1e9, 172]; }),
        await corrupt(data => { data.weightSpecs[0].shape = [5, 172, 9999999]; }),
        await corrupt((_data, z) => { z.file("videos/raw.webm", new Uint8Array([1, 2, 3])); }),
        await corrupt((_data, z) => { z.file("weights.bin", new Uint8Array(600_000)); }),
      ]) {
        await expect(imported.importModel(bad)).rejects.toThrow();
        expect(await imported.predict(fixtureSequence(0, "still", 30))).toEqual(result);
        expect(tf.memory().numTensors).toBe(beforeBadImports);
      }
      const changedWeights = new Uint8Array(await zip.file("weights.bin")!.async("arraybuffer"));
      changedWeights[0] ^= 1;
      await expect(imported.importModel(await corrupt((_data, z) => { z.file("weights.bin", changedWeights); }))).rejects.toThrow(/mã kiểm tra/);
      expect(await imported.predict(fixtureSequence(0, "still", 30))).toEqual(result);
    } finally { imported.dispose(); }
    const count = tf.memory().numTensors;
    for (let i = 0; i < 3; i++)
      await classifier.predict(fixtureSequence(0, "still", 30));
    expect(tf.memory().numTensors).toBe(count);
    classifier.dispose();
    expect(classifier.getSummary()).toBeNull();
    expect(tf.memory().numTensors).toBe(baselineTensors);
  }, 600000);
});
