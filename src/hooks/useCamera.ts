import { useCallback, useEffect, useRef, useState } from "react";
import type { Frame, RawHand, HandFeature } from "../types";
import { extractHand } from "../lib/geometry";

export type TrackingVariant = "lite" | "full";
export function useCamera(onFrame: (frame: Frame) => void) {
  const videoRef = useRef<HTMLVideoElement>(null), streamRef = useRef<MediaStream | null>(null), workerRef = useRef<Worker | null>(null);
  const callbackRef = useRef(onFrame); callbackRef.current = onFrame;
  const epoch = useRef(0), raf = useRef(0), videoCallback = useRef(0), busy = useRef(false);
  const [status, setStatus] = useState<"off" | "starting" | "on">("off"), [error, setError] = useState(""), [hands, setHands] = useState<HandFeature[]>([]);
  const [metrics, setMetrics] = useState({ fps: 0, ms: 0, delegate: "", model: "", latencyMs: 0, captureFps: 0, droppedFrames: 0 });
  const release = useCallback(() => {
    epoch.current++;
    cancelAnimationFrame(raf.current);
    if (videoCallback.current && videoRef.current?.cancelVideoFrameCallback) videoRef.current.cancelVideoFrameCallback(videoCallback.current);
    videoCallback.current = 0;
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
    workerRef.current?.terminate(); workerRef.current = null; busy.current = false;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);
  const stop = useCallback(() => { release(); setHands([]); setStatus("off"); }, [release]);
  const start = useCallback(async (variant: TrackingVariant = "lite") => {
    stop();
    const generation = epoch.current;
    setError(""); setStatus("starting");
    setMetrics({ fps: 0, ms: 0, delegate: "", model: "", latencyMs: 0, captureFps: 0, droppedFrames: 0 });
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Camera cần localhost hoặc HTTPS.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: {
        width: { ideal: 1280 }, height: { ideal: 720 },
        // Request 60 where supported; no hard 30fps ceiling for fast movements.
        frameRate: { ideal: 60 }, facingMode: "user",
      }, audio: false });
      if (generation !== epoch.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Không tìm thấy khung camera.");
      video.srcObject = stream; await video.play();
      if (generation !== epoch.current) return;
      const worker = new Worker(new URL("../workers/hand.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      let running = false, initialized = false, latestMediaTime = -1, latestCaptureTime = 0, submittedMediaTime = -1;
      let lastFrameTime = -1, dropped = 0, lastMetricsTime = 0, captured = 0;
      const resultTimes: number[] = [];
      const captureRate = stream.getVideoTracks()[0]?.getSettings().frameRate ?? 0;
      const submitLatest = () => {
        if (!running || busy.current || generation !== epoch.current || video.readyState < 2 || latestMediaTime <= submittedMediaTime) return;
        busy.current = true; submittedMediaTime = latestMediaTime;
        // Capture/presentation timestamp in the performance.now domain, never
        // inference completion time. Tasks requires strictly increasing stamps.
        const t = Math.max(lastFrameTime + .001, latestCaptureTime); lastFrameTime = t;
        createImageBitmap(video).then(bitmap => {
          if (generation !== epoch.current) { bitmap.close(); return; }
          worker.postMessage({ type: "frame", bitmap, t }, [bitmap]);
        }).catch(err => { if (generation !== epoch.current) return; setError(String(err)); stop(); });
      };
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Tải model quá lâu. Thử bật lại camera.")), 45000);
        const fail = (message: string) => {
          clearTimeout(timeout);
          if (generation !== epoch.current) return;
          if (initialized) { setError(message); stop(); } else reject(new Error(message));
        };
        worker.onerror = event => fail(event.message || "Không khởi động được model.");
        worker.onmessage = event => {
          if (generation !== epoch.current) return;
          const data = event.data;
          if (data.type === "ready") {
            clearTimeout(timeout); initialized = true;
            setMetrics(m => ({ ...m, delegate: data.delegate, model: data.model, captureFps: captureRate })); resolve();
          } else if (data.type === "error" || data.type === "frame-error") fail(data.message);
          else if (data.type === "result") {
            busy.current = false;
            const raw = data.hands as RawHand[];
            // Handedness confidence is NOT presence confidence. The model already
            // gates presence. Keep a valid rotating hand when its side score dips.
            // For duplicate-side detections keep the stronger observation; do not
            // invent the other anatomical side or discard both measured hands.
            const unique = [...new Map(raw.slice().sort((a, b) => a.score - b.score).map(hand => [hand.side, hand])).values()];
            const found = unique.map(hand => extractHand(hand, data.width / data.height)).filter((hand): hand is HandFeature => hand !== null);
            setHands(found); callbackRef.current({ t: data.t, hands: found });
            const now = performance.now(); resultTimes.push(data.t);
            while (resultTimes.length > 30) resultTimes.shift();
            if (now - lastMetricsTime >= 250) {
              const elapsed = resultTimes.at(-1)! - resultTimes[0];
              setMetrics(m => ({ ...m, ms: data.inferenceMs, latencyMs: Math.max(0, now - data.t),
                fps: elapsed > 0 ? (resultTimes.length - 1) * 1000 / elapsed : 0, droppedFrames: dropped }));
              lastMetricsTime = now;
            }
            // Sample the freshest decoded frame immediately. There is no queue
            // of stale images and no extra 32ms/requestAnimationFrame gate.
            submitLatest();
          }
        };
        worker.postMessage({ type: "init", base: location.origin, variant });
      });
      if (generation !== epoch.current) return;
      running = true; setStatus("on");
      const observeFrame = (now: number, mediaTime: number, captureTime?: number) => {
        if (mediaTime <= latestMediaTime) return;
        if (latestMediaTime > submittedMediaTime && captured > 0) dropped++;
        captured++; latestMediaTime = mediaTime;
        // rVFC captureTime is optional. Validate its clock; callback time is the
        // measured presentation-time approximation when it is unavailable.
        latestCaptureTime = captureTime != null && Number.isFinite(captureTime) && captureTime <= now && now - captureTime < 10000 ? captureTime : now;
        submitLatest();
      };
      if (typeof video.requestVideoFrameCallback === "function") {
        const next = (now: number, metadata: VideoFrameCallbackMetadata) => {
          if (generation !== epoch.current) return;
          observeFrame(now, metadata.mediaTime, metadata.captureTime);
          videoCallback.current = video.requestVideoFrameCallback(next);
        };
        videoCallback.current = video.requestVideoFrameCallback(next);
      } else {
        const loop = (now: number) => {
          if (generation !== epoch.current) return;
          observeFrame(now, video.currentTime); raf.current = requestAnimationFrame(loop);
        };
        raf.current = requestAnimationFrame(loop);
      }
    } catch (e) {
      if (generation !== epoch.current) return;
      stop(); const name = e instanceof DOMException ? e.name : "";
      setError(name === "NotAllowedError" ? "Quyền camera chưa được cấp." : name === "NotFoundError" ? "Không tìm thấy camera." : e instanceof Error ? e.message : String(e));
    }
  }, [stop]);
  useEffect(() => release, [release]);
  return { videoRef, streamRef, status, error, hands, metrics, start, stop };
}
