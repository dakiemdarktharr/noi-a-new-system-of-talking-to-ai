import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  archiveRequest,
  archiveSession,
  ArchiveError,
  uploadArchiveSample,
} from "../lib/archive-client";
import { updateBackupStatus } from "../lib/storage";
import type { Sample } from "../types";

export function useArchiveBackup(
  samples: Sample[],
  setSamples: Dispatch<SetStateAction<Sample[]>>,
  setCompleted: Dispatch<SetStateAction<string[]>>,
  notify: (text: string) => void,
) {
  const [connected, setConnected] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const connection = useRef(0);
  const inFlight = useRef(false);
  const attempted = useRef(new Set<string>());

  const refreshSession = useCallback(async () => {
    const version = ++connection.current;
    const active = await archiveSession().catch(() => false);
    if (version === connection.current) setConnected(active);
  }, []);

  useEffect(() => {
    void refreshSession();
    const online = () => {
      attempted.current.clear();
      setRevision((n) => n + 1);
      void refreshSession();
    };
    window.addEventListener("online", online);
    return () => {
      connection.current++;
      window.removeEventListener("online", online);
    };
  }, [refreshSession]);

  async function connect(code: string) {
    connection.current++;
    await archiveRequest("POST", { action: "connect" }, undefined, code);
    if (!(await archiveSession()))
      throw new Error(
        "Trình duyệt không giữ được phiên kho. Mở Nối trong tab thường rồi kết nối lại.",
      );
    attempted.current.clear();
    setConnected(true);
    setRevision((n) => n + 1);
  }

  async function disconnect() {
    connection.current++;
    await archiveRequest("POST", { action: "disconnect" });
    setConnected(false);
    setCompleted([]);
  }
  const expire = useCallback(() => {
    setConnected(false);
    setCompleted([]);
  }, [setCompleted]);

  const mark = useCallback(
    async (sample: Sample, status: Sample["backupStatus"], error?: string) => {
      // A cloud acknowledgement remains valid even when the browser database is full.
      // If that write fails, retry after reload is idempotent at the archive endpoint.
      await updateBackupStatus(sample.id, sample.labelId, status, error).catch(
        () => {},
      );
      setSamples((all) =>
        all.map((s) =>
          s.id === sample.id && s.labelId === sample.labelId
            ? { ...s, backupStatus: status, backupError: error }
            : s,
        ),
      );
    },
    [setSamples],
  );

  const markSaved = useCallback(
    async (sample: Sample, complete?: boolean) => {
      await mark(sample, "saved");
      if (complete)
        setCompleted((all) =>
          all.includes(sample.labelId) ? all : [...all, sample.labelId],
        );
      setRevision((n) => n + 1);
    },
    [mark, setCompleted],
  );
  const markLocal = (sample: Sample) => mark(sample, undefined);

  async function retry(labelId: string) {
    const pending = samples.filter(
      (s) =>
        s.labelId === labelId &&
        s.videoBlob?.size &&
        (s.backupStatus === "pending" || s.backupStatus === "blocked"),
    );
    for (const sample of pending) {
      await mark(sample, "pending");
      attempted.current.delete(`${sample.labelId}/${sample.id}`);
    }
    setRevision((n) => n + 1);
  }

  useEffect(() => {
    if (!connected || !navigator.onLine || inFlight.current) return;
    const sample = samples.find(
      (s) =>
        s.backupStatus === "pending" &&
        s.videoBlob?.size &&
        !attempted.current.has(`${s.labelId}/${s.id}`),
    );
    if (!sample) return;
    attempted.current.add(`${sample.labelId}/${sample.id}`);
    inFlight.current = true;
    setUploadingId(sample.id);
    void (async () => {
      try {
        const { complete } = await uploadArchiveSample(sample);
        await markSaved(sample, complete);
        notify(`Đã lên kho: ${sample.label}`);
      } catch (error) {
        const code = error instanceof ArchiveError ? error.status : 0;
        if (code === 401) expire();
        const message =
          error instanceof ArchiveError
            ? error.message
            : "Chưa gửi được kho. Mẫu vẫn nằm trên máy.";
        const blocked = code === 400 || code === 409 || code === 413;
        await mark(sample, blocked ? "blocked" : "pending", message);
        notify(message);
      } finally {
        inFlight.current = false;
        setUploadingId(null);
      }
    })();
  }, [
    connected,
    samples,
    uploadingId,
    revision,
    mark,
    markSaved,
    notify,
    expire,
  ]);

  return {
    connected,
    connect,
    disconnect,
    expire,
    uploadingId,
    revision,
    markSaved,
    markLocal,
    retry,
  };
}
