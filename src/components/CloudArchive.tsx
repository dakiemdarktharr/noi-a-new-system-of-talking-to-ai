import { useState, type FormEvent } from "react";
import { Download, Trash2, Upload } from "lucide-react";
import { readDataset } from "../lib/dataset";
import { VIDEO_GOAL } from "../lib/words";
import type { Sample, VocabularyEntry } from "../types";

type RemoteSample = { id: string; bytes: number };

export function CloudArchive({
  entry,
  samples,
  code,
  setCode,
  onRestore,
  onCompleted,
  notify,
}: {
  entry: VocabularyEntry;
  samples: Sample[];
  code: string;
  setCode: (value: string) => void;
  onRestore: (samples: Sample[]) => Promise<void>;
  onCompleted: (labels: string[]) => void;
  notify: (message: string) => void;
}) {
  const [remote, setRemote] = useState<RemoteSample[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const local = samples.filter(
    (s) => s.labelId === entry.id && s.videoBlob?.size,
  );
  const missing =
    remote?.filter((r) => !samples.some((s) => s.id === r.id)) ?? [];

  async function request(method: string, id?: string, body?: FormData) {
    const query = new URLSearchParams({ label: entry.id });
    if (id) query.set("id", id);
    const response = await fetch(`/api/archive?${query}`, {
      method,
      body,
      headers: { Authorization: `Bearer ${code.trim()}` },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error ?? "Không kết nối được kho mẫu.");
    }
    return response;
  }

  async function refresh() {
    const result = (await (await request("GET")).json()) as {
      samples: RemoteSample[];
      completed?: string[];
    };
    setRemote(result.samples);
    if (result.completed) onCompleted(result.completed);
    return result.samples;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Không xử lý được mẫu.");
    } finally {
      setProgress("");
      setBusy(false);
    }
  }

  function connect(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await refresh();
    });
  }

  async function backup() {
    const rows = await refresh();
    const batch = local
      .filter((s) => !rows.some((r) => r.id === s.id))
      .slice(0, Math.max(0, VIDEO_GOAL - rows.length));
    let saved = 0;
    try {
      for (const { videoBlob, ...sample } of batch) {
        setProgress(`${saved + 1}/${batch.length}`);
        const form = new FormData();
        form.set("sample", JSON.stringify(sample));
        form.set(
          "video",
          videoBlob!,
          videoBlob!.type.includes("mp4") ? "clip.mp4" : "clip.webm",
        );
        await request("POST", sample.id, form);
        saved++;
      }
      notify(
        saved
          ? `Đã sao lưu ${saved} video.`
          : "Các mẫu đã được lưu hoặc nhãn đã đủ 30 video.",
      );
    } finally {
      await refresh();
    }
  }

  async function restore() {
    const restored: Sample[] = [];
    for (const [index, row] of missing.entries()) {
      setProgress(`${index + 1}/${missing.length}`);
      const zip = await (await request("GET", row.id)).blob();
      restored.push(
        ...(await readDataset(
          new File([zip], "noi-clip.zip"),
          new Set([entry.id]),
        )),
      );
    }
    await onRestore(restored);
    notify(`Đã tải ${restored.length} video về máy.`);
  }

  return (
    <section className="cloud-panel" aria-label="Kho video riêng tư">
      <h2>Kho video</h2>
      <span>{entry.label}</span>
      {remote && (
        <strong>
          {remote.length}/{VIDEO_GOAL}
        </strong>
      )}
      <form onSubmit={connect}>
        <label>
          Mã kho
          <input
            type="password"
            autoComplete="off"
            value={code}
            disabled={busy}
            onChange={(e) => {
              setCode(e.target.value);
              setRemote(null);
            }}
            required
          />
        </label>
        <button className="secondary" disabled={busy || !code.trim()}>
          Kết nối
        </button>
      </form>
      {remote && (
        <div className="cloud-actions">
          <button
            className="primary"
            disabled={
              busy ||
              remote.length >= VIDEO_GOAL ||
              !local.some((s) => !remote.some((r) => r.id === s.id))
            }
            onClick={() => void run(backup)}
          >
            <Upload size={16} /> Sao lưu nhãn
          </button>
          <button
            className="secondary"
            disabled={busy || !missing.length}
            onClick={() => void run(restore)}
          >
            <Download size={16} /> Tải về máy
          </button>
          {progress && <output aria-live="polite">{progress}</output>}
        </div>
      )}
      {!!remote?.length && (
        <details className="cloud-files">
          <summary>Video trong kho</summary>
          <ul>
            {remote.map((row) => (
              <li key={row.id}>
                <span>
                  {row.id.slice(0, 8)} · {Math.round(row.bytes / 1000)} KB
                </span>
                <button
                  className="icon-button"
                  aria-label={`Xóa video ${row.id.slice(0, 8)} khỏi kho`}
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm("Xóa video này khỏi kho?")) return;
                    void run(async () => {
                      await request("DELETE", row.id);
                      await refresh();
                    });
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
