// Private local files only. Never commit user datasets, videos or models.
// node qa/replay-dataset.mjs <dataset.zip> <model.zip> <report.json>
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";

const [datasetPath, modelPath, reportPath] = process.argv.slice(2);
if (!datasetPath || !modelPath || !reportPath) throw Error("Provide dataset.zip, model.zip and output report.json paths.");
const datasetZip = await JSZip.loadAsync(await readFile(datasetPath));
const dataset = JSON.parse(await datasetZip.file("dataset.json").async("string"));
const model = await readFile(modelPath);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  // Fulfilled entirely in this browser process, never sent to a remote service.
  await page.route("**/__private-replay-data", route => route.fulfill({ json: dataset }));
  await page.route("**/__private-replay-model", route => route.fulfill({ body: model, contentType: "application/zip" }));
  await page.goto("http://127.0.0.1:5173");
  const report = await page.evaluate(async () => {
    const { TemporalClassifier } = await import("/src/lib/temporal.ts");
    const { diagnoseSamples } = await import("/src/lib/diagnostics.ts");
    const { samples } = await (await fetch("/__private-replay-data")).json();
    const classifier = new TemporalClassifier();
    try {
      await classifier.importModel(await (await fetch("/__private-replay-model")).blob());
      return await diagnoseSamples(classifier, samples);
    } finally { classifier.dispose(); }
  });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  const { rows, model: _model, ...totals } = report;
  console.log(JSON.stringify(totals, null, 2));
} finally { await browser.close(); }
