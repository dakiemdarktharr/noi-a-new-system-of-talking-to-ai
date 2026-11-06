import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  const report = await page.evaluate(async () => {
    const { TemporalClassifier } = await import("/src/lib/temporal.ts");
    const { SignSegmenter } = await import("/src/lib/motion.ts");
    const { fixtureHand } = await import("/src/lib/fixtures.ts");
    const { extractHand } = await import("/src/lib/geometry.ts");
    const clip = (label, variation = 0, pace = 1) => Array.from({ length: 41 }, (_, i) => {
      const phase = i / 40, theta = phase * Math.PI * 2;
      const moving = label !== "static";
      const angle = moving ? 180 * (1 - phase) : 180;
      return { t: i * 30 * pace, hands: [extractHand(fixtureHand(angle + variation, 0,
        moving ? [(label === "reverse" ? -1 : 1) * .1 * Math.sin(theta), .1 * (Math.cos(theta) - 1), 0] : [0, 0, 0]))] };
    });
    const samples = ["static", "loop", "reverse"].flatMap(label => Array.from({ length: 6 }, (_, i) => ({
      id: label + i, labelId: label, label, schema: 1, durationMs: 1200,
      sessionId: "s" + Math.floor(i / 2), createdAt: new Date().toISOString(),
      frames: clip(label, i % 2 ? 1 : -1),
    })));
    const model = new TemporalClassifier();
    const summary = await model.train(samples, undefined, { epochs: 40, seed: 23, gestureKinds: { static: "static", loop: "dynamic", reverse: "dynamic" } });
    const cases = [];
    for (const pace of [.7, 1, 1.3]) for (const label of ["static", "loop", "reverse"]) {
      const result = await model.predict(clip(label, 0, pace));
      if (!result.accepted || result.matches[0]?.labelId !== label) throw Error(`Failed ${label}/${pace}: ${JSON.stringify(result)}`);
      cases.push({ label, pace, score: result.matches[0].score });
    }
    const partial = await model.predict(clip("loop").slice(0, 15));
    if (partial.accepted) throw Error("Unfinished loop accepted");
    const latency = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now(); await model.predict(clip("loop")); latency.push(performance.now() - start);
    }
    latency.sort((a, b) => a - b);
    const stream = new SignSegmenter(), frames = clip("loop"), events = [];
    const prefix = Array.from({ length: 8 }, (_, i) => ({ ...frames[0], t: i * 40 }));
    const action = frames.map(f => ({ ...f, t: f.t + 320 }));
    const tail = Array.from({ length: 20 }, (_, i) => ({ ...frames.at(-1), t: 1560 + i * 40 }));
    for (const frame of [...prefix, ...action, ...tail]) {
      stream.push(frame); const candidate = stream.candidate();
      if (!candidate) continue;
      const result = await model.predict(candidate);
      if (result.accepted) { events.push({ label: result.matches[0].labelId, t: frame.t }); stream.confirm(stream.revision); }
    }
    if (events.length !== 1 || events[0].label !== "loop" || events[0].t < 1520) throw Error(`Premature/duplicate stream emission: ${JSON.stringify(events)}`);
    const archive = await model.exportModel();
    const imported = new TemporalClassifier(); await imported.importModel(archive);
    const restored = await imported.predict(clip("loop"));
    if (!restored.accepted || restored.matches[0].labelId !== "loop") throw Error("Motion metadata lost in model export");
    imported.dispose(); model.dispose();
    return { kind: "Synthetic geometry software regression; not human signing accuracy", backend: summary.backend,
      parameters: summary.parameters, archiveBytes: archive.size, validationAccuracy: summary.validationAccuracy,
      cases, partialRejected: !partial.accepted, events, endpointDelayMs: events[0].t - 1520,
      classifierMs: { p50: latency[15], p95: latency[28], samples: latency.length } };
  });
  await page.getByRole("button", { name: "Thu mẫu", exact: true }).click();
  await page.getByLabel("Kiểu ký hiệu", { exact: true }).selectOption("dynamic");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Thu mẫu", exact: true }).click();
  await expect(page.getByLabel("Kiểu ký hiệu", { exact: true })).toHaveValue("dynamic");
  await writeFile("qa/motion-report.json", JSON.stringify(report, null, 2));
  console.log("MOTION_PASS", JSON.stringify(report));
} finally { await browser.close(); }
