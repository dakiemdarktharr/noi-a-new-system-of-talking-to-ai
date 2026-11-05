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
const manifest = {
  model: "MediaPipe Hand Landmarker full float16 v1",
  url,
  bytes: model.length,
  sha256: hash,
  sdk: JSON.parse(
    await readFile(
      root + "node_modules/@mediapipe/tasks-vision/package.json",
      "utf8",
    ),
  ).version,
  license: "Apache-2.0 per official model card",
  runtime: "Same-origin model and module WASM; no remote inference",
};
await writeFile(
  root + "public/models/manifest.json",
  JSON.stringify(manifest, null, 2),
);
console.log(manifest);
