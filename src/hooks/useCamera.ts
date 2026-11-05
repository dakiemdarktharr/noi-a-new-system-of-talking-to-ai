import { useCallback, useEffect, useRef, useState } from "react";
import type { Frame, RawHand, HandFeature } from "../types";
import { extractHand } from "../lib/geometry";
export function useCamera(onFrame: (frame: Frame) => void) {
  const videoRef = useRef<HTMLVideoElement>(null),
    streamRef = useRef<MediaStream | null>(null),
    workerRef = useRef<Worker | null>(null);
  const callbackRef = useRef(onFrame);
  callbackRef.current = onFrame;
  const epoch = useRef(0),
    raf = useRef(0),
    busy = useRef(false);
  const [status, setStatus] = useState<"off" | "starting" | "on">("off"),
    [error, setError] = useState(""),
    [hands, setHands] = useState<HandFeature[]>([]);
  const [metrics, setMetrics] = useState({ fps: 0, ms: 0, delegate: "" });
  const stop = useCallback(() => {
    epoch.current++;
    cancelAnimationFrame(raf.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    busy.current = false;
    if (videoRef.current) videoRef.current.srcObject = null;
    setHands([]);
    setStatus("off");
  }, []);
  const start = useCallback(async () => {
    stop();
    const generation = epoch.current;
    setError("");
    setStatus("starting");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error("Camera cần localhost hoặc HTTPS.");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      if (generation !== epoch.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Không tìm thấy khung camera.");
      video.srcObject = stream;
      await video.play();
      if (generation !== epoch.current) return;
      const worker = new Worker(
        new URL("../workers/hand.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;
      let lastResult = 0;
      let seen = 0;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Tải model quá lâu. Thử bật lại camera.")),
          45000,
        );
        worker.onerror = (e) => {
          clearTimeout(timeout);
          reject(new Error(e.message || "Không khởi động được model."));
        };
        worker.onmessage = (e) => {
          if (generation !== epoch.current) return;
          const data = e.data;
          if (data.type === "ready") {
            clearTimeout(timeout);
            setMetrics((m) => ({ ...m, delegate: data.delegate }));
            resolve();
          } else if (data.type === "error") {
            clearTimeout(timeout);
            reject(new Error(data.message));
          } else if (data.type === "frame-error") {
            setError("Model không xử lý được frame: " + data.message);
            stop();
          } else if (data.type === "result") {
            busy.current = false;
            const raw = data.hands as RawHand[];
            // Ambiguous duplicate handedness is rejected, not silently reassigned.
            const duplicate =
              new Set(raw.map((h) => h.side)).size !== raw.length;
            const found = duplicate
              ? []
              : raw
                  .filter((h) => h.score >= 0.6)
                  .map((h) => extractHand(h, data.width / data.height))
                  .filter((h): h is HandFeature => h !== null);
            setHands(found);
            callbackRef.current({ t: data.t, hands: found });
            if (++seen % 5 === 0) {
              const delta = data.t - lastResult;
              setMetrics((m) => ({
                ...m,
                ms: data.inferenceMs,
                fps: delta > 0 ? 5000 / delta : 0,
              }));
              lastResult = data.t;
            }
          }
        };
        worker.postMessage({ type: "init", base: location.origin });
      });
      if (generation !== epoch.current) return;
      setStatus("on");
      let lastVideo = -1,
        lastSent = 0;
      const loop = () => {
        if (generation !== epoch.current) return;
        const now = performance.now();
        if (
          !busy.current &&
          video.readyState >= 2 &&
          video.currentTime !== lastVideo &&
          now - lastSent >= 32
        ) {
          busy.current = true;
          lastVideo = video.currentTime;
          lastSent = now;
          createImageBitmap(video)
            .then((bitmap) => {
              if (generation !== epoch.current) {
                bitmap.close();
                return;
              }
              worker.postMessage({ type: "frame", bitmap, t: now }, [bitmap]);
            })
            .catch((err) => {
              setError(String(err));
              stop();
            });
        }
        raf.current = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      if (generation !== epoch.current) return;
      stop();
      const name = e instanceof DOMException ? e.name : "";
      setError(
        name === "NotAllowedError"
          ? "Quyền camera chưa được cấp."
          : name === "NotFoundError"
            ? "Không tìm thấy camera."
            : e instanceof Error
              ? e.message
              : String(e),
      );
    }
  }, [stop]);
  useEffect(
    () => () => {
      epoch.current++;
      cancelAnimationFrame(raf.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      workerRef.current?.terminate();
    },
    [],
  );
  return { videoRef, streamRef, status, error, hands, metrics, start, stop };
}
