import type JSZip from "jszip";

/** Enforce bytes actually decompressed, not untrusted ZIP size declarations. */
export async function readZipEntry(entry: JSZip.JSZipObject, limit: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []; let size = 0, finished = false;
    const stream = (entry as JSZip.JSZipObject & {
      internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
    }).internalStream("uint8array");
    stream.on("data", chunk => {
      if (finished) return;
      size += chunk.byteLength;
      if (size > limit) { finished = true; stream.pause(); reject(new Error("Dữ liệu ZIP giải nén vượt giới hạn.")); return; }
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
