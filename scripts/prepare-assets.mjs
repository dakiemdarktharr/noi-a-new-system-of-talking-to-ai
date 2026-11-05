import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const vendor = root + "public/vendor/mediapipe/";
await mkdir(vendor, { recursive: true });
await mkdir(root + "public/models", { recursive: true });
for (const name of [
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
])
  await copyFile(
    root + "node_modules/@mediapipe/tasks-vision/wasm/" + name,
    vendor + name,
  );
const url =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const path = root + "public/models/hand_landmarker.task";
const expectedHash = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1";
const cached = await readFile(path).catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return null;
});
let model = cached;
if (!model) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error("Model download HTTP " + res.status);
  model = Buffer.from(await res.arrayBuffer());
}
const hash = createHash("sha256").update(model).digest("hex");
if (hash !== expectedHash) throw new Error("Hand Landmarker model SHA-256 mismatch");
if (!cached) await writeFile(path, model);
const litePath = root + "public/models/hand_landmarker_lite.task";
const lite = await readFile(litePath).catch(() => {
  throw new Error("Missing bundled Lite task. Restore public/models/hand_landmarker_lite.task or reproduce it with scripts/build-hand-lite.py; see docs/FAST-TRACKING.md.");
});
const liteHash = createHash("sha256").update(lite).digest("hex");
if (liteHash !== "09e8b06f019471167f6f821c9d4ad1df632e31580de8eeca1049cd5c7b57f25f") throw new Error("Hand Landmarker Lite model SHA-256 mismatch");
const manifest = {
  model: "MediaPipe Hands Lite, Google Oct 2021 weights, Tasks bundle v1",
  defaultVariant: "lite",
  taskPath: "/models/hand_landmarker_lite.task",
  bytes: lite.length,
  sha256: liteHash,
  sources: [
    { url: "https://storage.googleapis.com/mediapipe-assets/palm_detection_lite.tflite", bytes: 1985440, sha256: "e9a4aaddf90dda56a87235303cf00e4c2d3fb28725f68fd88772997dac905c18" },
    { url: "https://storage.googleapis.com/mediapipe-assets/hand_landmark_lite.tflite", bytes: 2071408, sha256: "d7fde8ac11f8ce03f8663775bfc323f4fc9f2a38062b4f4efa142874ef5b2a48" },
  ],
  packaging: "Learned Lite weights unchanged. Compatible tensor metadata and associated handedness labels adapted from the official Full task bundle using MediaPipe 0.10.21 metadata schema and flatbuffers 25.12.19.",
  fullFallback: { model: "MediaPipe Hand Landmarker full float16 v1", taskPath: "/models/hand_landmarker.task", url, bytes: model.length, sha256: hash },
  sdk: JSON.parse(
    await readFile(
      root + "node_modules/@mediapipe/tasks-vision/package.json",
      "utf8",
    ),
  ).version,
  license: "Apache-2.0 per official model card",
  modelCard: "https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf",
  runtime: "Same-origin model and module WASM; no remote inference",
};
await writeFile(
  root + "public/models/manifest.json",
  JSON.stringify(manifest, null, 2),
);
console.log(manifest);
