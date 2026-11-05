import type { Sample, Frame, HandFeature } from "../types";
import { quality } from "./recognizer";
import { isCustomWordId } from "./words";
const DB = "noi-studio-v1",
  STORE = "samples";
function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function operation<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    let result: T;
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export const listSamples = () =>
  operation<Sample[]>("readonly", (s) => s.getAll());
export const saveSample = (sample: Sample) =>
  operation("readwrite", (s) => s.put(sample));
export const deleteSample = (id: string) =>
  operation("readwrite", (s) => s.delete(id));
export async function importSamples(samples: Sample[]) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    samples.forEach((sample) => tx.objectStore(STORE).put(sample));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
const numbers = (x: unknown, size: number): x is number[] =>
  Array.isArray(x) &&
  x.length === size &&
  x.every(
    (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 10000,
  );
function validHand(h: HandFeature) {
  return (
    h &&
    ["Left", "Right"].includes(h.side) &&
    numbers(h.shape, 63) &&
    numbers(h.quaternion, 4) &&
    Math.abs(Math.hypot(...h.quaternion) - 1) < 0.02 &&
    numbers(h.wrist, 3) &&
    numbers(h.forward, 3) &&
    numbers(h.normal, 3) &&
    numbers(h.radial, 3) &&
    numbers(h.curls, 5) &&
    [h.score, h.roll, h.elevation, h.spread].every(Number.isFinite) &&
    h.landmarks?.length === 21 &&
    h.world?.length === 21 &&
    [...h.landmarks, ...h.world].every(
      (p) =>
        p &&
        [p.x, p.y, p.z].every((v) => Number.isFinite(v) && Math.abs(v) < 10000),
    )
  );
}
export function validateImport(
  value: unknown,
  knownIds: Set<string>,
): Sample[] {
  if (!value || typeof value !== "object")
    throw new Error("Không phải tệp dữ liệu Nối.");
  const data = value as { schema?: number; samples?: Sample[] };
  if (
    data.schema !== 1 ||
    !Array.isArray(data.samples) ||
    data.samples.length > 1000
  )
    throw new Error("Sai phiên bản hoặc quá 1.000 mẫu mỗi lần nhập.");
  return data.samples.map((s) => {
    if (
      !s ||
      s.schema !== 1 ||
      (!knownIds.has(s.labelId) && !isCustomWordId(s.labelId)) ||
      typeof s.id !== "string" ||
      !s.id.length ||
      s.id.length > 100 ||
      typeof s.label !== "string" ||
      s.label.length > 150 ||
      (isCustomWordId(s.labelId) && (!s.label.trim() || s.label.length > 80)) ||
      typeof s.sessionId !== "string" ||
      !s.sessionId.length ||
      s.sessionId.length > 100 ||
      typeof s.createdAt !== "string" ||
      !Number.isFinite(Date.parse(s.createdAt)) ||
      !Array.isArray(s.frames) ||
      s.frames.length > 300 ||
      !s.frames.length ||
      !Number.isFinite(s.durationMs) ||
      s.durationMs < 0 ||
      s.durationMs > 10000
    )
      throw new Error("Mẫu có nhãn hoặc cấu trúc không hợp lệ.");
    let previous = -Infinity;
    for (const frame of s.frames) {
      if (
        !Number.isFinite(frame.t) ||
        frame.t < 0 ||
        frame.t <= previous ||
        !Array.isArray(frame.hands) ||
        frame.hands.length > 2 ||
        !frame.hands.every(validHand) ||
        new Set(frame.hands.map((h) => h.side)).size !== frame.hands.length
      )
        throw new Error("Landmark hoặc mốc thời gian không hợp lệ.");
      previous = frame.t;
    }
    if (!quality(s.frames).valid || s.frames.at(-1)!.t > 10000)
      throw new Error(
        "Tệp chứa mẫu thiếu tracking hoặc thời lượng không hợp lệ.",
      );
    // JSON cannot supply a trusted Blob; only the validated ZIP path may attach one.
    return {
      id: s.id,
      labelId: s.labelId,
      label: s.label,
      createdAt: s.createdAt,
      sessionId: s.sessionId,
      schema: 1,
      durationMs: s.frames.at(-1)!.t - s.frames[0].t,
      frames: s.frames.map((f: Frame) => ({ t: f.t, hands: f.hands })),
      ...(s.trackingVariant === "lite" || s.trackingVariant === "full"
        ? { trackingVariant: s.trackingVariant }
        : {}),
      ...(typeof s.aspect === "number" && s.aspect > 0.2 && s.aspect < 5
        ? { aspect: s.aspect }
        : {}),
    };
  });
}
export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
