import { createHash, timingSafeEqual } from "node:crypto";
import {
  deleteFiles,
  downloadFile,
  listFiles,
  uploadFiles,
} from "@huggingface/hub";
import type { Sample } from "../src/types";
import { packDataset } from "../src/lib/dataset";
import { validateImport } from "../src/lib/storage";
import { isCustomWordId, VIDEO_GOAL } from "../src/lib/words";

const CLIP_LIMIT = 480_000;
const REQUEST_LIMIT = 4_000_000;
const noCache = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: noCache });
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,100}$/.test(id);

function validKey(request: Request, hash: string) {
  const auth = request.headers.get("authorization") ?? "";
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(auth) || !/^[a-f0-9]{64}$/.test(hash))
    return false;
  return timingSafeEqual(
    createHash("sha256").update(auth.slice(7)).digest(),
    Buffer.from(hash, "hex"),
  );
}

function missing(error: unknown) {
  return (
    (error as { statusCode?: number; status?: number })?.statusCode === 404 ||
    (error as { status?: number })?.status === 404
  );
}

async function validVideo(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (file.type.startsWith("video/webm"))
    return (
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
    );
  if (file.type.startsWith("video/mp4"))
    return String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
  return false;
}

export default {
  async fetch(request: Request) {
    const hash = process.env.NOI_CLOUD_KEY_SHA256;
    const accessToken = process.env.NOI_HF_ACCESS_TOKEN;
    const name = process.env.NOI_HF_BUCKET;
    if (!hash || !accessToken || !name)
      return json({ error: "Kho mẫu chưa được kết nối." }, 503);
    if (!validKey(request, hash))
      return json({ error: "Mã kho không đúng." }, 401);

    const url = new URL(request.url);
    const label = url.searchParams.get("label") ?? "";
    const id = url.searchParams.get("id");
    if (
      !(
        label === "NO_SIGN" ||
        /^NOI\d{4}$/.test(label) ||
        isCustomWordId(label)
      ) ||
      (id !== null && !validId(id))
    )
      return json({ error: "Nhãn hoặc mã mẫu không hợp lệ." }, 400);

    const repo = { type: "bucket" as const, name };
    const folder = `clips/${label}`;
    const path = `${folder}/${id}.zip`;
    const completion = `completed/${label}.json`;
    const credentials = { repo, accessToken };
    async function entries() {
      const rows: { id: string; bytes: number }[] = [];
      try {
        for await (const item of listFiles({ ...credentials, path: folder })) {
          const filename = item.path.split("/").at(-1) ?? "";
          if (
            item.type === "file" &&
            filename.endsWith(".zip") &&
            validId(filename.slice(0, -4))
          ) {
            rows.push({ id: filename.slice(0, -4), bytes: item.size });
          }
        }
      } catch (e) {
        if (!missing(e)) throw e;
      }
      return rows;
    }
    async function completedLabels() {
      const labels: string[] = [];
      try {
        for await (const item of listFiles({
          ...credentials,
          path: "completed",
        })) {
          if (item.type === "file" && item.path.endsWith(".json")) {
            labels.push(item.path.slice("completed/".length, -5));
          }
        }
      } catch (e) {
        if (!missing(e)) throw e;
      }
      return labels;
    }

    try {
      if (request.method === "GET") {
        if (!id) {
          const [samples, completed] = await Promise.all([
            entries(),
            completedLabels(),
          ]);
          return json({ samples, completed, goal: VIDEO_GOAL });
        }
        const archive = await downloadFile({ ...credentials, path });
        if (!archive) return json({ error: "Không tìm thấy mẫu." }, 404);
        return new Response(archive, {
          headers: { ...noCache, "Content-Type": "application/zip" },
        });
      }
      if (request.method === "DELETE" && id) {
        const rows = await entries();
        if (!rows.some((row) => row.id === id))
          return json({ error: "Không tìm thấy mẫu." }, 404);
        const paths = rows.length === VIDEO_GOAL ? [path, completion] : [path];
        await deleteFiles({ ...credentials, paths });
        return json({ id });
      }
      if (request.method !== "POST" || !id)
        return json({ error: "Thao tác không hợp lệ." }, 405);

      const length = Number(request.headers.get("content-length") ?? 0);
      if (length > REQUEST_LIMIT)
        return json({ error: "Mẫu quá lớn. Quay clip ngắn hơn." }, 413);
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > REQUEST_LIMIT)
        return json({ error: "Mẫu quá lớn." }, 413);
      let sample: Sample;
      try {
        const form = await new Response(bytes, {
          headers: {
            "Content-Type": request.headers.get("content-type") ?? "",
          },
        }).formData();
        const record = form.get("sample");
        const video = form.get("video");
        if (
          typeof record !== "string" ||
          !(video instanceof File) ||
          !video.size ||
          !(await validVideo(video))
        )
          throw new Error();
        const raw = JSON.parse(record);
        if (raw?.id !== id || raw.labelId !== label) throw new Error();
        [sample] = validateImport(
          { schema: 1, samples: [raw] },
          new Set([label]),
        );
        sample.videoBlob = video;
      } catch {
        return json({ error: "Video hoặc dữ liệu tay không hợp lệ." }, 400);
      }

      const archive = await packDataset([sample], true);
      if (archive.size > CLIP_LIMIT)
        return json(
          { error: "Gói mẫu vượt 480 KB. Quay clip 2 giây để lưu kho." },
          413,
        );
      const rows = await entries();
      if (rows.some((row) => row.id === id)) return json({ id, exists: true });
      if (rows.length >= VIDEO_GOAL)
        return json({ error: "Nhãn đã đủ 30 video trong kho." }, 409);
      const files = [{ path, content: archive }];
      if (rows.length === VIDEO_GOAL - 1)
        files.push({
          path: completion,
          content: new Blob(
            [JSON.stringify({ labelId: label, videos: VIDEO_GOAL })],
            { type: "application/json" },
          ),
        });
      await uploadFiles({ ...credentials, files });
      return json({ id, bytes: archive.size }, 201);
    } catch (error) {
      if (missing(error)) return json({ error: "Không tìm thấy mẫu." }, 404);
      return json({ error: "Kho mẫu tạm thời không phản hồi." }, 502);
    }
  },
};
