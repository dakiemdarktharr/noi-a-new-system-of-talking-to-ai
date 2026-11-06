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
  const [connectionError, setConnectionError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const connection = useRef(0);
  const inFlight = useRef(false);
  const retries = useRef(new Map<string, { count: number; at: number }>());
  const sessionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sessionFailures = useRef(0);

  const refreshSession = useCallback(async () => {
    const version = ++connection.current;
    clearTimeout(sessionTimer.current);
    try {
      const active = await archiveSession();
      if (version !== connection.current) return;
      sessionFailures.current = 0;
      setConnectionError("");
      setConnected(active);
    } catch (error) {
      if (version !== connection.current) return;
      setConnectionError(error instanceof Error ? error.message : "Không kết nối được kho.");
      const delay = Math.min(60_000, 5000 * 2 ** Math.min(sessionFailures.current++, 4));
      sessionTimer.current = setTimeout(() => void refreshSession(), delay);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
    const onOnline = () => {
      setOnline(true);
      retries.current.clear();
      setRevision((n) => n + 1);
      void refreshSession();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      connection.current++;
      clearTimeout(sessionTimer.current);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refreshSession]);

  async function connect(code: string) {
    connection.current++;
    clearTimeout(sessionTimer.current);
    await archiveRequest("POST", { action: "connect" }, undefined, code);
    if (!(await archiveSession()))
      throw new Error(
        "Trình duyệt không giữ được phiên kho. Mở Nối trong tab thường rồi kết nối lại.",
      );
    retries.current.clear();
    setConnectionError("");
    setConnected(true);
    setRevision((n) => n + 1);
  }

  async function disconnect() {
    connection.current++;
    clearTimeout(sessionTimer.current);
    await archiveRequest("POST", { action: "disconnect" });
    setConnected(false);
    setConnectionError("");
    setCompleted([]);
  }
  const expire = useCallback(() => {
    connection.current++;
    clearTimeout(sessionTimer.current);
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
      retries.current.delete(`${sample.labelId}/${sample.id}`);
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
      retries.current.delete(`${sample.labelId}/${sample.id}`);
    }
    setRevision((n) => n + 1);
  }

  async function queue(labelId: string, existing = new Set<string>(), limit = Infinity) {
    for (const sample of samples.filter(s => s.labelId === labelId && s.videoBlob?.size && s.backupStatus !== "saved" && !existing.has(s.id)).slice(0, limit)) {
      await mark(sample, "pending");
      retries.current.delete(`${sample.labelId}/${sample.id}`);
    }
    setRevision(n => n + 1);
  }

  useEffect(() => {
    if (!connected || !online || inFlight.current) return;
    const nextAttempt = (sample: Sample) => retries.current.get(`${sample.labelId}/${sample.id}`)?.at ?? 0;
    const sample = samples
      .filter(s => s.backupStatus === "pending" && s.videoBlob?.size)
      .sort((a, b) => nextAttempt(a) - nextAttempt(b))[0];
    if (!sample) return;
    const wait = nextAttempt(sample) - Date.now();
    if (wait > 0) {
      const timer = setTimeout(() => setRevision(n => n + 1), wait);
      return () => clearTimeout(timer);
    }
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
        if (!blocked) {
          const key = `${sample.labelId}/${sample.id}`;
          const count = (retries.current.get(key)?.count ?? 0) + 1;
          retries.current.set(key, { count, at: Date.now() + Math.min(60_000, 5000 * 2 ** Math.min(count - 1, 4)) });
        }
        await mark(sample, blocked ? "blocked" : "pending", message);
        notify(message);
      } finally {
        inFlight.current = false;
        setUploadingId(null);
      }
    })();
  }, [
    connected,
    online,
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
    connectionError,
    online,
    connect,
    disconnect,
    expire,
    uploadingId,
    revision,
    markSaved,
    markLocal,
    retry,
    queue,
  };
}
