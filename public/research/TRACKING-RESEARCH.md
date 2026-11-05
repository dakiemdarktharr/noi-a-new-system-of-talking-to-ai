# Nối: hand tracking and orientation research

Research date: **2026-11-05**. Scope: a desktop browser, one RGB webcam, up to two hands, articulated fingers, and a custom Vietnamese-inspired vocabulary. Facial expression and body grammar are outside this prototype's input. This is an engineering review, not a claim that the current app recognizes a natural sign language.

## Recommendation

Keep **MediaPipe Tasks Vision Hand Landmarker** as the first browser backend. Preserve two separate signals: **handshape in a local palm frame** and **palm orientation in the camera frame**. The same shape held upright and horizontally must remain different. Add explicit two-hand placement and temporal features; a more complex mesh model does not fix a representation that discards those distinctions.

Use **HaMeR or Fast-HaMeR in a separate local GPU experiment** if recorded failures show that finger reconstruction is the bottleneck. Consider **OmniHands** when interaction and relative hand placement are the bottleneck. WiLoR is a useful research comparator, but its model license is restrictive. Very recent egocentric models such as V-JEPA Hand are a research watchlist, not a verified replacement for a frontal webcam app.

This recommendation balances deployment fit, inspectable outputs, licensing, and the ability to test the exact vocabulary. It is **not an accuracy ranking**. No study reviewed here establishes the best tracker for Nối's vocabulary or the user's camera.

## Comparison matrix

| Backend | What it estimates | Two hands and orientation | Runtime evidence and browser fit | Decision for Nối |
|---|---|---|---|---|
| **MediaPipe Hand Landmarker, full FP16 v1** | 21 image landmarks and 21 hand-centered 3D landmarks per hand; handedness | Configure `numHands: 2`; derive palm orientation from landmarks. Independent per-hand origins do not give shared scene translation. | Official Web SDK, WASM and GPU/CPU delegates. Google reports **17.12 ms CPU / 12.27 ms GPU on Pixel 6**, not this desktop browser. | Best current implementation fit; measure webcam errors and end-to-end latency locally. [Google task documentation](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker) |
| **HaMeR**, CVPR 2024 | MANO hand mesh, articulated pose, shape and camera parameters from a crop | Processes detected hand crops; supplied hand side matters. Per-frame reconstruction is not a persistent two-hand identity or contact solver. | Official release uses Python/PyTorch and CUDA-oriented dependencies. No official browser pipeline verified in this review. | Strong offline/local GPU comparator for difficult articulation; evaluate frontal webcam data before integration. [Paper](https://arxiv.org/abs/2312.05251), [official implementation](https://github.com/geopavlakos/hamer) |
| **WiLoR**, CVPR 2025; demo updated March 2026 | Hand detection plus MANO reconstruction with image-aligned refinement | Multiple detections and handedness; separate reconstruction can miss contacts and relative interaction geometry. Authors acknowledge extreme finger poses and crowded-scene failures. | **138 / 175 FPS refer to medium/small detectors on RTX 4090**, not full two-hand reconstruction. Official implementation is PyTorch; `--fast` claims up to 1.6× speedup, without establishing browser latency. | Useful accuracy comparator, not a drop-in browser upgrade; licensing blocks a casual production substitution. [Paper, pp. 6, 14](https://arxiv.org/abs/2409.12259), [repository](https://github.com/rolpotamias/WiLoR) |
| **Fast-HaMeR**, March 2026 preprint | HaMeR-style mesh reconstruction using distilled, smaller backbones | Retains the cropped-hand reconstruction formulation; no demonstrated browser tracking/identity layer | Paper reports **ConvNeXt-L: 240M parameters, 40 FPS; HaMeR: 671M, 27 FPS**, both on RTX 4060 Ti. These are model/configuration timings; do not treat them as full webcam UI latency. | Worth testing if a local GPU service becomes acceptable. Code exists; verify availability and terms of the exact student checkpoint. [Paper, Table 1](https://arxiv.org/abs/2603.16444), [official code](https://github.com/hunainahmedj/Fast-HaMeR) |
| **OmniHands**, ACM TOG 2026 | Interactive hand meshes and relative position; single-frame, temporal and multi-view variants | Explicit relation-aware two-hand tokens and context fusion address information lost by independent crops | Peer-reviewed evaluation includes relative-root error and temporal metrics. Browser execution, causal streaming latency, and deployable model-license terms were not verified. Publisher notes an August 2026 erratum; use the corrected version. | Relevant research direction for crossings/contact; prototype separately rather than promise an immediate replacement. [Corrected publisher article](https://dl.acm.org/doi/full/10.1145/3807943) |
| **V-JEPA Hand**, October 2026 preprint | Both hand poses, wrist orientation, articulation, presence, camera motion and intrinsics from egocentric clips | Predicts a shared camera/world trajectory; 16-frame clips, neutral MANO shape | **607.1M parameters; 93.4 FPS forward throughput on RTX A6000**, BF16, batch one; detection/postprocessing excluded. A 16-frame joint-attention clip is not evidence of causal low-latency tracking. Official page says code release is paused for internal review. | Watchlist. Egocentric training/evaluation, clip context, release status and GPU cost make frontal browser transfer unproven. [Paper, §§3–4 and Table 8](https://arxiv.org/abs/2610.26780), [project/release status](https://qft-333.github.io/V-JEPA-Hand-Page/) |

**MANO is a parametric hand model, not an image tracker.** It converts pose and shape parameters to mesh geometry; an estimator such as HaMeR must infer those parameters. A mesh representation offers articulated rotations and surfaces, but it cannot recover visual evidence that a camera did not observe. [HaMeR method](https://arxiv.org/abs/2312.05251)

### Why benchmark numbers cannot be pooled

WiLoR reports FreiHAND **PA-MPJPE 5.5 mm versus HaMeR 6.0 mm**, and HO3Dv2 **7.5 versus 7.7 mm**, under its stated protocols. Those are useful within-paper comparisons. Procrustes alignment removes global translation, rotation and scale before measuring error: a strong aligned score therefore does **not** establish reliable absolute palm orientation. Detection FPS, per-crop inference FPS, multi-frame throughput and camera-to-screen latency measure different work. Training mixtures, missed-detection handling, precision and hardware also differ. [WiLoR, Tables 3–4](https://arxiv.org/abs/2409.12259)

For Nối, evaluate unaligned orientation error, confusing sign pairs, hand coverage and identity switches alongside local finger error. Report misses rather than evaluating only frames a model successfully detects. These are proposed product measurements, not results already obtained.

## Representation: keep the distinction the user cares about

The current `geometry.ts` approach is structurally appropriate:

1. Convert the backend coordinates once to the app convention: **X image-right, Y up, Z toward the camera**. For the present MediaPipe adapter this is `(x, -y, -z)`. Validate this convention with actual camera motion; do not reinterpret it as calibrated room coordinates.
2. Set the palm longitudinal axis `d = unit(p9 - p0)`, using wrist 0 and middle MCP 9.
3. Set `v = p5 - p17`, then remove its longitudinal component: `r = unit(v - dot(v,d) d)`.
4. Form `n = unit(r × d)` and an orthonormal rotation matrix with columns `[r, d, n]`; convert it to a unit quaternion.
5. For handshape, express wrist-relative points in this local basis and normalize by a palm scale. Keep the **camera-frame quaternion as an additional feature**, plus the explicit hand side.

This is a proposed geometric interpretation of the current code. Local shape may be rotation invariant; the complete recognizer must not be. A rigid 90° turn should leave local shape approximately unchanged while changing the quaternion distance by about 90°. Finger curls help but are insufficient alone: include full joint geometry or angles so thumb opposition, finger separation and bent-finger variants remain visible.

Use quaternion angular distance `2 acos(clamp(abs(dot(q1,q2)), 0, 1))`. The absolute value handles the equivalent quaternion representations `q` and `-q`. Do not compare Euler angle components directly across the ±180° wrap. The plane normal derived above is a **geometric basis axis**; its anatomical palm-facing meaning depends on the handedness/convention. Verify both hands before labeling an arrow “palm toward camera.”

### Coordinates and two-hand placement

MediaPipe image `x/y` are normalized by width/height; `z` is relative to that hand's wrist, with smaller values closer to the camera. World landmarks are metric-scale predictions centered separately at each hand. They are **not two hand point clouds in one measured room frame**. [Web output contract](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)

Consequences for this app:

- Use hand-centered 3D points for local joint geometry and palm orientation.
- Use aspect-corrected image wrist/center coordinates for visible two-hand placement and trajectories. Keep this explicitly 2D; `wrist.z = 0` is an absence of root-depth measurement.
- Include a pairwise feature such as `imageWristRight - imageWristLeft`, optionally divided by a stable, session-level image palm scale. Do not recompute that scale from a palm that becomes edge-on without a reliability check.
- Preserve relative orientation, for example `inverse(qRight) * qLeft`, in addition to each absolute orientation. Relative orientation alone would merge a coordinated rotation of both hands.
- Keep presence masks, timestamps and hand identity with the features. Crossing hands must not silently become exchanged hands.

**Implementation finding sent to the main implementation task:** the inspected `recognizer.ts` normalized each hand by its own initial wrist. Used alone, that removes initial inter-hand separation: two hands starting together and far apart can have identical normalized trajectories. Add the pairwise displacement above, or subtract one shared origin for the whole two-hand sequence. Recheck the final implementation; this document is not an assertion that the finding remains unfixed.

Camera-up is not gravity-up. A tilted laptop changes the frame in which “upright” is measured. Either define the vocabulary relative to the camera and show a leveling cue, or calibrate a fixed session transform. Never normalize away each sign's rotation in the name of calibration.

## Failure modes and the appropriate response

| Observation | Why it matters | Proposed app response |
|---|---|---|
| Palm nearly edge-on; fingers aligned along the camera axis | Projected palm width shrinks, fingers overlap, depth becomes weakly constrained; an apparently plausible 3D skeleton can still be wrong | Mark orientation/shape uncertain, retain the last stable display only briefly, and exclude uncertain intervals from confident acceptance. Do not require the person to change the sign's meaning. |
| One hand covers the other, hands touch, or fingers self-occlude | Hidden joints are inferred from learned priors; there may be several compatible 3D poses | Measure two-hand coverage and reject incomplete captures; add temporal context or a second view if these cases are central to the vocabulary. |
| Handedness flips or both detections have the same side | Classification can be uncertain; labels are not persistent track IDs | Associate detections across time using image position, motion and side evidence. Use hysteresis, record ambiguity and reset a sample on a sustained identity break. |
| Small distant hands, blur, poor light, clipping at image borders | Less useful pixel evidence reaches the crop model | Give framing/light feedback, measure actual capture resolution and exposure effects, and allow a comfortable camera distance. |
| Missing frames after a hand leaves/re-enters | A filter can bridge unrelated poses or create false motion | Reset filters/identity after a bounded gap; record missing data rather than inventing continuous motion. |
| Quaternion jumps while local shape is stable | May be genuine wrist rotation, an axis ambiguity, or a detector failure | Compare image evidence, palm basis conditioning and angular velocity; avoid globally clamping all fast rotations. |

These are engineering consequences of monocular geometry, not measured failure rates for Nối. Google's linked model card explicitly places gloves/occlusion outside intended use, reports larger errors for blurred or occluded joints, and describes estimated depth/world coordinates derived using synthetic GHUM supervision. It does not validate precise 3D sign orientation. WiLoR's authors likewise acknowledge uncommon-pose and interaction limitations. [Google model card, pp. 1–3, 6](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf), [WiLoR limitations](https://arxiv.org/abs/2409.12259)

The current geometry guard for a tiny palm or nearly collinear basis is useful, but **not a visibility detector**. A hallucinated 3D palm can remain well-conditioned even when its 2D projection is edge-on. Add projected palm area/width, clipping, temporal discontinuity and hand-presence evidence as quality signals. Treat these as heuristics to validate, not probabilities.

## Handedness and mirroring

Current Tasks documentation states that `Left`/`Right` correspond to the **subject's hands**, and horizontally mirrored **input** inverts those outputs. Feed unmirrored camera pixels to the model, retain anatomical labels, and mirror only the preview if desired. A CSS `scaleX(-1)` does not transform pixels supplied through `createImageBitmap(video)`. Test a clearly identified left and right hand with preview mirroring on and off. Do not import an old MediaPipe Hands convention without checking the exact SDK/model. [Current task output contract](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)

The handedness category `score` measures side classification. It is **not a per-joint confidence or hand-presence score**. `minTrackingConfidence` is the bounding-box IoU threshold controlling tracking/re-detection. Show side certainty separately from sample quality; the current public result does not provide calibrated finger visibility. [Web configuration and result guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)

## Calibration, smoothing and latency

Keep onboarding short and optional where possible: confirm the intended hand labels, preview mirror setting, comfortable frame coverage and a fixed neutral reference. Record the camera resolution/aspect, model hash, SDK version and coordinate convention with the session. Sample each confusing sign pair in separate recording sessions; a fixed camera setup should not be the only thing separating classes.

For temporal smoothing, start with an adaptive **One Euro filter** for positions and scalar articulation signals. The original method reduces the cutoff at low speed to suppress jitter and increases it at high speed to reduce lag. Its authors recommend tuning slow stationary motion first, then fast movement. Parameters depend on signal units; copying the same values to pixels, metres and angles is inappropriate. [Original authors' algorithm and tuning guide](https://gery.casiez.net/1euro/)

For rotations, use shortest-path quaternion interpolation or a rotation-space adaptive filter. Enforce quaternion sign continuity before interpolation and keep rotations normalized. Filter each stable track separately and reset on a long gap. Never average Euler components or independently smooth basis axes without restoring orthogonality. Filtering reduces visible noise; it cannot validate an occluded pose. These rotation-handling choices are engineering recommendations, not claims that the scalar One Euro paper evaluates this exact implementation.

The worker architecture is appropriate: `detectForVideo(frame, timestampMs)` is synchronous, requires video mode, and expects a timestamp in milliseconds. Keep timestamps monotonic within a tracker lifetime. Use a worker to avoid blocking the UI, one in-flight frame to avoid backlog, and transfer/close frame bitmaps. The official Google worker sample uses a similar separation. [API contract](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.handlandmarker), [official worker sample](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/hand-landmarker.worker.ts)

Measure **capture-to-result age**, inference time, rendering delay, achieved tracking FPS, discarded frames, startup/model load time and memory. Report median and p95 on the actual desktop, separately for one/two hands and GPU/CPU fallback. GPU inference need not imply lower end-to-end latency after transfer and contention. Do not label the app “60 FPS” because the preview redraws at 60 Hz. An empty image successfully passing through WASM validates loading and invocation, not real hand quality.

## Licensing and reproducibility

| Asset | Verified evidence | Consequence |
|---|---|---|
| MediaPipe selected model | The model card linked by Google's current task page says **Apache License 2.0**. The documentation-page footer is not the evidence for model licensing. | Preserve model provenance, license notices and a fixed hash. [Official model card, p. 2](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf) |
| HaMeR code | Repository `LICENSE.md` is **MIT**. The README requires a separate MANO download and uses other detector/pose components. | MIT for repository code does not automatically clear all weights, training data or MANO assets. Verify each exact artifact before redistribution. [License](https://github.com/geopavlakos/hamer/blob/main/LICENSE.md), [installation](https://github.com/geopavlakos/hamer) |
| Fast-HaMeR code/checkpoints | Repository includes the inherited MIT code license and MANO setup; paper announces code/models, while the inspected README describes passing a student checkpoint path. | Do not infer a production-ready student weight release or a separate checkpoint license from the code badge. [Repository](https://github.com/hunainahmedj/Fast-HaMeR) |
| WiLoR | Repository license is **CC BY-NC-ND 4.0**; README applies it to models and calls out Ultralytics/MANO separately. | Noncommercial/no-derivatives terms materially constrain reuse; technical availability is not unrestricted product permission. [Exact license](https://github.com/rolpotamias/WiLoR/blob/main/license.txt), [README](https://github.com/rolpotamias/WiLoR) |
| MANO model/data | Official license permits specified noncommercial research, education and artistic uses, restricts redistribution, and offers a separate commercial-licensing route. | Do not bundle `MANO_RIGHT.pkl` in the web app merely because an estimator's code is MIT. [MANO license](https://mano.is.tue.mpg.de/license.html) |
| OmniHands / V-JEPA Hand | No deployment license verified for OmniHands in this review; V-JEPA Hand's official page reports release paused. | Leave them as research candidates pending artifact and license verification. [OmniHands](https://dl.acm.org/doi/full/10.1145/3807943), [V-JEPA Hand release status](https://qft-333.github.io/V-JEPA-Hand-Page/) |

The inspected local `public/models/manifest.json` records:

```text
Model: MediaPipe Hand Landmarker full float16 v1
SDK: 1.2.2
Bytes: 7,819,105
SHA-256: fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1
Source: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
Runtime: same-origin model and WASM; no remote inference
```

This records the manifest observed during research; asset preparation should independently recheck the downloaded file hash. Retain the exact model and SDK when comparing recordings so an upgrade cannot silently change feature distributions.

## Hands-only scope, accessibility and comfort

Nối should describe itself as a **custom hands-only gesture vocabulary**, with Vietnamese labels and user-recorded meanings. It should not claim to translate Vietnamese Sign Language or natural signed conversation. Natural sign languages use more than handshape: location, movement, orientation and non-manual information can carry meaning. The interdisciplinary ASSETS workshop explicitly discusses facial/body/gaze information and the limits of isolated recognition. [Bragg et al., 2019](https://doi.org/10.1145/3308561.3353774)

Within the chosen hands-only scope, let users choose meanings, record comfortable variants and inspect ambiguous alternatives. Avoid forcing extreme wrist rotation or long static holds solely to please the tracker. Offer short captures, retries, pause/rest, keyboard controls and text feedback. Put uncertainty on the system: “Camera chưa thấy rõ bàn tay” is more useful than implying the person signed incorrectly. These are proposed interface choices requiring user validation.

Involve Vietnamese Deaf signers and other intended users in deciding whether the vocabulary is useful and whether labels overclaim its meaning. Give them a role in priorities, not only final testing. Evidence supporting this approach includes a primary study with **12 interviews and four co-design sessions involving eight Deaf signers and eight ASL interpreters**, and a reflexive case study of two European sign-language technology projects. Neither validates this Vietnamese vocabulary; their findings motivate local participation and accessible feedback. [Ang et al., CHI 2022](https://doi.org/10.1145/3491102.3517488), [De Meulder et al.](https://arxiv.org/abs/2408.13171)

## Validation before claiming recognition quality

Use consented recordings of real hands. Keep synthetic geometry tests for representation invariants, but do not report them as camera recognition accuracy.

| Test group | Required variation | Record |
|---|---|---|
| Orientation minimal pairs | Same handshape upright/horizontal; palm toward/away; intermediate rotations; both hands | Confusion matrix, quaternion error where reference is available, false accepts and rejections |
| Articulation | Thumb opposition, finger spread, partially bent fingers, same silhouette with different depth | Per-sign confusion and visible/occluded failures |
| Two-hand relation | Hands together/apart, left-above-right/right-above-left, crossings, contact, one hand temporarily hidden | Pairwise feature response, identity switches, two-hand coverage |
| Motion | Opposite direction, reversed order, different speeds, repeated strokes, entry/exit | Sequence confusion, false triggers, filter delay |
| Capture conditions | Camera height/tilt, distance, skin tones, backgrounds, lighting, sleeves/jewelry where relevant | Per-condition errors and rejection rates |
| Deployment | Real GPU delegate and forced CPU fallback, recording/replay, model reload, sustained session | Median/p95 latency, memory, frame drops, recovery behavior |

Separate training and evaluation by **recording session**, and by person when claiming generalization. Randomly splitting adjacent frames leaks nearly identical poses. Include unknown gestures and ordinary non-sign movements; report accuracy on accepted predictions **together with rejection/coverage**, since a model can appear accurate by rejecting difficult inputs. A similarity score is not a calibrated probability of correct meaning.

No Nối-specific accuracy, orientation error or real-camera latency was measured by this research task. Published mesh numbers, local synthetic tests and model-load smoke tests cannot fill that gap.

## Future glove or additional-camera path

Define a backend-neutral observation format now: timestamps, stable hand IDs, coordinate frame/calibration metadata, root orientation, articulated joints, presence/quality, and an optional root-position field with its measurement source. Camera and glove adapters can then feed the same feature and recording pipeline.

A future glove should be tested for which quantities its actual sensors measure: finger flexion alone is insufficient for palm orientation, while a wrist orientation sensor is not by itself an absolute root-position measurement. Keep unsensed quantities missing rather than manufacturing values. Fit, calibration, drift, contact sensing, don/doff effort and signing comfort belong in the evaluation. A glove is an optional custom input device, not evidence of natural-language translation.

For persistent contact/occlusion problems, evaluate an additional camera or a depth sensor against the same real-hand test set. Extra hardware may add useful observations, but introduces synchronization, calibration and user setup costs. These are proposed experiments, not a hardware purchase recommendation.

## Search boundaries and evidence quality

Exa searches covered five distinct angles: current MediaPipe contracts; HaMeR/WiLoR implementations and licenses; newer monocular/two-hand research; sign-language HCI/accessibility; and adaptive smoothing. Requested candidate counts were **5 + 10 + 10 + 10 + 5 = 40**. This is a count of **search candidates requested**, including duplicate results—not 40 fully read papers. Full-page extraction followed for selected primary sources. alphaXiv was used for scholarly discovery and raw PDF-page extraction; official documentation, repositories, license texts and publisher articles were read directly.

The cutoff was **2026-11-05**. Sources were English-language and publicly accessible. Third-party wrappers, redistributed checkpoints, review blogs, vendor rankings, and RGB-D-only methods were excluded from direct browser-backend conclusions. Search discovery is not exhaustive. Failed alphaXiv extraction for the CHI article and exact-title lookup for OmniHands were followed by direct publisher extraction; they were not extra Exa search calls.

| Evidence | Quality and appropriate weight |
|---|---|
| Google task/API documentation and model card | Primary maintainer contracts and asset declaration; high weight for API semantics, limited evidence for this webcam/vocabulary's accuracy |
| HaMeR/WiLoR papers and author repositories | Primary research with published evaluations and reproducible implementations; useful comparisons under stated datasets, not independent product validation |
| Fast-HaMeR and V-JEPA Hand | Recent primary preprints; measured GPU results, but deployment/generalization and release gaps remain |
| Corrected OmniHands publisher article | Peer-reviewed primary method with interaction-focused evaluation; deployable browser artifacts and terms not established here |
| One Euro authors' paper/site | Primary filtering method and tuning guidance; does not validate the app's eventual quaternion filter |
| CHI signer study and co-creation case study | Primary qualitative evidence grounded in participants/project experience; informative design guidance, limited transfer across languages and communities |
| Local code and manifest inspection | Direct evidence of the inspected implementation, not proof of live-camera behavior; code may change during the implementation task |

High confidence: preserve global orientation; keep per-hand world origins separate; distinguish side score from tracking quality; profile the actual browser. Moderate confidence: MediaPipe is the best first deployment fit under the present scope. Unresolved: which tracker gives the best Nối recognition/comfort tradeoff after testing with intended users.
