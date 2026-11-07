import type { Sample } from "../types";

export class ArchiveError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function archiveRequest(
  method: string,
  params: Record<string, string>,
  body?: FormData | string,
  code?: string,
) {
  const response = await fetch(`/api/archive?${new URLSearchParams(params)}`, {
    method,
    body,
    headers: { ...(code ? { Authorization: `Bearer ${code.trim()}` } : {}), ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}) },
    credentials: "same-origin",
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ArchiveError(
      data?.error ?? "Không kết nối được kho mẫu.",
      response.status,
    );
  }
  return response;
}

export async function archiveSession() {
  const data = await (
    await archiveRequest("GET", { action: "session" })
  ).json();
  return data.connected === true;
}

export async function uploadArchiveSample({
  videoBlob,
  backupStatus: _status,
  backupError: _error,
  ...sample
}: Sample) {
  if (!videoBlob?.size) throw new ArchiveError("Mẫu không có video.", 400);
  const form = new FormData();
  form.set("sample", JSON.stringify(sample));
  form.set(
    "video",
    videoBlob,
    videoBlob.type.includes("mp4") ? "clip.mp4" : "clip.webm",
  );
  const response = await archiveRequest(
    "POST",
    { label: sample.labelId, id: sample.id },
    form,
  );
  const acknowledgement = await response.json();
  if (acknowledgement?.id !== sample.id)
    throw new ArchiveError("Kho chưa xác nhận đúng mẫu. Sẽ thử gửi lại.", 502);
  return acknowledgement as { id: string; complete?: boolean };
}
