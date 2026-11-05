/// <reference lib="webworker" />
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { RawHand, Side } from "../types";
let model: HandLandmarker | null = null;
self.onmessage = async (event: MessageEvent) => {
  const data = event.data;
  if (data.type === "init") {
    try {
      const files = await FilesetResolver.forVisionTasks(
        data.base + "/vendor/mediapipe",
        true,
      );
      let delegate: "GPU" | "CPU" = "GPU";
      const variant = data.variant === "full" ? "full" : "lite";
      if (data.delegate === "CPU") delegate = "CPU";
      const options = {
        baseOptions: {
          modelAssetPath: data.base + (variant === "lite" ? "/models/hand_landmarker_lite.task" : "/models/hand_landmarker.task"),
          delegate,
        },
        runningMode: "VIDEO" as const,
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      };
      try {
        model = await HandLandmarker.createFromOptions(files, options);
      } catch {
        delegate = "CPU";
        model = await HandLandmarker.createFromOptions(files, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate },
        });
      }
      self.postMessage({ type: "ready", delegate, variant, model: variant === "lite" ? "MediaPipe Hands Lite" : "MediaPipe Hands Full" });
    } catch (error) {
      self.postMessage({ type: "error", message: String(error) });
    }
  }
  if (data.type === "frame") {
    const bitmap: ImageBitmap = data.bitmap;
    try {
      if (!model) throw new Error("Model chưa sẵn sàng");
      const started = performance.now();
      const result = model.detectForVideo(bitmap, data.t);
      const hands: RawHand[] = result.landmarks.map((landmarks, i) => ({
        landmarks,
        world: result.worldLandmarks[i],
        side: result.handedness[i][0].categoryName as Side,
        score: result.handedness[i][0].score,
      }));
      self.postMessage({
        type: "result",
        hands,
        t: data.t,
        inferenceMs: performance.now() - started,
        width: bitmap.width,
        height: bitmap.height,
      });
    } catch (error) {
      self.postMessage({ type: "frame-error", message: String(error) });
    } finally {
      bitmap.close();
    }
  }
};
