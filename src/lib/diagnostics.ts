import type { Recognition, Sample } from "../types";
import type { TemporalClassifier } from "./temporal";
import { SignSegmenter } from "./motion";

/** Replay measured frames, without synthesizing a held tail or modifying clips.
 * This tests the decoder on stored recordings; it is not a new-session score. */
export async function diagnoseSamples(
  model: Pick<TemporalClassifier, "predict" | "getSummary">,
  samples: Sample[],
  onProgress: (done: number, total: number) => void = () => {},
) {
  const rows = [];
  for (const sample of samples) {
    const stream = new SignSegmenter();
    const events: { t: number; labelId: string; label: string }[] = [];
    const rejections: Record<string, number> = {};
    let candidates = 0;
    for (const frame of sample.frames) {
      stream.push(frame);
      const input = stream.candidate(true);
      if (!input) continue;
      candidates++;
      const result: Recognition = await model.predict(input, { allowStatic: stream.staticReady });
      if (result.accepted && result.matches[0]) {
        if (stream.confirm(stream.revision, result.matches[0].labelId))
          events.push({ t: frame.t, labelId: result.matches[0].labelId, label: result.matches[0].label });
      } else rejections[result.reason] = (rejections[result.reason] ?? 0) + 1;
    }
    const isolated = await model.predict(sample.frames);
    rows.push({ id: sample.id, labelId: sample.labelId, label: sample.label, candidates,
      events, rejections, isolated,
      correct: events.length === 1 && events[0].labelId === sample.labelId,
      wrong: events.some(event => event.labelId !== sample.labelId),
      duplicate: events.length > 1,
    });
    onProgress(rows.length, samples.length);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return {
    version: 1, createdAt: new Date().toISOString(),
    scope: "Stored-clip replay, including training samples; not unseen signing accuracy",
    model: model.getSummary(), total: rows.length,
    correct: rows.filter(row => row.correct).length,
    wrong: rows.filter(row => row.wrong).length,
    duplicate: rows.filter(row => row.duplicate).length,
    unrecognized: rows.filter(row => !row.events.length).length,
    rows,
  };
}
