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
} from "lucide-react";
import vocabulary from "./data/vocabulary.json";
import type { Frame, Sample, Recognition, VocabularyEntry } from "./types";
import { useCamera } from "./hooks/useCamera";
import { Overlay } from "./components/Overlay";
import { Modal } from "./components/Modal";
import {
  direction,
  degrees,
  quaternionDistance,
  extractHand,
} from "./lib/geometry";
import { quality } from "./lib/recognizer";
import { fixtureHand } from "./lib/fixtures";
import {
  listSamples,
  saveSample,
  deleteSample,
  importSamples,
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
const entries: VocabularyEntry[] = [rest, ...vocabulary.entries];
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
};

export default function App() {
  const [view, setView] = useState<"recognize" | "collect">("recognize"),
    [samples, setSamples] = useState<Sample[]>([]);
  const [selected, setSelected] = useState<VocabularyEntry>(
      entries.find((e) => e.label === "tôi")!,
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
  const model = useRef(new TemporalClassifier()),
    rolling = useRef<Frame[]>([]),
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
    dialog = useRef<HTMLDialogElement>(null);
  mode.current = view;
  const notify = useCallback((text: string) => setNotice(text), []);
  const clearPrediction = useCallback(() => {
    predictionVersion.current++;
    clearTimeout(predictionExpiry.current);
    rolling.current = [];
    setResult(empty);
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
      rolling.current.push(frame);
      rolling.current = rolling.current.filter((f) => f.t >= frame.t - 4200);
      if (!frame.hands.length) predictionVersion.current++;
      if (
        mode.current !== "recognize" ||
        !model.current.getSummary() ||
        predictBusy.current ||
        frame.t - lastPredict.current < 250 ||
        !frame.hands.length
      )
        return;
      lastPredict.current = frame.t;
      predictBusy.current = true;
      const input = rolling.current.slice(),
        version = predictionVersion.current;
      const windows = [
        ...new Set(
          model.current.getSummary()!.labels.map((l) => l.windowMs || 3000),
        ),
      ];
      (async () => {
        const predictions: Recognition[] = [];
        for (const ms of windows) {
          const clip = input.filter((f) => f.t >= frame.t - ms);
          if (clip.length < 2 || clip.at(-1)!.t - clip[0].t < ms * 0.9)
            continue;
          const prediction = await model.current.predict(clip);
          const targetWindow =
            model.current
              .getSummary()
              ?.labels.find((l) => l.labelId === prediction.matches[0]?.labelId)
              ?.windowMs || 3000;
          if (targetWindow === ms) predictions.push(prediction);
        }
        return (
          predictions.sort(
            (a, b) =>
              Number(b.accepted) - Number(a.accepted) ||
              (b.matches[0]?.score || 0) - (a.matches[0]?.score || 0),
          )[0] || empty
        );
      })()
        .then((prediction) => {
          if (
            !alive.current ||
            mode.current !== "recognize" ||
            version !== predictionVersion.current
          )
            return;
          if (!prediction.accepted) return;
          // A motion can fit one window only. Keep that result briefly so it
          // remains readable as the user's hands move away or come to rest.
          setResult(prediction);
          clearTimeout(predictionExpiry.current);
          predictionExpiry.current = window.setTimeout(
            () => setResult(empty),
            1800,
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
      .then(setSamples)
      .catch(() => notify("Không mở được bộ nhớ mẫu của trình duyệt."));
    model.current
      .load()
      .then(setSummary)
      .catch(() => notify("Không tải được model đã lưu."));
    return () => {
      alive.current = false;
      clearTimeout(predictionExpiry.current);
      abortRecording();
    };
  }, [abortRecording, notify]);
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
          normalized([e.label, ...e.aliases].join(" ")).includes(
            normalized(query),
          ),
      ),
    [group, query],
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
      };
      try {
        await saveSample(sample);
        setSamples((all) => [...all, sample]);
        notify("Đã lưu mẫu: " + rec.entry.label);
      } catch {
        notify("Không lưu được mẫu. Kiểm tra dung lượng trình duyệt.");
      }
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
        rec.recorder!.stop();
        recordRef.current = null;
        setRecording(false);
        setCountdown(0);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [recording, duration]);
  function startRecording() {
    if (!camera.streamRef.current || camera.status !== "on" || training) return;
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
    cameraAspect.current = video.videoWidth / video.videoHeight;
    try {
      const recorder = new MediaRecorder(camera.streamRef.current, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: 1_500_000,
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
      };
      recorder.ondataavailable = (e) => {
        if (e.data.size) rec.chunks.push(e.data);
      };
      recorder.onstop = () => void finishRecording(rec);
      recorder.onerror = () => {
        rec.aborted = true;
        abortRecording();
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
    stopCamera();
    setTraining(true);
    setProgress(null);
    setResult(empty);
    try {
      const trained = await model.current.train(samples, setProgress);
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
  async function remove(sample: Sample) {
    try {
      await deleteSample(sample.id);
      setSamples((all) => all.filter((s) => s.id !== sample.id));
      notify("Đã xóa mẫu. Model hiện tại chỉ đổi khi huấn luyện lại.");
    } catch {
      notify("Không xóa được mẫu.");
    }
  }
  async function chooseLabel(entry: VocabularyEntry) {
    const target = samples.find((s) => s.id === relabelId);
    setDrawer(false);
    setRelabelId(null);
    if (target) {
      try {
        const updated = { ...target, labelId: entry.id, label: entry.label };
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
      imported.forEach((s) => {
        s.label = entries.find((e) => e.id === s.labelId)!.label;
      });
      await importSamples(imported);
      setSamples(await listSamples());
      notify(`Đã nhập ${imported.length} mẫu.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyFile(false);
    }
  }
  async function exporting() {
    setBusyFile(true);
    try {
      await exportDataset(visibleSamples);
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
          aria-label={`${vocabulary.count} từ`}
          onClick={() => setDrawer(true)}
        >
          <BookOpen size={18} />
          <span>{vocabulary.count} từ</span>
        </button>
      </header>
      <main id="workspace" tabIndex={-1}>
        <div className="page-heading">
          <h1>
            {view === "recognize"
              ? "Nhận diện trực tiếp"
              : "Thu mẫu & huấn luyện"}
          </h1>
          <div className="heading-actions">
            <span className={"model-state " + (summary ? "ready" : "")}>
              <i />
              {summary
                ? `${summary.labels.length} nhãn đã học`
                : "Chưa huấn luyện"}
            </span>
            <button
              className="icon-button"
              aria-label="Thông số theo dõi"
              aria-pressed={details}
              onClick={() => setDetails(!details)}
            >
              <SlidersHorizontal size={18} />
            </button>
          </div>
        </div>
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
                    onClick={() => void camera.start()}
                    disabled={camera.status === "starting" || training}
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
                <span>{Math.round(camera.metrics.fps)} fps</span>
                <span>{Math.round(camera.metrics.ms)} ms/frame</span>
                <span>{camera.metrics.delegate || "—"}</span>
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
                    {counts.get(selected.id) || 0} mẫu
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
                  disabled={camera.status !== "on" || training}
                  onClick={recording ? abortRecording : startRecording}
                >
                  {recording ? <Square size={18} /> : <Circle size={18} />}{" "}
                  {recording ? "Hủy mẫu" : "Quay mẫu"}
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
          </aside>
        </div>
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
                  disabled={busyFile || training || recording}
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
              </div>
            </div>
            {visibleSamples.length ? (
              <div className="sample-table">
                <div className="table-head">
                  <span>Nhãn</span>
                  <span>Thời lượng</span>
                  <span>Frame</span>
                  <span>Video</span>
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
                        disabled={training || recording}
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
                      <button
                        className="icon-button"
                        disabled={training}
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
            <span>{vocabulary.count}</span>
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
        <div className="vocab-list">
          {filtered.slice(page * 40, (page + 1) * 40).map((entry) => (
            <button
              className={
                "vocab-item " + (selected.id === entry.id ? "selected" : "")
              }
              key={entry.id}
              title={entry.definition}
              onClick={() => void chooseLabel(entry)}
            >
              <span>
                <strong>{entry.label}</strong>
                <span>{entry.group}</span>
              </span>
              <span className="sample-count">
                {counts.get(entry.id)
                  ? `${counts.get(entry.id)} mẫu`
                  : "Chưa có mẫu"}
              </span>
              {selected.id === entry.id ? (
                <Check size={17} />
              ) : (
                <Plus size={17} />
              )}
            </button>
          ))}
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
