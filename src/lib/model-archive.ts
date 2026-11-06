import JSZip from "jszip";
import type * as tf from "@tensorflow/tfjs";
import type { ModelMetadata, ModelSummary } from "./temporal";
import { MOTION_STEPS, MOTION_WIDTH, type MotionProfile } from "./motion";
import { FEATURE_COUNT, FEATURE_VERSION, TIME_STEPS } from "./features";

export const MODEL_ARCHIVE_LIMIT = 16 * 1024 * 1024;
const JSON_LIMIT = 32 * 1024 * 1024;
const WEIGHTS_LIMIT = 512 * 1024;
const FORMAT = "noi-temporal-model";
const VERSION = 1;
type ObjectMap = Record<string, unknown>;
function object(value: unknown): ObjectMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cấu trúc tệp mô hình không hợp lệ.");
  return value as ObjectMap;
}
function assert(ok: unknown, message = "Cấu trúc mô hình không tương thích."): asserts ok {
  if (!ok) throw new Error(message);
}
const integer = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const finite = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max = 256): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const equalShape = (value: unknown, expected: (number | null)[]) => Array.isArray(value) && value.length === expected.length && value.every((v, i) => v === expected[i]);

/** Normalize a whitelist of inference metadata; never copy arbitrary sample data. */
export function validateModelMetadata(value: unknown): ModelMetadata {
  const source = object(value), summary = object(source.summary);
  assert(source.featureVersion === FEATURE_VERSION, "Phiên bản đặc trưng của mô hình không tương thích.");
  assert(Array.isArray(summary.labels) && summary.labels.length >= 2 && summary.labels.length <= 1024, "Số nhãn của mô hình không hợp lệ.");
  const labels = summary.labels.map(raw => {
    const label = object(raw);
    assert(text(label.labelId, 128) && text(label.label) && integer(label.samples, 3, 1_000_000), "Nhãn hoặc số mẫu của mô hình không hợp lệ.");
    assert(label.windowMs === undefined || integer(label.windowMs, 1000, 4000) && label.windowMs % 500 === 0, "Cửa sổ nhận diện không hợp lệ.");
    return { labelId: label.labelId, label: label.label, samples: label.samples, ...(label.windowMs === undefined ? {} : { windowMs: label.windowMs as number }) };
  });
  assert(new Set(labels.map(label => label.labelId)).size === labels.length, "Mô hình có nhãn trùng lặp.");
  assert(text(summary.trainedAt, 64) && Number.isFinite(Date.parse(summary.trainedAt)));
  assert(integer(summary.sampleCount, 6, 1_000_000) && integer(summary.trainCount, 4, 1_000_000) && integer(summary.validationCount, 0, 1_000_000));
  assert(summary.sampleCount === labels.reduce((total, label) => total + label.samples, 0) && summary.trainCount + summary.validationCount === summary.sampleCount);
  assert(["session", "clip", "none"].includes(summary.validationMode as string));
  assert((summary.validationCount === 0) === (summary.validationMode === "none"));
  assert(summary.validationAccuracy === null || finite(summary.validationAccuracy, 0, 1));
  assert(integer(summary.epochs, 1, 150) && summary.parameters === (summary.recognitionVersion === 2 ? 56872 : 52264) + 33 * labels.length);
  assert(text(summary.backend, 64) && typeof summary.persisted === "boolean");
  assert(Array.isArray(source.supports) && source.supports.length === labels.length, "Thiếu dữ liệu hỗ trợ nhận diện.");
  const supports = source.supports.map(raw => {
    const support = object(raw);
    assert(Array.isArray(support.center) && support.center.length === FEATURE_COUNT * 3 && support.center.every(n => finite(n, -2, 2)), "Kích thước đặc trưng hỗ trợ không hợp lệ.");
    assert(finite(support.radius, .065, .25), "Ngưỡng hỗ trợ nhận diện không hợp lệ.");
    return { center: support.center.slice() as number[], radius: support.radius };
  });
  assert(summary.recognitionVersion === undefined || summary.recognitionVersion === 2);
  let motionProfiles: MotionProfile[] | undefined;
  if (summary.recognitionVersion === 2) {
    assert(Array.isArray(source.motionProfiles) && source.motionProfiles.length === labels.length, "Thiếu hồ sơ chuyển động.");
    motionProfiles = source.motionProfiles.map(raw => {
      const profile = object(raw);
      assert(profile.kind === "static" || profile.kind === "dynamic");
      assert(finite(profile.minTravel, 0, 100) && finite(profile.tolerance, .09, .75));
      assert(profile.endpointTolerance === undefined || finite(profile.endpointTolerance, .12, .5));
      assert(Array.isArray(profile.templates) && profile.templates.length >= 1 && profile.templates.length <= 6);
      const templates = profile.templates.map(rawTemplate => {
        assert(Array.isArray(rawTemplate) && rawTemplate.length === MOTION_STEPS);
        return rawTemplate.map(row => {
          assert(Array.isArray(row) && row.length === MOTION_WIDTH && row.every(value => finite(value, -1, 1)));
          assert([0, 1].includes(row[0]) && [0, 1].includes(row[14]));
          return row.slice() as number[];
        });
      });
      return { kind: profile.kind, minTravel: profile.minTravel, tolerance: profile.tolerance, templates,
        ...(profile.endpointTolerance === undefined ? {} : { endpointTolerance: profile.endpointTolerance as number }) };
    });
  }
  return { featureVersion: FEATURE_VERSION, summary: {
    ...(summary.recognitionVersion === 2 ? { recognitionVersion: 2 as const } : {}),
    trainedAt: summary.trainedAt, labels, sampleCount: summary.sampleCount, trainCount: summary.trainCount,
    validationCount: summary.validationCount, validationMode: summary.validationMode as ModelSummary["validationMode"],
    validationAccuracy: summary.validationAccuracy as number | null, epochs: summary.epochs, parameters: summary.parameters as number,
    backend: summary.backend, persisted: summary.persisted,
  }, supports, ...(motionProfiles ? { motionProfiles } : {}) };
}

/** Only the versioned Nối CNN is accepted; arbitrary graphs are never allocated. */
function validateTopology(value: unknown, classes: number, recognitionVersion?: 2): { topology: ObjectMap; names: string[]; shapes: number[][] } {
  const topology = object(value), config = object(topology.config);
  assert(topology.class_name === "Sequential" && Array.isArray(config.layers) && config.layers.length === 8, "Kiến trúc mô hình không tương thích với Nối.");
  const kinds = ["Conv1D", "Conv1D", "AveragePooling1D", "Conv1D", "Flatten", "Dense", "Dropout", "Dense"];
  const names: string[] = [], shapes: number[][] = [];
  const layers = config.layers.map((raw, i) => {
    const layer = object(raw), c = object(layer.config);
    assert(layer.class_name === kinds[i] && text(c.name, 128) && /^[a-zA-Z0-9_-]+$/.test(c.name));
    assert(i === 0 ? equalShape(c.batch_input_shape, [null, TIME_STEPS, FEATURE_COUNT]) : c.batch_input_shape === undefined, "Kích thước đầu vào mô hình không tương thích.");
    assert(c.dtype === undefined || c.dtype === "float32");
    const clean: ObjectMap = { name: c.name, trainable: false };
    if (kinds[i] === "Conv1D") {
      const filters = i === 0 ? 24 : i === 1 ? 32 : 48, kernel = i === 0 || recognitionVersion === 2 ? 5 : 3;
      const dilation = 1;
      assert(c.filters === filters && equalShape(c.kernel_size, [kernel]) && equalShape(c.strides, [1]) && equalShape(c.dilation_rate, [dilation]) && c.padding === "same" && c.activation === "relu" && c.use_bias === true);
      Object.assign(clean, { filters, kernel_size: [kernel], strides: [1], dilation_rate: [dilation], padding: "same", activation: "relu", use_bias: true,
        kernel_initializer: { class_name: "Zeros", config: {} }, bias_initializer: { class_name: "Zeros", config: {} } });
      if (i === 0) Object.assign(clean, { batch_input_shape: [null, TIME_STEPS, FEATURE_COUNT], dtype: "float32" });
      names.push(c.name + "/kernel", c.name + "/bias"); shapes.push([kernel, i === 0 ? FEATURE_COUNT : i === 1 ? 24 : 32, filters], [filters]);
    } else if (kinds[i] === "AveragePooling1D") {
      assert(equalShape(c.pool_size, [2]) && equalShape(c.strides, [2]) && c.padding === "valid");
      Object.assign(clean, { pool_size: [2], strides: [2], padding: "valid" });
    } else if (kinds[i] === "Dense") {
      const units = i === 5 ? 32 : classes, activation = i === 5 ? "relu" : "softmax";
      assert(c.units === units && c.activation === activation && c.use_bias === true);
      Object.assign(clean, { units, activation, use_bias: true, kernel_initializer: { class_name: "Zeros", config: {} }, bias_initializer: { class_name: "Zeros", config: {} } });
      names.push(c.name + "/kernel", c.name + "/bias"); shapes.push([i === 5 ? 768 : 32, units], [units]);
    } else if (kinds[i] === "Dropout") {
      assert(c.rate === .15);
      Object.assign(clean, { rate: .15 });
    }
    return { class_name: kinds[i], config: clean };
  });
  assert(new Set(layers.map(layer => layer.config.name)).size === 8);
  // Initializers, regularizers, training config and unknown config fields are
  // deliberately not imported. Exact saved inference weights replace all zeros.
  return { topology: { class_name: "Sequential", config: { name: "noi_portable", layers }, keras_version: "tfjs-layers 4.22.0", backend: "tensor_flow.js" }, names, shapes };
}

function validateSpecs(value: unknown, names: string[], shapes: number[][]): tf.io.WeightsManifestEntry[] {
  assert(Array.isArray(value) && value.length === shapes.length, "Số tensor trọng số không hợp lệ.");
  return value.map((raw, i) => {
    const spec = object(raw);
    assert(spec.name === names[i] && spec.dtype === "float32" && equalShape(spec.shape, shapes[i]) && spec.quantization === undefined && spec.group === undefined, "Tên hoặc kích thước trọng số không hợp lệ.");
    return { name: names[i], dtype: "float32", shape: shapes[i].slice() };
  });
}

async function sha256(data: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), b => b.toString(16).padStart(2, "0")).join("");
}

function weightBytes(data: tf.io.WeightData | undefined): ArrayBuffer {
  assert(data !== undefined, "Thiếu trọng số mô hình.");
  const chunks = Array.isArray(data) ? data : [data];
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  assert(size > 0 && size <= WEIGHTS_LIMIT, "Trọng số mô hình vượt giới hạn.");
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

function validateWeights(data: ArrayBuffer, specs: tf.io.WeightsManifestEntry[]) {
  const expected = specs.reduce((sum, spec) => sum + spec.shape.reduce((product, size) => product * size, 1) * 4, 0);
  assert(data.byteLength === expected, "Dung lượng trọng số không khớp với mô hình.");
  assert(new Float32Array(data).every(Number.isFinite), "Trọng số mô hình chứa giá trị không hợp lệ.");
}

export async function packModelArchive(artifacts: tf.io.ModelArtifacts, rawMetadata: ModelMetadata): Promise<Blob> {
  const metadata = validateModelMetadata(rawMetadata);
  const architecture = validateTopology(artifacts.modelTopology, metadata.summary.labels.length, metadata.summary.recognitionVersion);
  const weightSpecs = validateSpecs(artifacts.weightSpecs, architecture.names, architecture.shapes);
  const data = weightBytes(artifacts.weightData); validateWeights(data, weightSpecs);
  const manifest = JSON.stringify({ format: FORMAT, version: VERSION, featureVersion: FEATURE_VERSION, timeSteps: TIME_STEPS,
    featureCount: FEATURE_COUNT, modelTopology: architecture.topology, weightSpecs, weightBytes: data.byteLength, weightsSha256: await sha256(data), metadata });
  assert(new TextEncoder().encode(manifest).byteLength <= JSON_LIMIT, "Thông tin mô hình vượt giới hạn xuất.");
  const zip = new JSZip(); zip.file("model.json", manifest); zip.file("weights.bin", data);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: "application/zip" });
}

/** Enforce actual streamed decompressed sizes, not just untrusted ZIP headers. */
async function readBounded(entry: JSZip.JSZipObject, limit: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []; let size = 0, finished = false;
    // Present in JSZip 3.10, but omitted from its JSZipObject declaration.
    const stream = (entry as JSZip.JSZipObject & {
      internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
    }).internalStream("uint8array");
    stream.on("data", chunk => {
      if (finished) return;
      size += chunk.byteLength;
      if (size > limit) { finished = true; stream.pause(); reject(new Error("Dữ liệu mô hình giải nén vượt giới hạn.")); return; }
      chunks.push(chunk);
    });
    stream.on("error", error => { if (!finished) { finished = true; reject(error); } });
    stream.on("end", () => {
      if (finished) return; finished = true;
      const data = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      resolve(data.buffer);
    });
    stream.resume();
  });
}

export async function unpackModelArchive(file: Blob): Promise<{ artifacts: tf.io.ModelArtifacts; metadata: ModelMetadata }> {
  assert(file.size > 0 && file.size <= MODEL_ARCHIVE_LIMIT, "Tệp mô hình phải nhỏ hơn 16 MB.");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
  catch { throw new Error("Tệp ZIP mô hình không hợp lệ."); }
  const entries = Object.values(zip.files);
  assert(entries.length === 2 && entries.every(entry => !entry.dir && ["model.json", "weights.bin"].includes(entry.name) && (!entry.unsafeOriginalName || entry.unsafeOriginalName === entry.name)), "Tệp phải chứa đúng model.json và weights.bin.");
  const json = zip.file("model.json"), weights = zip.file("weights.bin");
  assert(json && weights, "Thiếu thông tin hoặc trọng số mô hình.");
  let manifest: ObjectMap;
  try { manifest = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBounded(json, JSON_LIMIT)))); }
  catch { throw new Error("model.json không hợp lệ hoặc vượt giới hạn."); }
  assert(manifest.format === FORMAT && manifest.version === VERSION, "Định dạng hoặc phiên bản tệp mô hình không được hỗ trợ.");
  assert(manifest.featureVersion === FEATURE_VERSION && manifest.timeSteps === TIME_STEPS && manifest.featureCount === FEATURE_COUNT, "Phiên bản đặc trưng của mô hình không tương thích.");
  const metadata = validateModelMetadata(manifest.metadata);
  const architecture = validateTopology(manifest.modelTopology, metadata.summary.labels.length, metadata.summary.recognitionVersion);
  const weightSpecs = validateSpecs(manifest.weightSpecs, architecture.names, architecture.shapes);
  const data = await readBounded(weights, WEIGHTS_LIMIT);
  validateWeights(data, weightSpecs);
  assert(manifest.weightBytes === data.byteLength && text(manifest.weightsSha256, 64) && await sha256(data) === manifest.weightsSha256, "Trọng số mô hình bị hỏng hoặc không khớp mã kiểm tra.");
  return { artifacts: { modelTopology: architecture.topology, weightSpecs, weightData: data, format: "layers-model" }, metadata };
}
