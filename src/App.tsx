import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Circle,
  Square,
  ScanLine,
  Plus,
  ArrowUpRight,
  Download,
  Upload,
  Search,
  X,
  Trash2,
  Play,
  BookOpen,
  SlidersHorizontal,
  RotateCw,
  Check,
  Loader2,
  ChevronDown,
  Copy,
  Hand,
  Cloud,
} from "lucide-react";
import vocabulary from "./data/vocabulary.json";
import type { Frame, Sample, Recognition, VocabularyEntry } from "./types";
import { useCamera, type TrackingVariant } from "./hooks/useCamera";
import { useArchiveBackup } from "./hooks/useArchiveBackup";
import { Overlay } from "./components/Overlay";
import { Modal } from "./components/Modal";
import { CloudArchive } from "./components/CloudArchive";
import {
  customWord,
  isCustomWordId,
  loadCustomWords,
  saveCustomWords,
  VIDEO_GOAL,
  wordKey,
} from "./lib/words";
import {
  direction,
  degrees,
  quaternionDistance,
  extractHand,
} from "./lib/geometry";
import { SignSegmenter } from "./lib/motion";
import { DEFAULT_MEANINGS, MeaningCycleGesture, nextMeaning } from "./lib/meaning-cycle";
import { diagnoseSamples } from "./lib/diagnostics";
import { quality } from "./lib/recognizer";
import { fixtureHand } from "./lib/fixtures";
import {
  listSamples,
  saveSample,
  deleteSample,
  importSamples,
  clearSamples,
  mergeSamples,
} from "./lib/storage";
import { exportDataset, readDataset, saveBlob } from "./lib/dataset";
import {
  TemporalClassifier,
  type ModelSummary,
  type TrainProgress,
} from "./lib/temporal";

const rest: VocabularyEntry = {
  id: "NO_SIGN",
  label: "Không ký hiệu",
  group: "Mẫu nền",
  level: 0,
  aliases: ["nghỉ"],
  definition: "Tay xuất hiện nhưng không thực hiện ký hiệu.",
  status: "Chưa có mẫu",
};
const builtinEntries: VocabularyEntry[] = [rest, ...vocabulary.entries];
const normalized = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
const empty: Recognition = { accepted: false, reason: "", matches: [] };
type Recording = {
  start: number;
  end: number;
  frames: Frame[];
  entry: VocabularyEntry;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  sessionId: string;
  aborted: boolean;
  started: boolean;
  aspect: number;
  trackingVariant: TrackingVariant;
  gestureKind?: "static" | "dynamic";
};

export default function App() {
  const [view, setView] = useState<"recognize" | "collect">("recognize"),
    [samples, setSamples] = useState<Sample[]>([]);
  const [selected, setSelected] = useState<VocabularyEntry>(
      builtinEntries.find((e) => e.label === "tôi")!,
    ),
    [drawer, setDrawer] = useState(false),
    [query, setQuery] = useState(""),
    [group, setGroup] = useState("all"),
    [page, setPage] = useState(0);
  const [notice, setNotice] = useState(""),
    [recording, setRecording] = useState(false),
    [countdown, setCountdown] = useState(0),
    [duration, setDuration] = useState(3);
  const [training, setTraining] = useState(false),
    [progress, setProgress] = useState<TrainProgress | null>(null),
    [summary, setSummary] = useState<ModelSummary | null>(null);
  const [savingClip, setSavingClip] = useState(false);
  const [unsavedClips, setUnsavedClips] = useState<string[]>([]);
  const [busyModelFile, setBusyModelFile] = useState(false);
  const [diagnosticProgress, setDiagnosticProgress] = useState("");
  const [diagnosticReport, setDiagnosticReport] = useState<Awaited<ReturnType<typeof diagnoseSamples>> | null>(null);
  const [recognitionReason, setRecognitionReason] = useState("Chờ ký hiệu");
  const [result, setResult] = useState<Recognition>(empty),
    [mirrored, setMirrored] = useState(true),
    [details, setDetails] = useState(false),
    [phrase, setPhrase] = useState(""),
    [aspect, setAspect] = useState(16 / 9);
  const [preview, setPreview] = useState<string | null>(null),
    [lab, setLab] = useState(false),
    [labAngle, setLabAngle] = useState(0),
    [busyFile, setBusyFile] = useState(false),
    [relabelId, setRelabelId] = useState<string | null>(null);
  const [datasetScope, setDatasetScope] = useState("all");
  const [resetting, setResetting] = useState(false);
  const [busyCloud, setBusyCloud] = useState(false);
  const samplesRef = useRef(samples); samplesRef.current = samples;
  const [showMeanings, setShowMeanings] = useState(false), [meaningText, setMeaningText] = useState("");
  const [meanings, setMeanings] = useState<Record<string, string[]>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("noi-meanings-v1") || "null");
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return DEFAULT_MEANINGS;
      return Object.fromEntries(Object.entries(stored).filter(([, row]) => Array.isArray(row) && row.length >= 2 && row.length <= 12 && row.every(v => typeof v === "string" && v.length > 0 && v.length <= 80))) as Record<string, string[]>;
    } catch { return DEFAULT_MEANINGS; }
  });
  const meaningsRef = useRef(meanings); meaningsRef.current = meanings;
  const cycle = useRef(new MeaningCycleGesture());
  const cycleWord = useRef<{ prediction: Recognition; meanings: string[]; index: number } | null>(null);
  const [customEntries, setCustomEntries] = useState(loadCustomWords);
  const [newWord, setNewWord] = useState(false),
    [wordText, setWordText] = useState("");
  const [gestureKinds, setGestureKinds] = useState<Record<string, "static" | "dynamic">>(() => {
    try {
      const value = JSON.parse(localStorage.getItem("noi-gesture-kinds-v1") || "{}");
      return Object.fromEntries(Object.entries(value).filter(([, kind]) => kind === "static" || kind === "dynamic")) as Record<string, "static" | "dynamic">;
    } catch { return {}; }
  });
  const [showCloud, setShowCloud] = useState(false);
  const [cloudCompleted, setCloudCompleted] = useState<string[]>([]);
  const [onlyComplete, setOnlyComplete] = useState(false);
  const [trackingVariant, setTrackingVariant] =
    useState<TrackingVariant>("lite");
  const entries = useMemo(
    () => [...builtinEntries, ...customEntries],
    [customEntries],
  );
  const entriesRef = useRef(entries); entriesRef.current = entries;
  const wordCount = entries.length - 1;
  const model = useRef(new TemporalClassifier()),
    segmenter = useRef(new SignSegmenter()),
    lastPredict = useRef(0),
    predictBusy = useRef(false),
    mode = useRef(view),
    recordRef = useRef<Recording | null>(null),
    session = useRef(crypto.randomUUID());
  const predictionExpiry = useRef(0),
    alive = useRef(true),
    predictionVersion = useRef(0),
    cameraAspect = useRef(16 / 9),
    fileInput = useRef<HTMLInputElement>(null),
    modelInput = useRef<HTMLInputElement>(null),
    requestedPersistence = useRef(false),
    dialog = useRef<HTMLDialogElement>(null);
  mode.current = view;
  const notify = useCallback((text: string) => setNotice(text), []);
  const archive = useArchiveBackup(
    samples,
    setSamples,
    setCloudCompleted,
    notify,
  );
  const clearPrediction = useCallback(() => {
    predictionVersion.current++;
    clearTimeout(predictionExpiry.current);
    segmenter.current.reset();
    cycle.current.reset(); cycleWord.current = null;
    setResult(empty);
    setRecognitionReason("Chờ ký hiệu");
  }, []);
  const onFrame = useCallback(
    (frame: Frame) => {
      const rec = recordRef.current;
      if (
        rec &&
        rec.started &&
        frame.t >= rec.start &&
        frame.t <= rec.end &&
        !rec.aborted
      )
        rec.frames.push({ ...frame, t: frame.t - rec.start });
      if (mode.current === "recognize") {
        const command = cycle.current.push(frame);
        if (command.consumed) {
          predictionVersion.current++;
          segmenter.current.reset();
          const word = cycleWord.current;
          if (command.presses && word) {
            word.index = nextMeaning(word.meanings, word.index, command.presses);
            setResult({ ...word.prediction, matches: [{ ...word.prediction.matches[0], label: word.meanings[word.index] }] });
            setRecognitionReason(`Chuyển nghĩa ${word.index + 1}/${word.meanings.length}`);
            clearTimeout(predictionExpiry.current);
            predictionExpiry.current = window.setTimeout(() => setResult(empty), 5000);
          }
          return;
        }
      }
      const previousRevision = segmenter.current.revision;
      segmenter.current.push(frame);
      if (mode.current === "recognize" && previousRevision !== segmenter.current.revision)
        setRecognitionReason(frame.hands.length ? "Chờ tay ổn định" : "Không thấy tay");
      if (
        mode.current !== "recognize" ||
        !model.current.getSummary() ||
        predictBusy.current ||
        frame.t - lastPredict.current < 100
      ) return;
      const input = segmenter.current.candidate(true);
      if (!input) return;
      lastPredict.current = frame.t;
      predictBusy.current = true;
      const version = predictionVersion.current;
      const revision = segmenter.current.revision;
      model.current.predict(input, { allowStatic: segmenter.current.staticReady })
        .then((prediction) => {
          if (
            !alive.current ||
            mode.current !== "recognize" ||
            version !== predictionVersion.current ||
            revision !== segmenter.current.revision
          )
            return;
          setRecognitionReason(prediction.reason);
          if (!prediction.accepted) return;
          if (!segmenter.current.confirm(revision, prediction.matches[0]?.labelId)) return;
          const options = meaningsRef.current[prediction.matches[0]?.labelId];
          cycleWord.current = options?.length > 1 ? { prediction, meanings: options, index: 0 } : null;
          if (cycleWord.current) cycle.current.arm(frame); else cycle.current.reset();
          setResult(prediction);
          clearTimeout(predictionExpiry.current);
          predictionExpiry.current = window.setTimeout(
            () => setResult(empty),
            options?.length > 1 ? 5000 : 1800,
          );
        })
        .catch((e) => notify(String(e)))
        .finally(() => {
          predictBusy.current = false;
        });
    },
    [notify],
  );
  const camera = useCamera(onFrame);
  const abortRecording = useCallback(() => {
    const rec = recordRef.current;
    if (rec) {
      rec.aborted = true;
      if (rec.recorder?.state === "recording") rec.recorder.stop();
      recordRef.current = null;
    }
    setRecording(false);
    setCountdown(0);
  }, []);
  const stopCamera = () => {
    abortRecording();
    camera.stop();
    clearPrediction();
  };
  useEffect(() => {
    alive.current = true;
    listSamples()
      .then((stored) => {
        setSamples((current) => [
          ...current,
          ...stored.filter((s) => !current.some((other) => other.id === s.id)),
        ]);
        setCustomEntries(current => [...new Map([...current, ...stored.filter(s => isCustomWordId(s.labelId)).map(s => customWord(s.labelId, s.label))].map(e => [e.id, e])).values()]);
      })
      .catch(() => notify("Không mở được bộ nhớ mẫu của trình duyệt."));
    model.current
      .load()
      .then(loaded => {
        setSummary(loaded);
        if (loaded && !loaded.recognitionVersion) notify("Model cũ. Huấn luyện lại để học ký hiệu tĩnh và động.");
      })
      .catch(() => notify("Không tải được model đã lưu."));
    return () => {
      alive.current = false;
      clearTimeout(predictionExpiry.current);
      abortRecording();
    };
  }, [abortRecording, notify]);
  const unprotected = samples.some(
    (s) => unsavedClips.includes(s.id) && s.backupStatus !== "saved",
  );
  useEffect(() => {
    if (!savingClip && !recording && !unprotected) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [savingClip, recording, unprotected]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (camera.error) notify(camera.error);
  }, [camera.error, notify]);
  useEffect(() => {
    if (camera.status === "off" && recordRef.current) abortRecording();
  }, [camera.status, abortRecording]);
  useEffect(() => {
    if (camera.status !== "on") clearPrediction();
  }, [camera.status, clearPrediction]);
  useEffect(() => {
    if (drawer) dialog.current?.showModal();
    else dialog.current?.close();
  }, [drawer]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    samples.forEach((s) => map.set(s.labelId, (map.get(s.labelId) || 0) + 1));
    return map;
  }, [samples]);
  const videoCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const sample of samples)
      if (sample.videoBlob?.size)
        map.set(sample.labelId, (map.get(sample.labelId) ?? 0) + 1);
    for (const label of cloudCompleted)
      map.set(label, Math.max(map.get(label) ?? 0, VIDEO_GOAL));
    return map;
  }, [samples, cloudCompleted]);
  const selectedVideos = videoCounts.get(selected.id) ?? 0;
  const completed = useMemo(
    () =>
      entries.reduce(
        (total, entry) =>
          total +
          Number(
            entry.id !== rest.id &&
              (videoCounts.get(entry.id) ?? 0) >= VIDEO_GOAL,
          ),
        0,
      ),
    [entries, videoCounts],
  );
  const sessions = useMemo(
    () => [...new Set(samples.map((sample) => sample.sessionId))],
    [samples],
  );
  const visibleSamples = useMemo(() => {
    if (datasetScope === "label")
      return samples.filter((sample) => sample.labelId === selected.id);
    if (datasetScope.startsWith("session:"))
      return samples.filter(
        (sample) => sample.sessionId === datasetScope.slice(8),
      );
    return samples;
  }, [samples, selected.id, datasetScope]);
  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (group === "all" || e.group === group) &&
          (!onlyComplete || (videoCounts.get(e.id) ?? 0) >= VIDEO_GOAL) &&
          normalized([e.label, ...e.aliases].join(" ")).includes(
            normalized(query),
          ),
      ),
    [entries, group, query, onlyComplete, videoCounts],
  );
  const predicted = result.accepted ? result.matches[0] : null;
  const finishRecording = useCallback(
    async (rec: Recording) => {
      if (rec.aborted) return;
      const checked = quality(rec.frames);
      if (!checked.valid) {
        notify(checked.reason);
        return;
      }
      const blob = new Blob(rec.chunks, {
        type: rec.recorder?.mimeType || "video/webm",
      });
      if (blob.size === 0) {
        notify("Video rỗng. Mẫu chưa được lưu.");
        return;
      }
      const sample: Sample = {
        id: crypto.randomUUID(),
        labelId: rec.entry.id,
        label: rec.entry.label,
        createdAt: new Date().toISOString(),
        sessionId: rec.sessionId,
        durationMs: checked.duration,
        frames: rec.frames,
        schema: 1,
        videoBlob: blob,
        videoMime: blob.type,
        aspect: rec.aspect,
        trackingVariant: rec.trackingVariant,
        gestureKind: rec.gestureKind,
        backupStatus: "pending",
      };
      try {
        await saveSample(sample);
        notify("Đã lưu trên máy: " + rec.entry.label);
      } catch {
        setUnsavedClips((all) => [...all, sample.id]);
        notify(
          "Chưa ghi được vào trình duyệt. Hãy giữ tab mở và sao lưu hoặc xuất ZIP.",
        );
      }
      setSamples((all) => [...all, sample]);
    },
    [notify],
  );
  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => {
      const rec = recordRef.current;
      if (!rec) return;
      const now = performance.now();
      if (!rec.started && now >= rec.start) {
        rec.started = true;
        rec.start = now;
        rec.end = now + duration * 1000;
        rec.recorder!.start(250);
      }
      setCountdown(
        rec.started
          ? Math.max(0, (rec.end - now) / 1000)
          : -Math.ceil((rec.start - now) / 1000),
      );
      if (rec.started && now >= rec.end) {
        setSavingClip(true);
        rec.recorder!.stop();
        recordRef.current = null;
        setRecording(false);
        setCountdown(0);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [recording, duration]);
  function startRecording() {
    if (
      !camera.streamRef.current ||
      camera.status !== "on" ||
      training ||
      savingClip ||
      busyModelFile
    )
      return;
    if (typeof MediaRecorder === "undefined") {
      notify("Trình duyệt chưa hỗ trợ quay video. Dùng Chrome hoặc Edge.");
      return;
    }
    const mime = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4",
    ].find((x) => MediaRecorder.isTypeSupported(x));
    const video = camera.videoRef.current!;
    if (!requestedPersistence.current) {
      requestedPersistence.current = true;
      void navigator.storage?.persist?.().catch(() => false);
    }
    cameraAspect.current = video.videoWidth / video.videoHeight;
    try {
      const recorder = new MediaRecorder(camera.streamRef.current, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: 650_000,
      });
      const rec: Recording = {
        start: performance.now() + 1000,
        end: 0,
        frames: [],
        entry: selected,
        recorder,
        chunks: [],
        sessionId: session.current,
        aborted: false,
        started: false,
        aspect: cameraAspect.current,
        trackingVariant,
        gestureKind: gestureKinds[selected.id],
      };
      recorder.ondataavailable = (e) => {
        if (e.data.size) rec.chunks.push(e.data);
      };
      recorder.onstop = () =>
        void finishRecording(rec).finally(() => setSavingClip(false));
      recorder.onerror = () => {
        rec.aborted = true;
        abortRecording();
        setSavingClip(false);
        notify("Không quay được video.");
      };
      recordRef.current = rec;
      setRecording(true);
      setCountdown(-1);
    } catch (e) {
      notify("Không khởi động được bộ quay: " + String(e));
    }
  }
  async function train() {
    if (busyFile || busyCloud || resetting) { notify("Đợi nhập dữ liệu hoàn tất."); return; }
    stopCamera();
    setTraining(true);
    setProgress(null);
    setResult(empty);
    setDiagnosticReport(null);
    try {
      const trained = await model.current.train(samples, setProgress, { gestureKinds });
      setSummary(trained);
      notify(
        trained.persisted
          ? "Đã huấn luyện và lưu model."
          : "Đã huấn luyện nhưng chưa lưu được model vào trình duyệt.",
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setTraining(false);
    }
  }
  async function checkSamples() {
    stopCamera();
    setBusyModelFile(true);
    setDiagnosticReport(null);
    try {
      const report = await diagnoseSamples(model.current, samples, (done, total) => setDiagnosticProgress(`${done}/${total}`));
      setDiagnosticReport(report);
      notify(`Phát lại: ${report.correct}/${report.total} mẫu khớp đúng một lần.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Không kiểm tra được mẫu.");
    } finally {
      setBusyModelFile(false);
      setDiagnosticProgress("");
    }
  }
  async function exportModel() {
    setBusyModelFile(true);
    try {
      const blob = await model.current.exportModel();
      saveBlob(blob, "noi-model.zip");
      notify(`Đã xuất model · ${Math.ceil(blob.size / 1024)} KB`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Không xuất được model.");
    } finally {
      setBusyModelFile(false);
    }
  }
  async function importModel(file: File) {
    stopCamera();
    setBusyModelFile(true);
    try {
      const loaded = await model.current.importModel(file);
      setSummary(loaded);
      setView("recognize");
      notify(
        !loaded.recognitionVersion
          ? "Đã nhập model cũ. Huấn luyện lại để học ký hiệu tĩnh và động."
          : loaded.persisted ? "Đã nhập và lưu model." : "Đã nhập model cho phiên này.",
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "Không nhập được model.");
    } finally {
      setBusyModelFile(false);
    }
  }
  async function remove(sample: Sample) {
    if (archive.uploadingId === sample.id) return;
    try {
      await deleteSample(sample.id);
      setSamples((all) => all.filter((s) => s.id !== sample.id));
      notify("Đã xóa mẫu. Model hiện tại chỉ đổi khi huấn luyện lại.");
    } catch {
      notify("Không xóa được mẫu.");
    }
  }
  async function chooseLabel(entry: VocabularyEntry) {
    if (busyFile || busyCloud || resetting) { notify("Đợi nhập dữ liệu hoàn tất."); return; }
    const target = samples.find((s) => s.id === relabelId);
    setDrawer(false);
    setRelabelId(null);
    if (target) {
      if (target.labelId === entry.id) return;
      try {
        if (archive.uploadingId === target.id) {
          notify("Đợi mẫu gửi xong rồi đổi nhãn.");
          return;
        }
        const updated: Sample = {
          ...target,
          labelId: entry.id,
          label: entry.label,
          backupStatus:
            target.backupStatus === "pending" ||
            target.backupStatus === "blocked"
              ? "pending"
              : undefined,
          backupError: undefined,
        };
        await saveSample(updated);
        setSamples((all) => all.map((s) => (s.id === target.id ? updated : s)));
        notify("Đã đổi nhãn. Huấn luyện lại để cập nhật model.");
      } catch {
        notify("Không lưu được nhãn mới.");
      }
    } else {
      setSelected(entry);
      tabs("collect");
    }
  }
  async function importing(file: File) {
    setBusyFile(true);
    try {
      const imported = await readDataset(
        file,
        new Set(entries.map((e) => e.id)),
      );
      await storeImported(imported);
      notify(`Đã nhập ${imported.length} mẫu.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyFile(false);
    }
  }
  async function storeImported(imported: Sample[]) {
    const known = new Map(entriesRef.current.map((entry) => [entry.id, entry]));
    const additions: VocabularyEntry[] = [];
    for (const sample of imported) {
      if (known.has(sample.labelId) && known.get(sample.labelId)!.label !== sample.label)
        throw new Error(`Mã nhãn đã dùng cho từ khác: ${sample.labelId}`);
      if (!known.has(sample.labelId) && isCustomWordId(sample.labelId)) {
        const entry = customWord(sample.labelId, sample.label);
        known.set(entry.id, entry);
        additions.push(entry);
      }
      sample.label = known.get(sample.labelId)?.label ?? sample.label;
    }
    mergeSamples(samplesRef.current, imported);
    const merged = await importSamples(imported);
    const importedIds = new Set(imported.map(s => s.id));
    setSamples(current => mergeSamples(current, merged.filter(s => importedIds.has(s.id))));
    if (additions.length) {
      const next = [...new Map([...entriesRef.current.filter(e => isCustomWordId(e.id)), ...merged.filter(s => isCustomWordId(s.labelId)).map(s => customWord(s.labelId, s.label))].map(e => [e.id, e])).values()];
      try { saveCustomWords(next); } catch { notify("Danh mục sẽ được khôi phục từ mẫu đã lưu."); }
      setCustomEntries(next);
    }
  }
  function addWord() {
    const label = wordText.normalize("NFC").trim().replace(/\s+/g, " ");
    if (!label || label.length > 80) return;
    if (entries.some((entry) => wordKey(entry.label) === wordKey(label))) {
      notify("Từ này đã có trong danh mục.");
      return;
    }
    const entry = customWord(`NOI_USER_${crypto.randomUUID()}`, label);
    const next = [...customEntries, entry];
    try {
      saveCustomWords(next);
    } catch {
      notify("Không lưu được từ mới.");
      return;
    }
    setCustomEntries(next);
    setNewWord(false);
    setWordText("");
    void chooseLabel(entry);
  }
  async function exporting() {
    setBusyFile(true);
    try {
      await exportDataset(visibleSamples.map(s => ({ ...s, gestureKind: gestureKinds[s.labelId] ?? s.gestureKind })));
      setUnsavedClips((all) =>
        all.filter((id) => !visibleSamples.some((s) => s.id === id)),
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "Không xuất được dữ liệu.");
    } finally {
      setBusyFile(false);
    }
  }
  const tabs = (target: "recognize" | "collect") => {
    if (recording) abortRecording();
    setView(target);
    clearPrediction();
  };
  async function resetLocalDataset() {
    if (!window.confirm("Xóa toàn bộ mẫu và model trên trình duyệt này?")) return;
    setResetting(true);
    stopCamera();
    try {
      await archive.pauseAndDrain();
      await model.current.clear();
      await clearSamples();
      setSamples([]); setSummary(null); setProgress(null); setDiagnosticReport(null);
      setUnsavedClips([]); setCloudCompleted([]); setPreview(null); setPhrase(""); setDatasetScope("all");
      session.current = crypto.randomUUID();
      notify("Đã xóa mẫu và model trên máy.");
    } catch (error) { notify(error instanceof Error ? error.message : "Không xóa được dữ liệu."); }
    finally { archive.resume(); setResetting(false); }
  }
  const mathA = extractHand(fixtureHand(0))!,
    mathB = extractHand(fixtureHand(labAngle))!;
  const shapeDelta = Math.sqrt(
    mathA.shape.reduce((sum, x, i) => sum + (x - mathB.shape[i]) ** 2, 0) / 63,
  );
  return (
    <div className="app">
      <header className="topbar">
        <a href="#workspace" className="skip-link">
          Đến khu vực làm việc
        </a>
        <a
          href="#"
          className="brand"
          aria-label="Nối, nhận diện"
          onClick={(e) => {
            e.preventDefault();
            tabs("recognize");
          }}
        >
          <span className="brand-symbol">
            <i />
            <i />
          </span>
          Nối<span className="beta">Lab</span>
        </a>
        <nav aria-label="Khu vực làm việc">
          <button
            className={view === "recognize" ? "active" : ""}
            aria-current={view === "recognize" ? "page" : undefined}
            onClick={() => tabs("recognize")}
          >
            <ScanLine size={17} />
            Nhận diện
          </button>
          <button
            className={view === "collect" ? "active" : ""}
            aria-current={view === "collect" ? "page" : undefined}
            onClick={() => tabs("collect")}
          >
            <Circle size={17} />
            Thu mẫu
          </button>
        </nav>
        <button
          className="icon-button vocabulary-button"
          aria-label={`${wordCount} từ`}
          onClick={() => setDrawer(true)}
        >
          <BookOpen size={18} />
          <span>{wordCount.toLocaleString("vi-VN")} từ</span>
        </button>
      </header>
      <main id="workspace" tabIndex={-1} inert={resetting}>
        <div className="page-heading">
          <h1>
            {view === "recognize"
              ? "Nhận diện trực tiếp"
              : "Thu mẫu & huấn luyện"}
          </h1>
          <div className="heading-actions">
            <button className="secondary" onClick={() => {
              setMeaningText((meanings[selected.id] ?? [selected.label]).join("\n")); setShowMeanings(true);
            }}>Chuyển nghĩa</button>
            <span className={"model-state " + (summary ? "ready" : "")}>
              <i />
              {summary
                ? `${summary.labels.length} nhãn đã học`
                : "Chưa huấn luyện"}
            </span>
            <button
              className="secondary"
              aria-label="Thông số theo dõi"
              aria-pressed={details}
              onClick={() => setDetails(!details)}
            >
              <SlidersHorizontal size={18} />
              Thông số
            </button>
          </div>
        </div>
        {view === "collect" && (
          <div className="goal-strip">
            <strong>Đủ 30 video</strong>
            <div className="goal-meter">
              <progress
                max={wordCount}
                value={completed}
                aria-label="Tiến độ danh mục"
              />
              <span>
                {completed}/{wordCount.toLocaleString("vi-VN")} từ
              </span>
            </div>
          </div>
        )}
        <div className="workspace">
          <section
            className="camera-section"
            aria-label="Camera theo dõi bàn tay"
          >
            <div
              className={
                "camera-stage " + (camera.status === "off" ? "is-off" : "")
              }
              style={{ aspectRatio: aspect }}
            >
              <video
                ref={camera.videoRef}
                autoPlay
                muted
                playsInline
                style={{ transform: mirrored ? "scaleX(-1)" : "none" }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  cameraAspect.current = v.videoWidth / v.videoHeight;
                  setAspect(cameraAspect.current);
                }}
              />
              {camera.status === "on" && (
                <Overlay hands={camera.hands} mirrored={mirrored} />
              )}
              {camera.status !== "on" && (
                <div className="camera-empty">
                  {camera.status === "starting" ? (
                    <Loader2 size={34} className="spin" />
                  ) : (
                    <Camera size={38} strokeWidth={1.3} />
                  )}
                  <button
                    className="primary"
                    onClick={() => void camera.start(trackingVariant)}
                    disabled={
                      camera.status === "starting" || training || busyModelFile
                    }
                  >
                    {camera.status === "starting" ? "Đang mở…" : "Bật camera"}
                  </button>
                </div>
              )}
              {camera.status === "on" && (
                <>
                  <div className="stage-badges">
                    <span className="live-badge">
                      <i />
                      Trực tiếp
                    </span>
                    <span>{camera.hands.length} tay</span>
                  </div>
                  <div className="stage-corners" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                </>
              )}
              {view === "recognize" && camera.status === "on" && (
                <div
                  className={"prediction " + (predicted ? "detected" : "")}
                  aria-live="polite"
                >
                  <span>{predicted?.label || "—"}</span>
                  {predicted && (
                    <button
                      aria-label="Thêm từ dự đoán vào câu"
                      onClick={() =>
                        setPhrase((p) =>
                          [p, predicted.label].filter(Boolean).join(" "),
                        )
                      }
                    >
                      <Plus size={22} />
                    </button>
                  )}
                </div>
              )}
              {recording && (
                <div className="recording-indicator">
                  <i />
                  {countdown < 0
                    ? `Chuẩn bị ${Math.abs(countdown)}`
                    : countdown.toFixed(1) + " s"}
                </div>
              )}
            </div>
            <div className="camera-toolbar">
              <div className="camera-state">
                <span
                  className={"dot " + (camera.status === "on" ? "on" : "")}
                />
                {camera.status === "on"
                  ? "Camera đang bật"
                  : camera.status === "starting"
                    ? "Đang tải model"
                    : "Camera tắt"}
              </div>
              <div className="toolbar-actions">
                <button
                  className="text-button"
                  aria-pressed={mirrored}
                  onClick={() => setMirrored(!mirrored)}
                  disabled={recording}
                >
                  <RotateCw size={15} />
                  Lật hiển thị
                </button>
                {camera.status !== "off" && (
                  <button className="text-button" onClick={stopCamera}>
                    <CameraOff size={16} />
                    Tắt
                  </button>
                )}
              </div>
            </div>
            {details && (
              <div className="technical-strip">
                <select
                  aria-label="Model theo dõi tay"
                  value={trackingVariant}
                  disabled={camera.status !== "off"}
                  onChange={(e) =>
                    setTrackingVariant(e.target.value as TrackingVariant)
                  }
                >
                  <option value="lite">Lite</option>
                  <option value="full">Full</option>
                </select>
                <span>
                  {Math.round(camera.metrics.fps)}/
                  {Math.round(camera.metrics.captureFps)} fps
                </span>
                <span>{Math.round(camera.metrics.ms)} ms/frame</span>
                <span>{camera.metrics.delegate || "—"}</span>
                {view === "recognize" && <span aria-label="Trạng thái nhận diện">{recognitionReason}</span>}
                <button onClick={() => setLab(true)} className="text-button">
                  Kiểm tra rotation
                  <ArrowUpRight size={14} />
                </button>
              </div>
            )}
            {view === "recognize" && (
              <div className="composer">
                <textarea
                  aria-label="Câu đã chọn"
                  placeholder="Câu của bạn"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  rows={2}
                />
                <button
                  className="icon-button"
                  aria-label="Sao chép câu"
                  disabled={!phrase}
                  onClick={() =>
                    navigator.clipboard
                      .writeText(phrase)
                      .then(() => notify("Đã sao chép."))
                      .catch(() => notify("Không sao chép được."))
                  }
                >
                  <Copy size={18} />
                </button>
              </div>
            )}
          </section>
          <aside className="side-panel">
            {view === "recognize" ? (
              <>
                <div className="panel-header">
                  <h2>Bàn tay</h2>
                  <Hand size={18} />
                </div>
                {(["Left", "Right"] as const).map((side) => {
                  const hand = camera.hands.find((h) => h.side === side);
                  return (
                    <div key={side} className="hand-readout">
                      <div className="hand-title">
                        <span className={"side-dot " + side} />
                        <h3>{side === "Left" ? "Tay trái" : "Tay phải"}</h3>
                        <span className="hand-seen">
                          {hand ? "Đã thấy" : "—"}
                        </span>
                      </div>
                      <strong className="direction">
                        {hand ? direction(hand, mirrored) : "—"}
                      </strong>
                      <div className="angle-row">
                        <span>Xoay trong ảnh</span>
                        <b>
                          {hand
                            ? `${Math.round(hand.roll * (mirrored ? -1 : 1))}°`
                            : "—"}
                        </b>
                      </div>
                      <div className="angle-row">
                        <span>Nghiêng sâu</span>
                        <b>{hand ? `${Math.round(hand.elevation)}°` : "—"}</b>
                      </div>
                      {hand && (
                        <div className="finger-bars">
                          {["Cái", "Trỏ", "Giữa", "Áp út", "Út"].map(
                            (label, i) => (
                              <div key={label}>
                                <span>{label}</span>
                                <div>
                                  <i
                                    style={{
                                      height: `${(1 - hand.curls[i]) * 100}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="model-box">
                  <h3>Model Nối</h3>
                  <button
                    className="text-button"
                    onClick={() => tabs("collect")}
                  >
                    {summary ? "Huấn luyện lại" : "Tạo model"}
                    <ArrowUpRight size={15} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="panel-header">
                  <h2>Nhãn ký hiệu</h2>
                  <span className="count-tag">
                    {selectedVideos >= VIDEO_GOAL && (
                      <Check size={14} aria-label="Đủ 30 video" />
                    )}
                    {selectedVideos}/{VIDEO_GOAL}
                  </span>
                </div>
                <button
                  className="label-select"
                  onClick={() => setDrawer(true)}
                  disabled={recording}
                >
                  <span>{selected.label}</span>
                  <ChevronDown size={19} />
                </button>
                <progress
                  max={VIDEO_GOAL}
                  value={Math.min(selectedVideos, VIDEO_GOAL)}
                  aria-label={`Video của ${selected.label}`}
                />
                <div className="capture-settings">
                  <label htmlFor="gesture-kind">Kiểu ký hiệu</label>
                  <select
                    id="gesture-kind"
                    aria-label="Kiểu ký hiệu"
                    value={gestureKinds[selected.id] || "auto"}
                    disabled={recording || training}
                    onChange={event => {
                      const next = { ...gestureKinds };
                      const kind = event.target.value;
                      if (kind === "static" || kind === "dynamic") next[selected.id] = kind;
                      else delete next[selected.id];
                      setGestureKinds(next);
                      try { localStorage.setItem("noi-gesture-kinds-v1", JSON.stringify(next)); }
                      catch { notify("Không lưu được kiểu ký hiệu. Xuất model sau khi train để giữ thiết lập."); }
                    }}
                  >
                    <option value="auto">Tự xác định</option>
                    <option value="static">Tĩnh</option>
                    <option value="dynamic">Động</option>
                  </select>
                </div>
                <div className="word-actions">
                  <button
                    disabled={recording || training}
                    onClick={() => {
                      setWordText("");
                      setNewWord(true);
                    }}
                  >
                    <Plus size={16} />
                    Thêm từ
                  </button>
                  <button
                    disabled={recording || training}
                    aria-pressed={showCloud}
                    onClick={() => setShowCloud(!showCloud)}
                    title={
                      archive.connected ? "Tự sao lưu bật" : "Kho chưa kết nối"
                    }
                  >
                    <Cloud size={16} />
                    Kho video
                    {archive.connected && (
                      <Check size={13} aria-hidden="true" />
                    )}
                  </button>
                </div>
                <div className="capture-settings">
                  <label htmlFor="duration">Thời lượng</label>
                  <select
                    id="duration"
                    value={duration}
                    disabled={recording}
                    onChange={(e) => setDuration(Number(e.target.value))}
                  >
                    <option value={2}>2 giây</option>
                    <option value={3}>3 giây</option>
                    <option value={4}>4 giây</option>
                  </select>
                </div>
                <button
                  className={"record-button " + (recording ? "recording" : "")}
                  disabled={
                    camera.status !== "on" ||
                    training ||
                    savingClip ||
                    busyModelFile
                  }
                  onClick={recording ? abortRecording : startRecording}
                >
                  {savingClip ? (
                    <Loader2 size={18} className="spin" />
                  ) : recording ? (
                    <Square size={18} />
                  ) : (
                    <Circle size={18} />
                  )}{" "}
                  {savingClip ? "Đang lưu" : recording ? "Hủy mẫu" : "Quay mẫu"}
                </button>
                <div className="divider" />
                <div className="training-heading">
                  <h2>Huấn luyện</h2>
                  <span>{samples.length} mẫu</span>
                </div>
                <div className="training-stats">
                  <div>
                    <strong>{counts.size}</strong>
                    <span>Nhãn</span>
                  </div>
                  <div>
                    <strong>
                      {[...counts.values()].filter((n) => n >= 3).length}
                    </strong>
                    <span>Đủ 3 mẫu</span>
                  </div>
                  <div>
                    <strong>
                      {new Set(samples.map((s) => s.sessionId)).size}
                    </strong>
                    <span>Phiên thu</span>
                  </div>
                </div>
                <button
                  className="primary train-button"
                  disabled={
                    training ||
                    recording ||
                    savingClip ||
                    busyModelFile ||
                    busyFile || busyCloud || resetting ||
                    counts.size < 2 ||
                    [...counts.values()].some((n) => n < 3)
                  }
                  onClick={() => void train()}
                >
                  {training ? (
                    <Loader2 size={18} className="spin" />
                  ) : (
                    <ScanLine size={18} />
                  )}{" "}
                  {training
                    ? `Epoch ${progress?.epoch || 0}/${progress?.epochs || "…"}`
                    : "Huấn luyện model"}
                </button>
                {training && (
                  <progress
                    value={progress?.epoch || 0}
                    max={progress?.epochs || 1}
                    aria-label="Tiến trình huấn luyện"
                  />
                )}
                <button
                  className="text-button session-button"
                  disabled={recording || training}
                  onClick={() => {
                    session.current = crypto.randomUUID();
                    notify("Đã tạo phiên thu mới.");
                  }}
                >
                  <Plus size={15} />
                  Phiên thu mới
                </button>
              </>
            )}
            <div className="word-actions model-transfer">
              <input
                type="file"
                ref={modelInput}
                accept=".zip,application/zip"
                aria-label="Tệp model Nối"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importModel(file);
                  e.target.value = "";
                }}
              />
              <button
                disabled={!summary || busyModelFile || training}
                onClick={() => void exportModel()}
              >
                <Download size={16} />
                Xuất model
              </button>
              <button
                disabled={busyModelFile || training || recording || savingClip}
                onClick={() => modelInput.current?.click()}
              >
                <Upload size={16} />
                Nhập model
              </button>
              <button
                disabled={!summary || !samples.length || busyModelFile || training || recording || savingClip}
                onClick={() => void checkSamples()}
              >
                <ScanLine size={16} />
                {diagnosticProgress || "Kiểm tra mẫu"}
              </button>
            </div>
            {diagnosticReport && (
              <div className="model-transfer" aria-label="Kết quả phát lại mẫu đã lưu">
                <strong>Phát lại mẫu: {diagnosticReport.correct}/{diagnosticReport.total}</strong>
                <span>Sai: {diagnosticReport.wrong} · Lặp: {diagnosticReport.duplicate} · Bỏ sót: {diagnosticReport.unrecognized}</span>
                <button onClick={() => saveBlob(new Blob([JSON.stringify(diagnosticReport, null, 2)], { type: "application/json" }), "noi-diagnostics.json")}>
                  <Download size={16} /> Báo cáo lỗi
                </button>
              </div>
            )}
          </aside>
        </div>
        {view === "collect" && showCloud && (
          <CloudArchive
            key={selected.id}
            entry={selected}
            samples={samples}
            connection={archive}
            onRestore={(restored) =>
              storeImported(
                restored.map((sample) => ({
                  ...sample,
                  backupStatus: "saved",
                })),
              )
            }
            onCompleted={setCloudCompleted}
            onBusyChange={setBusyCloud}
            notify={notify}
          />
        )}
        {view === "collect" && (
          <section className="dataset-section">
            <div className="section-heading">
              <h2>
                Bộ dữ liệu <span>{visibleSamples.length}</span>
              </h2>
              <div>
                {samples.length > 0 && (
                  <select
                    aria-label="Lọc mẫu để xuất"
                    value={datasetScope}
                    onChange={(e) => setDatasetScope(e.target.value)}
                  >
                    <option value="all">Tất cả mẫu</option>
                    <option value="label">Nhãn đang chọn</option>
                    {sessions.map((id, index) => (
                      <option key={id} value={`session:${id}`}>
                        Phiên {index + 1}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="file"
                  ref={fileInput}
                  hidden
                  accept=".json,.zip"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importing(file);
                    e.target.value = "";
                  }}
                />
                <button
                  className="text-button"
                  disabled={busyFile || busyCloud || training || recording}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={16} />
                  Nhập
                </button>
                <button
                  className="text-button"
                  disabled={!visibleSamples.length || busyFile}
                  onClick={() => void exporting()}
                >
                  <Download size={16} />
                  Xuất ZIP
                </button>
                <button className="text-button" disabled={resetting || busyCloud || training || recording || savingClip || busyFile || busyModelFile || !!diagnosticProgress}
                  onClick={() => void resetLocalDataset()}><Trash2 size={16} />Xóa dataset trên máy</button>
              </div>
            </div>
            {visibleSamples.length ? (
              <div className="sample-table">
                <div className="table-head">
                  <span>Nhãn</span>
                  <span>Thời lượng</span>
                  <span>Frame</span>
                  <span>Video</span>
                  <span>Kho</span>
                  <span />
                </div>
                {visibleSamples
                  .slice()
                  .reverse()
                  .map((s) => (
                    <div className="sample-row" key={s.id}>
                      <button
                        className="sample-label"
                        aria-label={"Đổi nhãn " + s.label}
                        disabled={
                          training || recording || archive.uploadingId === s.id
                        }
                        onClick={() => {
                          setRelabelId(s.id);
                          setDrawer(true);
                        }}
                      >
                        {s.label}
                      </button>
                      <span>{(s.durationMs / 1000).toFixed(1)} s</span>
                      <span>{s.frames.length}</span>
                      <button
                        className="text-button"
                        disabled={!s.videoBlob}
                        aria-label={"Xem video " + s.label}
                        onClick={() => {
                          if (s.videoBlob)
                            setPreview(URL.createObjectURL(s.videoBlob));
                        }}
                      >
                        <Play size={15} />
                        Xem
                      </button>
                      <span
                        className="backup-state"
                        data-backup-status={
                          archive.uploadingId === s.id
                            ? "uploading"
                            : (s.backupStatus ?? "local")
                        }
                        title={s.backupError}
                      >
                        {archive.uploadingId === s.id
                          ? "Đang gửi"
                          : s.backupStatus === "saved"
                            ? "Đã lên kho"
                            : s.backupStatus === "blocked"
                              ? "Cần thử lại"
                              : s.backupStatus === "pending"
                                ? !archive.online ? "Chờ mạng"
                                  : archive.connectionError ? "Kho gián đoạn"
                                  : !archive.connected ? "Chờ kết nối kho"
                                  : s.backupError ? "Đang chờ thử lại" : "Chờ gửi"
                                : "Trên máy"}
                      </span>
                      <button
                        className="icon-button"
                        disabled={training || archive.uploadingId === s.id}
                        aria-label={"Xóa mẫu " + s.label}
                        onClick={() => void remove(s)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="dataset-empty">
                <Circle size={22} />
                <span>Chưa có mẫu</span>
              </div>
            )}
          </section>
        )}
      </main>
      <footer>
        <span>Xử lý trên thiết bị</span>
        <a href="/RESEARCH.md" target="_blank">
          Nghiên cứu
        </a>
        <a href="/vocabulary/NOI-VOCABULARY.md" target="_blank">
          Từ vựng
        </a>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Đóng thông báo"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className="vocabulary-dialog"
        aria-label="Từ vựng Nối"
        onClose={() => {
          setDrawer(false);
          setRelabelId(null);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setDrawer(false);
        }}
      >
        <div className="dialog-heading">
          <h2>
            {relabelId ? "Đổi nhãn" : "Từ vựng Nối"}{" "}
            <span>{wordCount.toLocaleString("vi-VN")}</span>
          </h2>
          <button
            className="icon-button"
            aria-label="Đóng từ vựng"
            onClick={() => setDrawer(false)}
          >
            <X size={21} />
          </button>
        </div>
        <div className="vocab-tools">
          <label className="search">
            <Search size={17} />
            <input
              value={query}
              aria-label="Tìm từ vựng"
              placeholder="Tìm từ"
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <select
            value={group}
            aria-label="Nhóm từ"
            onChange={(e) => {
              setGroup(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">Tất cả nhóm</option>
            {[...new Set(entries.map((e) => e.group))].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <a
            className="icon-button"
            href="/vocabulary/noi-vocabulary.csv"
            download
            aria-label="Tải từ vựng CSV"
          >
            <Download size={18} />
          </a>
        </div>
        <div className="word-actions vocab-actions">
          <button
            disabled={recording || training}
            onClick={() => {
              setDrawer(false);
              setWordText("");
              setNewWord(true);
            }}
          >
            <Plus size={16} />
            Thêm từ
          </button>
          <button
            aria-pressed={onlyComplete}
            onClick={() => {
              setOnlyComplete(!onlyComplete);
              setPage(0);
            }}
          >
            <Check size={16} />
            Đủ 30 video
          </button>
        </div>
        <div className="vocab-list">
          {filtered.slice(page * 40, (page + 1) * 40).map((entry) => {
            const videos = videoCounts.get(entry.id) ?? 0;
            const complete = videos >= VIDEO_GOAL;
            return (
              <button
                className={
                  "vocab-item " +
                  (selected.id === entry.id ? "selected " : "") +
                  (complete ? "completed" : "")
                }
                key={entry.id}
                title={entry.definition}
                onClick={() => void chooseLabel(entry)}
              >
                <span>
                  <strong>{entry.label}</strong>
                </span>
                <span className="vocab-progress">
                  <progress
                    max={VIDEO_GOAL}
                    value={Math.min(videos, VIDEO_GOAL)}
                    aria-label={`Video của ${entry.label}`}
                  />
                  <span>
                    {videos}/{VIDEO_GOAL}
                  </span>
                </span>
                {complete ? (
                  <Check size={17} aria-label="Đủ 30 video" />
                ) : (
                  <ChevronDown size={17} aria-hidden="true" />
                )}
              </button>
            );
          })}
          {!filtered.length && (
            <div className="dataset-empty">Không tìm thấy từ</div>
          )}
        </div>
        <div className="vocab-pagination">
          <span>{filtered.length} mục</span>
          <div>
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Trước
            </button>
            <span>
              {page + 1}/{Math.max(1, Math.ceil(filtered.length / 40))}
            </span>
            <button
              disabled={(page + 1) * 40 >= filtered.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Sau
            </button>
          </div>
        </div>
      </dialog>
      {showMeanings && (
        <Modal className="lab-modal" label="Chuyển nghĩa" onClose={() => setShowMeanings(false)}>
          <div className="dialog-heading"><h2>{selected.label}</h2><button className="icon-button" aria-label="Đóng chuyển nghĩa" onClick={() => setShowMeanings(false)}><X size={21} /></button></div>
          <label htmlFor="meaning-list">Chuỗi nghĩa · mỗi dòng một nghĩa</label>
          <textarea id="meaning-list" rows={5} value={meaningText} onChange={event => setMeaningText(event.target.value)} />
          <button className="primary" onClick={() => {
            const row = meaningText.split("\n").map(s => s.normalize("NFC").trim()).filter(Boolean);
            if (!row.length || row.length > 12 || row.some(s => s.length > 80) || new Set(row).size !== row.length || row[0] !== selected.label) {
              notify(`Dòng đầu phải là “${selected.label}”; tối đa 12 nghĩa khác nhau.`); return;
            }
            const next = { ...meanings }; if (row.length > 1) next[selected.id] = row; else delete next[selected.id];
            try { localStorage.setItem("noi-meanings-v1", JSON.stringify(next)); }
            catch { notify("Không lưu được chuỗi nghĩa."); return; }
            setMeanings(next); clearPrediction(); setShowMeanings(false);
          }}>Lưu</button>
        </Modal>
      )}
      {newWord && (
        <Modal
          className="new-word-modal"
          label="Thêm từ"
          onClose={() => setNewWord(false)}
        >
          <div className="dialog-heading">
            <h2>Thêm từ</h2>
            <button
              className="icon-button"
              aria-label="Đóng thêm từ"
              onClick={() => setNewWord(false)}
            >
              <X size={21} />
            </button>
          </div>
          <form
            className="field-stack"
            onSubmit={(e) => {
              e.preventDefault();
              addWord();
            }}
          >
            <label>
              Từ hoặc cụm từ
              <input
                data-dialog-focus
                maxLength={80}
                value={wordText}
                onChange={(e) => setWordText(e.target.value)}
                required
              />
            </label>
            <button className="primary" type="submit">
              <Check size={17} />
              Lưu từ
            </button>
          </form>
        </Modal>
      )}
      {preview && (
        <Modal
          className="preview-modal"
          label="Video mẫu"
          onClose={() => setPreview(null)}
        >
          <button
            className="icon-button"
            aria-label="Đóng video"
            onClick={() => setPreview(null)}
          >
            <X size={21} />
          </button>
          <video src={preview} controls autoPlay playsInline />
        </Modal>
      )}
      {lab && (
        <Modal
          className="lab-modal"
          label="Kiểm tra rotation"
          onClose={() => setLab(false)}
        >
          <div className="dialog-heading">
            <h2>Kiểm tra rotation</h2>
            <button
              className="icon-button"
              aria-label="Đóng kiểm tra"
              onClick={() => setLab(false)}
            >
              <X size={21} />
            </button>
          </div>
          <div className="lab-hand">
            <Hand
              size={105}
              strokeWidth={1.15}
              style={{ transform: `rotate(${-labAngle}deg)` }}
            />
          </div>
          <label htmlFor="lab-angle">Góc xoay {labAngle}°</label>
          <input
            id="lab-angle"
            type="range"
            min={0}
            max={180}
            value={labAngle}
            onChange={(e) => setLabAngle(Number(e.target.value))}
          />
          <button
            className="secondary"
            onClick={() => setLabAngle(labAngle === 90 ? 0 : 90)}
          >
            Xoay 90°
          </button>
          <dl>
            <div>
              <dt>Sai khác hình ngón</dt>
              <dd>{shapeDelta.toFixed(6)}</dd>
            </div>
            <div>
              <dt>Sai khác hướng</dt>
              <dd>
                {degrees(
                  quaternionDistance(mathA.quaternion, mathB.quaternion),
                ).toFixed(1)}
                °
              </dd>
            </div>
          </dl>
          <span className="count-tag">Dữ liệu hình học kiểm thử</span>
        </Modal>
      )}
    </div>
  );
}
