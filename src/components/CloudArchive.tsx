import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Download, Trash2, Upload } from "lucide-react";
import { readDataset } from "../lib/dataset";
import { VIDEO_GOAL } from "../lib/words";
import {
  archiveRequest,
  ArchiveError,
  uploadArchiveSample,
} from "../lib/archive-client";
import type { Sample, VocabularyEntry } from "../types";

type RemoteSample = { id: string; bytes: number };

export function CloudArchive({
  entry,
  samples,
  connection,
  onRestore,
  onCompleted,
  notify,
}: {
  entry: VocabularyEntry;
  samples: Sample[];
  connection: ReturnType<
    typeof import("../hooks/useArchiveBackup").useArchiveBackup
  >;
  onRestore: (samples: Sample[]) => Promise<void>;
  onCompleted: (labels: string[]) => void;
  notify: (message: string) => void;
}) {
  const [remote, setRemote] = useState<RemoteSample[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [code, setCode] = useState("");
  const local = samples.filter(
    (s) => s.labelId === entry.id && s.videoBlob?.size,
  );
  const missing =
    remote?.filter((r) => !samples.some((s) => s.id === r.id)) ?? [];

  const refresh = useCallback(async () => {
    const result = (await (
      await archiveRequest("GET", { label: entry.id })
    ).json()) as {
      samples: RemoteSample[];
      completed?: string[];
    };
    setRemote(result.samples);
    if (result.completed) onCompleted(result.completed);
    return result.samples;
  }, [entry.id, onCompleted]);
  useEffect(() => {
    if (!connection.connected) {
      setRemote(null);
      return;
    }
    if (busy) return;
    void refresh().catch((e) => {
      if (e instanceof ArchiveError && e.status === 401) connection.expire();
      notify(e instanceof Error ? e.message : "Không đọc được kho.");
    });
  }, [
    connection.connected,
    connection.revision,
    connection.expire,
    busy,
    refresh,
    notify,
  ]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      if (e instanceof ArchiveError && e.status === 401 && connection.connected)
        connection.expire();
      notify(e instanceof Error ? e.message : "Không xử lý được mẫu.");
    } finally {
      setProgress("");
      setBusy(false);
    }
  }

  function connect(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await connection.connect(code);
      setCode("");
    });
  }

  async function backup() {
    const rows = await refresh();
    const batch = local
      .filter((s) => !rows.some((r) => r.id === s.id))
      .slice(0, Math.max(0, VIDEO_GOAL - rows.length));
    let saved = 0;
    try {
      for (const sample of batch) {
        setProgress(`${saved + 1}/${batch.length}`);
        const { complete } = await uploadArchiveSample(sample);
        await connection.markSaved(sample, complete);
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
      const zip = await (
        await archiveRequest("GET", { label: entry.id, id: row.id })
      ).blob();
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
      {connection.connected ? (
        <div className="cloud-actions">
          <span role="status">Tự sao lưu bật</span>
          <button
            className="secondary"
            disabled={busy || !!connection.uploadingId}
            onClick={() => void run(connection.disconnect)}
          >
            Ngắt kết nối
          </button>
        </div>
      ) : (
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
      )}
      {remote && (
        <div className="cloud-actions">
          <button
            className="primary"
            disabled={
              busy ||
              !!connection.uploadingId ||
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
          {local.some((s) => s.backupError) && (
            <button
              className="secondary"
              disabled={busy || !!connection.uploadingId}
              onClick={() => void run(() => connection.retry(entry.id))}
            >
              Thử sao lưu lại
            </button>
          )}
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
                      await archiveRequest("DELETE", {
                        label: entry.id,
                        id: row.id,
                      });
                      const sample = local.find((s) => s.id === row.id);
                      if (sample?.backupStatus === "saved")
                        await connection.markLocal(sample);
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
