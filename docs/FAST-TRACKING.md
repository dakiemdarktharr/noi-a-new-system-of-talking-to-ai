# Fast hand tracking — 2026-11-06

Nối now defaults to **MediaPipe Hands Lite**, using Google's separate Lite palm-detector and Lite hand-landmark weights. This is a different, smaller weight variant within the MediaPipe family, **not an unrelated architecture**. It retains up to two hands, 21 image landmarks and 21 world landmarks per hand, handedness, and the existing geometric orientation calculation. Full remains available through `camera.start('full')`; no-argument `camera.start()` selects Lite.

The main frame-rate improvement also comes from removing the old capture/scheduling limit. The previous hook requested a maximum 30fps and imposed a 32ms submission gate. The new hook requests 60fps as an **ideal**, uses `requestVideoFrameCallback` when available, keeps one inference in flight, and immediately samples the freshest decoded frame when inference completes. Slow inference drops superseded frames rather than accumulating stale work. A RAF fallback remains for older browsers. Camera/display/device limits still apply; requesting 60fps does not create frames a camera cannot produce.

## Model and provenance

Runtime: `@mediapipe/tasks-vision` **1.2.2**, same-origin module WASM, worker inference, GPU delegate with CPU initialization fallback. Lite uses float16 weight tensors with float32 input/output. Both raw Lite models have the same input/output tensor shapes and order as their Full counterparts; the builder verifies that contract.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Original `palm_detection_lite.tflite` | 1,985,440 | `e9a4aaddf90dda56a87235303cf00e4c2d3fb28725f68fd88772997dac905c18` |
| Original `hand_landmark_lite.tflite` | 2,071,408 | `d7fde8ac11f8ce03f8663775bfc323f4fc9f2a38062b4f4efa142874ef5b2a48` |
| Repackaged `hand_landmarker_lite.task` | 4,056,425 | `09e8b06f019471167f6f821c9d4ad1df632e31580de8eeca1049cd5c7b57f25f` |
| Original Full float16 v1 task | 7,819,105 | `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` |

The Lite URLs are unversioned official legacy assets; the hashes pin the exact weights used. Their official model card is dated October 2021. These legacy weights are provided as-is, not a newly released 2026 model. The custom task bundle adds compatible tensor metadata and handedness labels from Google's Full bundle; it does **not** modify learned weights. This packaging was necessary because the raw legacy Lite files do not contain the Tasks metadata. The full model card explicitly covers Lite and Full under Apache-2.0. A license copy and modification notice are included beside the model.

## Why this alternate

| Candidate | Verified capability | Decision |
| --- | --- | --- |
| MediaPipe Lite | 21 image + 21 world points, two-hand Tasks pipeline, browser GPU/CPU, Apache-2.0 | Deployable alternate; smaller asset, measured speed/precision tradeoff |
| RTMPose-m Hand5 + RTMDet | A genuinely different architecture with a released 21-keypoint **2D** hand model | Would discard depth-based orientation unless an additional validated 3D model were added; not a compatible replacement |
| HaMeR | 3D reconstruction from hand crops using a large ViT-H backbone; requires handedness and MANO assets | Strong research candidate for occlusion, but not a verified fast browser drop-in; original instructions require separate MANO registration/download |

This selection is an engineering judgment for the existing browser architecture. It does not establish that Lite is the most accurate tracker, or faster on every device. Switching from Full to Lite changes the landmark distribution; old captured samples remain structurally readable, but re-recording/retraining with the selected tracker is recommended before judging recognition quality.

## Measured evidence

Tests used Windows, headless Edge 156 and ANGLE on **AMD Radeon 840M**, at 640×480. The input was the existing real-hand photo `qa/right_hands.jpg`. Translation, rotation, and mirrored two-hand composition were synthetic. **There was no real “chúng tôi” signing clip, motion-blur benchmark, or physical-camera measurement.** These tests verify model execution, landmark/orientation output, and scheduling, not human sign-recognition accuracy.

Direct worker comparison (`node qa/fast-tracking.mjs`), after eight warm-up frames:

| Measurement | Full | Lite |
| --- | ---: | ---: |
| One-hand static detections | 25/25 | 25/25 |
| Two hands with distinct sides | 19/20 | 19/20 |
| Rapid 3Hz rigid photo motion, sampled at 60Hz | 59/60 | 59/60 |
| Rapid-motion inference median | 11.5ms | 9.1ms |
| Rapid-motion inference p95 | 13.4ms | 15.1ms |
| Two-hand inference median | 11.9ms | 9.8ms |
| Orientation change for a 90° rotated photo | 89.6° | 103.2° |

Every detected hand had exactly 21 image and 21 world landmarks. Lite's orientation estimate was less exact on this fixture; retaining 3D output is not a claim of perfect depth/orientation accuracy. The first GPU inference can take seconds for shader compilation, and cold timings depend on browser shader cache/run order; they are not included in warm medians. The model card likewise reports a Lite/Full accuracy tradeoff and limitations around occlusion, blur and small/non-prominent hands.

The explicit CPU delegate check also passed both-hand, 21-point and quick-sequence checks. Its quick-motion median was 45.3ms Full versus 37.8ms Lite; p95 was 72.0ms versus 56.6ms. CPU orientation changes were 89.7° Full and 89.0° Lite. These differences reinforce the need to evaluate the actual device/backend rather than treating one GPU fixture as universal accuracy evidence. Details are in `qa/fast-tracking-cpu-report.json`.

Actual `useCamera` pipeline test (`node qa/fast-camera.mjs`) uses a canvas video stream with 2Hz transformed-photo motion. It honors the old requested 30fps ceiling, uses the old hook from commit `dc4f69b2daf772ca2b9515f69112a560168893ba` for the baseline, and measures each warmed run for five seconds:

| Run | Delivered frames/s | Frames with a hand |
| --- | ---: | ---: |
| Previous hook / Full / 30fps ceiling | 27.3 | 136/136 |
| New hook / Lite / 60fps requested, first run | 41.8 | 208/208 |
| New hook / Full / 60fps requested | 34.8 | 173/173 |
| New hook / Lite / 60fps requested, repeated | 52.0 | 260/260 |

All output timestamps were strictly increasing and all detected hands had 21 points. An earlier run measured Full 57.6fps and Lite 51.0fps. This variation means the evidence supports removal of the old throughput ceiling, **not a universal end-to-end speed ranking between weights**. Reports include per-run inference and capture/presentation-to-result latency. They do not equate neural inference time with total camera latency. Background system/GPU load was not controlled as in a laboratory benchmark.

## Behavioral details

`Frame.t` remains on the `performance.now()` clock used by recording. It uses validated video `captureTime` metadata when available and callback/presentation time otherwise, never inference completion time. Timestamps are strictly monotonic. Metrics retain `fps`, `ms`, `delegate` and add `model`, `captureFps`, `latencyMs`, `droppedFrames`. Reported capture rate is the media-track setting; delivered inference rate is measured independently.

Detection, presence and tracking thresholds are 0.5. Handedness score is not presence confidence; the old additional 0.6 handedness filter could erase a valid rotating hand. Duplicate anatomical-side detections retain the stronger measured hand rather than rejecting both or inventing the missing side. Ambiguous identity/crossing remains a limitation; the tracker does not guarantee two correct anatomical identities through occlusion. Geometry and world-coordinate orientation conventions are unchanged; relative two-hand distance still comes from shared image coordinates.

## Reproduce assets and checks

Normal builds require no Python tooling: retain the checked-in `public/models/hand_landmarker_lite.task`, then run `npm run assets`. It verifies the Lite SHA-256 and downloads/verifies the original Full fallback as before. `public/models/manifest.json` contains model paths, hashes, source URLs and runtime version.

To reproduce the custom bundle from official assets, use Python 3.11 (the verified build environment):

```powershell
npm run assets
python scripts/build-hand-lite.py --bootstrap
node scripts/prepare-assets.mjs
npx tsc --noEmit
node qa/fast-tracking.mjs
node qa/fast-camera.mjs
```

`--bootstrap` installs pinned FlatBuffers 25.12.19 and NumPy 2.4.6 **under `.cache/lite-build`**, downloads the official MediaPipe 0.10.21 wheel without installing its runtime, and extracts its generated metadata schemas. The builder downloads/verifies original Lite sources into that cache, checks input/output compatibility, copies metadata/labels, updates descriptions, and emits a deterministic ZIP task. Rebuilding produced the same artifact SHA-256. Run the benchmarks with the local Vite server already listening on port 5173. They require the existing photo fixture and Edge. Optional CPU-worker check: set `$env:TRACKING_DELEGATE='CPU'` before `node qa/fast-tracking.mjs`.

Track: Lite `.task`, model manifest/license/notice, hook, worker, builder/preparation scripts, benchmark scripts and this document. Exclude: `.cache/`, generated benchmark reports/screenshots, downloaded photo fixture, Full task and WASM copies already regenerated by the asset script. The generated reports are local evidence; the tables above preserve the reviewed values.

## Primary references and quality

- [Google's hand tracking Lite/Full model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf) — original model documentation; specifies 21 screen/world points, Apache-2.0, accuracy tradeoffs and limitations. No claim that Lite fixes motion blur.
- [Official MediaPipe model index](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/models.md) — original source links for Lite/Full weights; explicitly marks legacy solutions as provided as-is.
- [Hand Landmarker task guide](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) — official task contract, two-model bundle and video tracking/re-detection behavior.
- [MMPose RTMPose project](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose) — author's released model table, explicitly labels Hand5 as 2D with 21 points; framework Apache-2.0 does not turn 2D output into 3D.
- [HaMeR author repository](https://github.com/geopavlakos/hamer) and [CVPR supplement](https://openaccess.thecvf.com/content/CVPR2024/supplemental/Pavlakos_Reconstructing_Hands_in_CVPR_2024_supplemental.pdf) — original implementation/method details; ViT-H design and MANO setup requirement. Repository MIT license is not assumed to license separately obtained MANO assets.
- [MDN requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback) — platform documentation explaining video-frame cadence, optional capture metadata and synchronization limits.

Search accounting for this tracking task: 10 + 5 + 10 = **25 requested Exa candidates**, not 25 papers read. Earlier temporal-classifier research in the same agent used 35; cumulative agent search count is 60.

sources_reviewed: 25
