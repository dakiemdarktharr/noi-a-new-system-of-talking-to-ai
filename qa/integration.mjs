import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [],
  remote = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("request", (r) => {
  if (
    !r.url().startsWith("http://127.0.0.1:5173") &&
    !r.url().startsWith("blob:") &&
    !r.url().startsWith("data:")
  )
    remote.push(r.url());
});
const report = {
  kind: "software integration; photo fixture and synthetic motion, NOT human signing accuracy",
};
try {
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  report.tracker = await page.evaluate(async () => {
    const { extractHand, quaternionDistance, degrees } = await import(
      "/src/lib/geometry.ts"
    );
    const photo = await createImageBitmap(
      await (await fetch("/qa/right_hands.jpg")).blob(),
    );
    const worker = new Worker("/src/workers/hand.worker.ts", {
      type: "module",
    });
    const wait = () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("worker timeout")), 45000);
        worker.onmessage = (e) => {
          clearTimeout(timer);
          e.data.type.includes("error")
            ? reject(Error(e.data.message))
            : resolve(e.data);
        };
        worker.onerror = (e) => {
          clearTimeout(timer);
          reject(Error(e.message));
        };
      });
    const readyPromise = wait();
    worker.postMessage({ type: "init", base: location.origin });
    const ready = await readyPromise;
    const results = [];
    for (const angle of [0, 90]) {
      const c = new OffscreenCanvas(512, 512),
        ctx = c.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 512, 512);
      ctx.translate(256, 256);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.drawImage(photo, 360, 0, 360, 382, -180, -191, 360, 382);
      let response;
      for (let retry = 0; retry < 5; retry++) {
        const bitmap = await createImageBitmap(c),
          pending = wait();
        worker.postMessage({ type: "frame", bitmap, t: performance.now() }, [
          bitmap,
        ]);
        response = await pending;
        if (response.hands.length) break;
      }
      const hand = response.hands[0];
      if (!hand)
        throw Error(
          "Fixture hand not detected at " +
            angle +
            " using " +
            ready.delegate +
            " in " +
            response.inferenceMs +
            " ms",
        );
      const feature = extractHand(hand, 1);
      if (!feature) throw Error("Invalid real geometry");
      results.push({
        side: hand.side,
        points: hand.landmarks.length,
        ms: response.inferenceMs,
        roll: feature.roll,
        feature,
      });
    }
    worker.terminate();
    photo.close();
    window.__qaHandFeatures = results.map((r) => r.feature);
    const delta = degrees(
      quaternionDistance(
        results[0].feature.quaternion,
        results[1].feature.quaternion,
      ),
    );
    if (delta < 65 || delta > 115) throw Error("Rotation lost: " + delta);
    return {
      delegate: ready.delegate,
      orientationDeltaDegrees: delta,
      frames: results.map(({ feature, ...r }) => r),
    };
  });
  console.log("TRACKER", JSON.stringify(report.tracker));
  // This isolated browser context never touches the user's browser/model storage.
  report.persistence = await page.evaluate(async () => {
    const { TemporalClassifier } = await import("/src/lib/temporal.ts");
    const fixtureSequence = (i) =>
      Array.from({ length: 60 }, (_, n) => ({
        t: n * 50,
        hands: [window.__qaHandFeatures[i]],
      }));
    const model = new TemporalClassifier();
    const samples = ["A", "NO_SIGN"].flatMap((label, i) =>
      Array.from({ length: 6 }, (_, j) => ({
        id: label + j,
        labelId: label,
        label,
        schema: 1,
        sessionId: "s" + Math.floor(j / 2),
        createdAt: new Date().toISOString(),
        durationMs: 2950,
        frames: fixtureSequence(i),
      })),
    );
    const trained = await model.train(samples, () => {}, {
      epochs: 20,
      seed: 17,
    });
    if (!trained.persisted) throw Error("Model not persisted");
    model.dispose();
    const reloaded = new TemporalClassifier(),
      summary = await reloaded.load();
    if (!summary) throw Error("Model not restored");
    const positive = await reloaded.predict(fixtureSequence(0)),
      negative = await reloaded.predict(fixtureSequence(1));
    reloaded.dispose();
    if (
      !positive.accepted ||
      positive.matches[0].labelId !== "A" ||
      negative.accepted
    )
      throw Error("Reload inference mismatch");
    return {
      parameters: summary.parameters,
      backend: summary.backend,
      persisted: summary.persisted,
      positive: positive.matches[0].labelId,
      negativeRejected: !negative.accepted,
    };
  });
  console.log("PERSISTENCE", JSON.stringify(report.persistence));
  // A real photograph rendered into a canvas is used as the camera input.
  // Neither fixture labels nor test weights are shipped in the application.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".model-state")).toHaveText("2 nhãn đã học", {
    timeout: 15000,
  });
  await page.evaluate(async () => {
    const image = new Image();
    image.src = "/qa/right_hands.jpg";
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    const draw = () => {
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(image, 360, 0, 360, 382, 76, 65, 360, 382);
      requestAnimationFrame(draw);
    };
    draw();
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(30);
  });
  await page.getByRole("button", { name: "Bật camera", exact: true }).click();
  await expect(page.locator(".camera-state")).toHaveText("Camera đang bật", {
    timeout: 60000,
  });
  await expect(page.locator(".stage-badges")).toContainText("1 tay", {
    timeout: 15000,
  });
  await expect(page.locator(".prediction.detected>span")).toHaveText("A", {
    timeout: 25000,
  });
  await page.getByRole("button", { name: "Thêm từ dự đoán vào câu" }).click();
  await expect(page.getByLabel("Câu đã chọn")).toHaveValue("A");
  report.liveWordDisplayed = true;
  await page.getByRole("button", { name: "Thu mẫu", exact: true }).click();
  await page.getByRole("button", { name: "Quay mẫu", exact: true }).click();
  await expect(page.locator(".sample-row")).toHaveCount(1, { timeout: 15000 });
  report.capture = await page.evaluate(async () => {
    const { listSamples } = await import("/src/lib/storage.ts");
    const [s] = await listSamples();
    return {
      label: s.label,
      frames: s.frames.length,
      durationMs: s.durationMs,
      videoBytes: s.videoBlob.size,
      videoType: s.videoBlob.type,
      points: s.frames[0].hands[0].landmarks.length,
    };
  });
  console.log("CAPTURE", JSON.stringify(report.capture));
  await page.screenshot({ path: "qa/collect-desktop.png", fullPage: true });
  await page
    .getByRole("button", { name: "Xem video tôi", exact: true })
    .click();
  await expect(page.locator(".preview-modal video")).toBeVisible();
  await page.getByRole("button", { name: "Đóng video", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Xuất ZIP", exact: true }).click(),
  ]);
  await download.saveAs("qa/test-dataset.zip");
  await page.getByRole("button", { name: "Xóa mẫu tôi", exact: true }).click();
  await expect(page.locator(".sample-row")).toHaveCount(0);
  await page.locator('input[accept=".json,.zip"]').setInputFiles("qa/test-dataset.zip");
  await expect(page.locator(".sample-row")).toHaveCount(1);
  report.zipRoundTrip = true;
  await page.getByRole("button", { name: "Đổi nhãn tôi", exact: true }).click();
  await page.getByLabel("Tìm từ vựng").fill("chúng ta");
  await page
    .locator(".vocab-item")
    .filter({ hasText: "chúng ta" })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Đổi nhãn chúng ta", exact: true }),
  ).toBeVisible();
  report.relabel = true;
  await page.getByRole("button", { name: "Tắt", exact: true }).click();
  await page.locator(".vocabulary-button").click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.getByLabel("Tìm từ vựng").fill("trí tuệ");
  await expect(page.locator(".vocab-item").first()).toBeVisible();
  expect(await page.locator(".vocab-item").count()).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Nhận diện", exact: true }).click();
  await page.screenshot({ path: "qa/recognize-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "qa/mobile.png", fullPage: true });
  report.mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (report.mobileOverflow) throw Error("Mobile horizontal overflow");
  report.pageErrors = errors;
  report.externalRequests = remote;
  if (errors.length || remote.length)
    throw Error("Errors or external runtime request");
  await writeFile(
    "qa/integration-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log("INTEGRATION_PASS");
} finally {
  await browser.close();
}
