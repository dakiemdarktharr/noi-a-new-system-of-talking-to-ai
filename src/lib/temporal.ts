import * as tf from "@tensorflow/tfjs";
import type { Frame, Recognition, Sample } from "../types";
import {
  clipUsable,
  describeClip,
  encodeClip,
  FEATURE_COUNT,
  FEATURE_VERSION,
  featureDistance,
  TIME_STEPS,
} from "./features";

const MODEL_URL = "indexeddb://noi-temporal-v1";
const NEGATIVES = new Set(["NO_SIGN", "__no_sign__"]);
export interface ModelLabel {
  labelId: string;
  label: string;
  samples: number;
  windowMs?: number;
}
export interface ModelSummary {
  trainedAt: string;
  labels: ModelLabel[];
  sampleCount: number;
  trainCount: number;
  validationCount: number;
  validationMode: "session" | "clip" | "none";
  validationAccuracy: number | null;
  epochs: number;
  parameters: number;
  backend: string;
  persisted: boolean;
}
export interface TrainProgress {
  epoch: number;
  epochs: number;
  loss: number;
  accuracy: number;
  validationAccuracy?: number;
}
export interface TrainOptions {
  epochs?: number;
  batchSize?: number;
  persist?: boolean;
  seed?: number;
}
interface Support {
  center: number[];
  radius: number;
}
interface ModelMetadata {
  featureVersion: number;
  summary: ModelSummary;
  supports: Support[];
}
export interface DatasetSplit {
  train: Sample[];
  validation: Sample[];
  mode: ModelSummary["validationMode"];
}

/** Never split a clip into train/validation frames. Prefer an entire held-out session. */
export function splitSamples(samples: Sample[]): DatasetSplit {
  const labels = [...new Set(samples.map((s) => s.labelId))];
  const sessions = [
    ...new Set(samples.map((s) => s.sessionId || "__unknown__")),
  ];
  if (sessions.length > 1) {
    // Latest viable complete session is held out, even if it covers only some labels.
    for (const session of sessions.slice().reverse()) {
      const train = samples.filter(
        (s) => (s.sessionId || "__unknown__") !== session,
      );
      const validation = samples.filter(
        (s) => (s.sessionId || "__unknown__") === session,
      );
      if (
        validation.length &&
        labels.every(
          (label) => train.filter((s) => s.labelId === label).length >= 2,
        )
      ) {
        return { train, validation, mode: "session" };
      }
    }
    // If no session can be held out safely, do not pretend a clip split measures
    // cross-session generalization. Gather another session before evaluating.
    return { train: samples.slice(), validation: [], mode: "none" };
  }
  const validationIds = new Set<string>();
  for (const label of labels) {
    const group = samples
      .filter((s) => s.labelId === label)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (group.length >= 5)
      group
        .slice(-Math.max(1, Math.floor(group.length * 0.2)))
        .forEach((s) => validationIds.add(s.id));
  }
  return {
    train: samples.filter((s) => !validationIds.has(s.id)),
    validation: samples.filter((s) => validationIds.has(s.id)),
    mode: validationIds.size ? "clip" : "none",
  };
}

function buildNetwork(classes: number, seed = 42): tf.Sequential {
  const init = (offset: number) =>
    tf.initializers.glorotUniform({ seed: seed + offset });
  const model = tf.sequential();
  model.add(
    tf.layers.conv1d({
      inputShape: [TIME_STEPS, FEATURE_COUNT],
      filters: 24,
      kernelSize: 5,
      padding: "same",
      activation: "relu",
      kernelInitializer: init(0),
    }),
  );
  model.add(
    tf.layers.conv1d({
      filters: 32,
      kernelSize: 3,
      padding: "same",
      activation: "relu",
      kernelInitializer: init(1),
    }),
  );
  model.add(tf.layers.averagePooling1d({ poolSize: 2, strides: 2 }));
  model.add(
    tf.layers.conv1d({
      filters: 48,
      kernelSize: 3,
      padding: "same",
      activation: "relu",
      kernelInitializer: init(2),
    }),
  );
  // Preserve temporal order. Global averaging alone can confuse reversed motion.
  model.add(tf.layers.flatten());
  model.add(
    tf.layers.dense({
      units: 32,
      activation: "relu",
      kernelInitializer: init(3),
      kernelRegularizer: tf.regularizers.l2({ l2: 0.0001 }),
    }),
  );
  model.add(tf.layers.dropout({ rate: 0.15, seed }));
  model.add(
    tf.layers.dense({
      units: classes,
      activation: "softmax",
      kernelInitializer: init(4),
    }),
  );
  // Passing the optimizer name makes LayersModel own/dispose Adam's slot
  // variables. Passing an external optimizer instance would leak them on retrain.
  model.compile({
    optimizer: "adam",
    loss: "categoricalCrossentropy",
    metrics: ["accuracy"],
  });
  return model;
}

function supportsFor(
  sequences: number[][][],
  samples: Sample[],
  labels: ModelLabel[],
): Support[] {
  const descriptors = sequences.map(describeClip);
  return labels.map((label) => {
    const rows = descriptors.filter(
      (_, i) => samples[i].labelId === label.labelId,
    );
    const center = rows[0].map(
      (_, j) => rows.reduce((sum, row) => sum + row[j], 0) / rows.length,
    );
    const distances = rows
      .map((row) => featureDistance(row, center))
      .sort((a, b) => a - b);
    return {
      center,
      radius: Math.min(
        0.25,
        Math.max(
          0.065,
          distances[Math.floor((distances.length - 1) * 0.9)] * 1.8 + 0.025,
        ),
      ),
    };
  });
}

async function ready() {
  try {
    await tf.ready();
  } catch {
    await tf.setBackend("cpu");
    await tf.ready();
  }
}

export class TemporalClassifier {
  private model: tf.LayersModel | null = null;
  private metadata: ModelMetadata | null = null;
  private training: tf.LayersModel | null = null;
  private generation = 0;

  getSummary(): ModelSummary | null {
    return this.metadata?.summary ?? null;
  }

  async load(): Promise<ModelSummary | null> {
    await ready();
    let loaded: tf.LayersModel | null = null;
    try {
      loaded = await tf.loadLayersModel(MODEL_URL);
      const data =
        (await loaded.getUserDefinedMetadata()) as unknown as ModelMetadata;
      if (
        data?.featureVersion !== FEATURE_VERSION ||
        loaded.inputs[0].shape[1] !== TIME_STEPS ||
        loaded.inputs[0].shape[2] !== FEATURE_COUNT ||
        !data.summary?.labels?.length ||
        data.supports?.length !== data.summary.labels.length
      ) {
        loaded.dispose();
        return null;
      }
      this.model?.dispose();
      this.model = loaded;
      this.metadata = data;
      this.metadata.summary.persisted = true;
      this.metadata.summary.backend = tf.getBackend();
      return this.metadata.summary;
    } catch {
      loaded?.dispose();
      return null;
    }
  }

  async train(
    samples: Sample[],
    onProgress: (progress: TrainProgress) => void = () => {},
    options: TrainOptions = {},
  ): Promise<ModelSummary> {
    if (this.training) throw new Error("Mô hình đang huấn luyện.");
    const unique = [
      ...new Map(
        samples.filter((s) => clipUsable(s.frames)).map((s) => [s.id, s]),
      ).values(),
    ];
    const labels: ModelLabel[] = [...new Set(unique.map((s) => s.labelId))]
      .sort()
      .map((labelId) => {
        const rows = unique.filter((s) => s.labelId === labelId);
        const durations = rows
          .map((s) => s.frames.at(-1)!.t - s.frames[0].t)
          .sort((a, b) => a - b);
        return {
          labelId,
          label: rows[0].label,
          samples: rows.length,
          windowMs: Math.max(
            1000,
            Math.min(
              4000,
              Math.round(durations[Math.floor(durations.length / 2)] / 500) *
                500,
            ),
          ),
        };
      });
    if (labels.length < 2 || labels.some((label) => label.samples < 3))
      throw new Error("Cần ít nhất 2 nhãn, mỗi nhãn 3 video có bàn tay.");
    await ready();
    const token = ++this.generation;
    const split = splitSamples(unique);
    const trainSequences = split.train.map((s) => encodeClip(s.frames));
    const labelIndex = (sample: Sample) =>
      labels.findIndex((label) => label.labelId === sample.labelId);
    const encodeLabels = (rows: Sample[]) =>
      rows.map((row) => labels.map((_, i) => Number(i === labelIndex(row))));
    const xs = tf.tensor3d(trainSequences),
      ys = tf.tensor2d(encodeLabels(split.train));
    const vx = split.validation.length
      ? tf.tensor3d(split.validation.map((s) => encodeClip(s.frames)))
      : null;
    const vy = split.validation.length
      ? tf.tensor2d(encodeLabels(split.validation))
      : null;
    const model = buildNetwork(labels.length, options.seed);
    this.training = model;
    const epochs = Math.max(1, Math.min(150, Math.round(options.epochs ?? 48)));
    let actualEpochs = 0,
      bestLoss = Infinity,
      stale = 0;
    let bestWeights: tf.Tensor[] = [];
    try {
      await model.fit(xs, ys, {
        epochs,
        batchSize: Math.max(
          1,
          Math.min(32, options.batchSize ?? 8, split.train.length),
        ),
        shuffle: true,
        validationData: vx && vy ? [vx, vy] : undefined,
        callbacks: {
          onEpochEnd: async (epoch, logs) => {
            actualEpochs = epoch + 1;
            const loss = Number(logs?.loss ?? 0),
              valLoss = Number(logs?.val_loss ?? loss);
            if (valLoss < bestLoss - 0.0005) {
              bestLoss = valLoss;
              stale = 0;
              bestWeights.forEach((w) => w.dispose());
              bestWeights = model.getWeights().map((w) => w.clone());
            } else stale++;
            onProgress({
              epoch: actualEpochs,
              epochs,
              loss,
              accuracy: Number(logs?.acc ?? logs?.accuracy ?? 0),
              validationAccuracy:
                logs?.val_acc == null && logs?.val_accuracy == null
                  ? undefined
                  : Number(logs?.val_acc ?? logs?.val_accuracy),
            });
            if (this.generation !== token || (vx && stale >= 10 && epoch >= 15))
              model.stopTraining = true;
            await tf.nextFrame();
          },
        },
      });
      if (this.generation !== token) throw new Error("Đã dừng huấn luyện.");
      if (bestWeights.length) model.setWeights(bestWeights);
      let validationAccuracy: number | null = null;
      if (vx && vy) {
        const evaluated = model.evaluate(vx, vy) as tf.Tensor[];
        validationAccuracy = Number((await evaluated[1].data())[0]);
        evaluated.forEach((t) => t.dispose());
      }
      const summary: ModelSummary = {
        trainedAt: new Date().toISOString(),
        labels,
        sampleCount: unique.length,
        trainCount: split.train.length,
        validationCount: split.validation.length,
        validationMode: split.mode,
        validationAccuracy,
        epochs: actualEpochs,
        parameters: model.countParams(),
        backend: tf.getBackend(),
        persisted: false,
      };
      const metadata: ModelMetadata = {
        featureVersion: FEATURE_VERSION,
        summary,
        supports: supportsFor(trainSequences, split.train, labels),
      };
      model.setUserDefinedMetadata(
        metadata as unknown as { [key: string]: object },
      );
      if (options.persist !== false) {
        try {
          summary.persisted = true;
          await model.save(MODEL_URL);
        } catch {
          summary.persisted = false;
        }
      }
      this.model?.dispose();
      this.model = model;
      this.metadata = metadata;
      return summary;
    } catch (error) {
      model.dispose();
      throw error;
    } finally {
      this.training = null;
      xs.dispose();
      ys.dispose();
      vx?.dispose();
      vy?.dispose();
      bestWeights.forEach((w) => w.dispose());
    }
  }

  async predict(frames: Frame[]): Promise<Recognition> {
    if (!this.model || !this.metadata)
      return {
        accepted: false,
        reason: "Chưa có mô hình đã huấn luyện.",
        matches: [],
      };
    if (!clipUsable(frames) || !frames.at(-1)?.hands.length)
      return {
        accepted: false,
        reason: "Chưa đủ chuyển động có bàn tay.",
        matches: [],
      };
    const sequence = encodeClip(frames),
      descriptor = describeClip(sequence);
    const input = tf.tensor3d([sequence]);
    let output: tf.Tensor | null = null;
    try {
      output = this.model.predict(input) as tf.Tensor;
      const scores = Array.from(await output.data());
      const ranked = this.metadata.summary.labels
        .map((label, i) => ({
          ...label,
          index: i,
          distance: featureDistance(
            descriptor,
            this.metadata!.supports[i].center,
          ),
          score: Math.round(scores[i] * 100),
        }))
        .sort((a, b) => b.score - a.score);
      const top = ranked[0],
        runner = ranked[1];
      const accepted =
        !NEGATIVES.has(top.labelId) &&
        scores[top.index] >= 0.68 &&
        scores[top.index] - scores[runner.index] >= 0.18 &&
        top.distance <= this.metadata.supports[top.index].radius;
      return {
        accepted,
        reason: NEGATIVES.has(top.labelId)
          ? "Không có ký hiệu."
          : accepted
            ? "Dự đoán từ mô hình cá nhân."
            : "Chưa đủ chắc chắn.",
        matches: ranked.slice(0, 3).map(({ index: _index, ...match }) => match),
      };
    } finally {
      input.dispose();
      output?.dispose();
    }
  }

  dispose(): void {
    ++this.generation;
    if (this.training) this.training.stopTraining = true;
    this.model?.dispose();
    this.model = null;
    this.metadata = null;
  }
}
