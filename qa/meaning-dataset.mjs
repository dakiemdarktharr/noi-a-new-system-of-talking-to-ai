// Isolated browser, synthetic measured geometry and real local TF classifier.
// Exercises UI wiring, not webcam accuracy. Never opens the user's profile.
import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const page = await browser.newPage();
const errors = []; page.on("pageerror", e => errors.push(String(e)));
const report = { scope: "Synthetic geometry with actual TF training, persistence, command decoding and UI" };
try {
  await page.goto("http://127.0.0.1:5173");
  report.dataset = await page.evaluate(async () => {
    const { fixtureSequence } = await import("/src/lib/fixtures.ts");
    const { importSamples, listSamples } = await import("/src/lib/storage.ts");
    const { packDataset, readDataset } = await import("/src/lib/dataset.ts");
    const { TemporalClassifier } = await import("/src/lib/temporal.ts");
    const known = new Set(["NOI0001", "NOI0002"]);
    const samples = ["tôi", "bạn"].flatMap((label, j) => Array.from({ length: 6 }, (_, i) => ({
      id: `qa-${j}-${i}`, labelId: j ? "NOI0002" : "NOI0001", label, schema: 1,
      sessionId: `s${Math.floor(i / 2)}`, createdAt: new Date().toISOString(), durationMs: 2950,
      frames: fixtureSequence(j * 90), gestureKind: "static", videoBlob: new Blob(["qa video"], { type: "video/webm" }),
    })));
    await importSamples(samples);
    const json = new File([JSON.stringify({ schema: 1, samples })], "clips.json");
    await importSamples(await readDataset(json, known));
    const saved = await listSamples();
    if (saved.length !== 12 || saved.some(s => !s.videoBlob?.size || s.gestureKind !== "static")) throw Error("JSON lost video/type or duplicated IDs");
    const zip = await packDataset(saved), roundTrip = await readDataset(new File([zip], "clips.zip"), known);
    if (roundTrip.length !== 12 || roundTrip.some(s => s.gestureKind !== "static" || !s.videoBlob?.size)) throw Error("ZIP roundtrip failed");
    const model = new TemporalClassifier();
    const summary = await model.train(roundTrip, () => {}, { epochs: 22, seed: 17 });
    if (summary.sampleCount !== 12 || summary.trainCount + summary.validationCount !== 12 || summary.labels.some(l => l.samples !== 6)) throw Error("Training omitted samples/labels");
    const exported = await model.exportModel();
    const copy = new TemporalClassifier(); await copy.importModel(exported);
    for (const [j, labelId] of ["NOI0001", "NOI0002"].entries()) {
      const result = await copy.predict(fixtureSequence(j * 90));
      if (!result.accepted || result.matches[0].labelId !== labelId) throw Error("Exported model predicts wrong label");
    }
    copy.dispose(); model.dispose();
    return { samples: saved.length, labels: summary.labels, train: summary.trainCount, validation: summary.validationCount, videoPreserved: true, modelZipBytes: exported.size };
  });
  await page.reload();
  await expect(page.locator(".model-state")).toHaveText("2 nhãn đã học", { timeout: 20000 });
  // Existing user meanings must migrate into the graph without losing custom
  // labels. Persist through the graph UI, then use that map in live decoding.
  await page.evaluate(() => localStorage.setItem("noi-meanings-v1", JSON.stringify({ NOI0001: ["tôi", "chúng tôi", "nhóm tôi", "tất cả chúng tôi"] })));
  await page.reload();
  await page.getByRole("button", { name: "Chuyển nghĩa", exact: true }).click();
  await page.getByLabel("Tìm block", { exact: true }).fill("tôi");
  await page.locator(".graph-search .graph-results").getByRole("button", { name: "tôi", exact: true }).click();
  await expect(page.locator(".graph-chain button")).toHaveText(["tôi", "chúng tôi", "nhóm tôi", "tất cả chúng tôi"]);
  await page.getByRole("button", { name: "Tách", exact: true }).click();
  await page.getByLabel("Hoàn tác graph", { exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("noi-meaning-graph-v1")).chains[0].length)).toBe(4);
  await page.reload();
  await expect(page.locator(".model-state")).toHaveText("2 nhãn đã học", { timeout: 20000 });
  await page.evaluate(async () => {
    const { fixtureHand } = await import("/src/lib/fixtures.ts");
    const { extractHand } = await import("/src/lib/geometry.ts");
    const open = fixtureHand(), fist = fixtureHand();
    for (const mcp of [5, 9, 13, 17]) {
      const p = fist.world[mcp];
      fist.world[mcp + 1] = { x: p.x, y: p.y - .025, z: -.02 };
      fist.world[mcp + 2] = { x: p.x, y: p.y - .006, z: -.035 };
      fist.world[mcp + 3] = { x: p.x, y: p.y + .018, z: -.025 };
    }
    fist.landmarks = fist.world.map(p => ({ x: .5 + p.x * 2, y: .7 + p.y * 2, z: p.z * 2 }));
    if (extractHand(fist).curls.slice(1).some(c => c < .62)) throw Error("Invalid fist fixture");
    window.__poses = { open, fist }; window.__pose = "open"; window.__trace = [];
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
    const paint = () => { canvas.getContext("2d").fillRect(0, 0, 640, 480); requestAnimationFrame(paint); }; paint();
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(60);
    window.Worker = class {
      postMessage(message) {
        if (message.type === "init") queueMicrotask(() => this.onmessage?.({ data: { type: "ready", model: "QA geometry", delegate: "QA" } }));
        else { message.bitmap.close(); window.__trace.push([message.t, window.__pose]); queueMicrotask(() => this.onmessage?.({ data: { type: "result", t: message.t, hands: [window.__poses[window.__pose]], width: 4, height: 3, inferenceMs: 1 } })); }
      }
      terminate() {}
    };
  });
  await page.getByRole("button", { name: "Bật camera", exact: true }).click();
  await expect(page.locator(".prediction > span")).toHaveText("tôi", { timeout: 15000 });
  // Timer transitions use the actual useCamera frame scheduling and decoder.
  const events = await page.evaluate(async () => {
    const observed = [];
    const observer = new MutationObserver(() => observed.push(document.querySelector(".prediction > span")?.textContent));
    observer.observe(document.querySelector(".prediction"), { childList: true, subtree: true, characterData: true });
    for (let i = 0; i < 3; i++) {
      window.__pose = "fist"; await new Promise(r => setTimeout(r, 300));
      window.__pose = "open"; await new Promise(r => setTimeout(r, 250));
    }
    await new Promise(r => setTimeout(r, 1100));
    observer.disconnect(); return observed;
  });
  console.log("COMMAND_TRACE", JSON.stringify({ events, frames: await page.evaluate(() => window.__trace.reduce((out, row) => { const last = out.at(-1); if (last?.pose === row[1]) { last.end = row[0]; last.count++; } else out.push({ pose: row[1], start: row[0], end: row[0], count: 1 }); return out; }, [])) }));
  await expect(page.locator(".prediction > span")).toHaveText("tất cả chúng tôi");
  if (!["chúng tôi", "nhóm tôi", "tất cả chúng tôi"].every(word => events.includes(word))) throw Error("Lost an individual press: " + JSON.stringify(events));
  await page.evaluate(async () => {
    window.__pose = "fist"; await new Promise(r => setTimeout(r, 300));
    window.__pose = "open";
  });
  await expect(page.locator(".prediction > span")).toHaveText("tôi");
  report.command = { events, repeatedThreeTimes: true, endpointDoesNotOverwrite: true, wraparound: true };
  await page.getByRole("button", { name: "Thu mẫu", exact: true }).click();
  await expect(page.locator(".sample-row")).toHaveCount(12);
  await page.getByLabel("Lọc mẫu để xuất").selectOption("label");
  await expect(page.locator(".sample-row")).toHaveCount(6);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Xóa dataset trên máy", exact: true }).click();
  await expect(page.locator(".sample-row")).toHaveCount(0);
  await expect(page.locator(".model-state")).toHaveText("Chưa huấn luyện");
  await page.reload();
  await expect(page.locator(".model-state")).toHaveText("Chưa huấn luyện");
  const remaining = await page.evaluate(async () => (await (await import("/src/lib/storage.ts")).listSamples()).length);
  if (remaining) throw Error("Reset left samples on disk");
  report.clearAllDespiteLabelFilter = true;
  report.errors = errors; if (errors.length) throw Error(errors.join("\n"));
  await writeFile("qa/meaning-dataset-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) { console.error("PAGE_ERRORS", errors); throw error; }
finally { await browser.close(); }
