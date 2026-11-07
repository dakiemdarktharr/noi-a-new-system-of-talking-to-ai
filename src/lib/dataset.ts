import JSZip from "jszip";
import type { Sample } from "../types.js";
import { validateImport } from "./storage.js";
import { readZipEntry } from "./zip.js";
const ARCHIVE_LIMIT = 300 * 1024 * 1024;
const MANIFEST_LIMIT = 128 * 1024 * 1024;
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export async function packDataset(samples: Sample[], compact = false) {
  const sizeError =
    "Bộ dữ liệu vượt giới hạn xuất. Chọn một phiên hoặc nhãn để xuất.";
  if (samples.length > 1000) throw new Error(sizeError);
  const zip = new JSZip();
  const records = await Promise.all(
    samples.map(
      async (
        {
          videoBlob,
          backupStatus: _backupStatus,
          backupError: _backupError,
          ...sample
        },
        index,
      ) => {
        const filename = videoBlob
          ? `videos/${index}-${sample.id.replace(/[^a-z0-9_-]/gi, "_")}.${videoBlob.type.includes("mp4") ? "mp4" : "webm"}`
          : null;
        if (videoBlob && filename)
          zip.file(filename, await videoBlob.arrayBuffer());
        return { ...sample, videoFile: filename };
      },
    ),
  );
  const manifest = JSON.stringify(
    {
      schema: 1,
      name: "Nối",
      exportedAt: new Date().toISOString(),
      coordinates:
        "Unmirrored input; camera X right Y up Z towards camera; world points centered per hand",
      samples: records,
    },
    compact
      ? (_key, value: unknown) =>
          typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value
      : undefined,
  );
  const manifestBytes = new Blob([manifest]).size;
  const videoBytes = samples.reduce(
    (total, sample) => total + (sample.videoBlob?.size ?? 0),
    0,
  );
  if (
    manifestBytes > MANIFEST_LIMIT ||
    manifestBytes + videoBytes > ARCHIVE_LIMIT
  )
    throw new Error(sizeError);
  zip.file("dataset.json", manifest, { compression: "DEFLATE" });
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}
export async function exportDataset(samples: Sample[]) {
  saveBlob(await packDataset(samples), "noi-dataset.zip");
}
export async function readDataset(file: File, known: Set<string>) {
  if (file.size > ARCHIVE_LIMIT)
    throw new Error("Tệp vượt 300 MB. Hãy chia thành nhiều bộ nhỏ.");
  if (file.name.toLowerCase().endsWith(".json")) {
    if (file.size > MANIFEST_LIMIT) throw new Error("JSON vượt 128 MB.");
    return validateImport(JSON.parse(await file.text()), known);
  }
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files);
  if (entries.length > 2001) throw new Error("Bộ dữ liệu có quá nhiều tệp.");
  const sizes = entries.map(
    (e) =>
      (e as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize || 0,
  );
  if (sizes.reduce((a, b) => a + b, 0) > ARCHIVE_LIMIT)
    throw new Error("Dữ liệu giải nén vượt 300 MB.");
  const manifest = zip.file("dataset.json");
  if (!manifest) throw new Error("Thiếu dataset.json.");
  if (sizes[entries.indexOf(manifest)] > MANIFEST_LIMIT)
    throw new Error("Manifest quá lớn.");
  const manifestBuffer = await readZipEntry(manifest, MANIFEST_LIMIT);
  let remaining = ARCHIVE_LIMIT - manifestBuffer.byteLength;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(manifestBuffer);
  const data = JSON.parse(text),
    validated = validateImport(data, known);
  for (let i = 0; i < validated.length; i++) {
    const name = data.samples[i].videoFile;
    if (name) {
      if (
        typeof name !== "string" ||
        !/^videos\/[a-z0-9_-]+\.(webm|mp4)$/i.test(name)
      )
        throw new Error("Đường dẫn video không hợp lệ.");
      const video = zip.file(name);
      if (!video) throw new Error("Thiếu video của mẫu.");
      const videoBytes = await readZipEntry(video, remaining);
      remaining -= videoBytes.byteLength;
      validated[i].videoBlob = new Blob([videoBytes], {
        type: name.toLowerCase().endsWith(".mp4") ? "video/mp4" : "video/webm",
      });
    }
  }
  return validated;
}
