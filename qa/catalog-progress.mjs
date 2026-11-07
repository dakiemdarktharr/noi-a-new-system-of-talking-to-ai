import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import JSZip from "jszip";
import { readFile, writeFile } from "node:fs/promises";

// All storage belongs to a fresh headless context. The ZIP contains QA camera
// fixtures only. Copies test bookkeeping; they are not 30 independent signs.
const browser = await chromium.launch({ channel: "msedge", headless: true });
const report = { scope: "UI/persistence/progress bookkeeping with duplicated QA video; not dataset diversity or model accuracy", checks: [] };
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(String(error)));
  const cloudRequests = [];
  let connected = false;
  let workspace = null;
  await page.route("**/api/archive?**", async route => {
    const request = route.request();
    cloudRequests.push({ method: request.method(), url: request.url() });
    const action = new URL(request.url()).searchParams.get("action");
    if (action === "workspace") {
      if (request.method() === "POST") workspace = { ...request.postDataJSON(), updatedAt: new Date().toISOString() };
      return route.fulfill({ json: { ...(workspace ? { id: workspace.id } : {}), heads: workspace ? [workspace] : [] } });
    }
    if (action === "connect" && request.method() === "POST") connected = true;
    if (action === "session" || action === "connect") {
      await route.fulfill({ json: { connected } });
      return;
    }
    if (request.method() !== "GET") throw Error("This UI test must not write to a cloud archive");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ samples: [{ id: "qa-cloud-only-fixture", bytes: 42000 }] }) });
  });
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Thu mẫu", exact: true }).click();
  const initialGoal = await page.locator(".goal-meter progress").getAttribute("max");
  const label = "cụm kiểm thử Nối ba mươi";
  await page.locator(".side-panel").getByRole("button", { name: "Thêm từ", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Thêm từ", exact: true });
  await expect(modal).toBeVisible();
  report.initialAutofocus = await modal.getByLabel("Từ hoặc cụm từ").evaluate(el => document.activeElement === el);
  await modal.getByLabel("Từ hoặc cụm từ").fill(`  ${label}  `);
  await page.screenshot({ path: "qa/catalog-new-word-desktop.png", fullPage: true });
  await modal.getByRole("button", { name: "Lưu từ", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.locator(".label-select")).toHaveText(label);
  await expect(page.locator(".goal-meter progress")).toHaveAttribute("max", String(Number(initialGoal) + 1));
  const custom = await page.evaluate(() => JSON.parse(localStorage.getItem("noi-custom-words-v1")));
  expect(custom).toHaveLength(1);
  expect(custom[0].label).toBe(label);
  report.checks.push({ name: "Add word trims whitespace, selects word and increments catalog", passed: true });

  await page.locator(".side-panel").getByRole("button", { name: "Thêm từ", exact: true }).click();
  await modal.getByLabel("Từ hoặc cụm từ").fill(label.toLocaleUpperCase("vi"));
  await modal.getByRole("button", { name: "Lưu từ", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Từ này đã có");
  await expect(modal).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("noi-custom-words-v1")).length)).toBe(1);
  report.checks.push({ name: "Duplicate label rejected regardless of case", passed: true });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Thu mẫu", exact: true }).click();
  const selectCustom = async () => {
    await page.locator(".vocabulary-button").click();
    await page.getByLabel("Tìm từ vựng").fill(label);
    await expect(page.locator(".vocab-item")).toHaveCount(1);
    await page.locator(".vocab-item").click();
  };
  await selectCustom();
  await expect(page.locator(".label-select")).toHaveText(label);
  report.checks.push({ name: "Custom word persists after reload and is searchable", passed: true });

  const original = await JSZip.loadAsync(await readFile("qa/test-dataset.zip"));
  const originalData = JSON.parse(await original.file("dataset.json").async("string"));
  const template = originalData.samples.find(sample => sample.videoFile);
  if (!template) throw Error("QA ZIP needs a sample with video");
  const videoBytes = await original.file(template.videoFile).async("nodebuffer");
  const extension = template.videoFile.endsWith(".mp4") ? "mp4" : "webm";
  const bundle = async (count, videoCount, start = 1) => {
    const zip = new JSZip();
    const samples = Array.from({ length: count }, (_, index) => {
      const id = `qa_catalog_${start + index}`;
      const videoFile = index < videoCount ? `videos/${id}.${extension}` : null;
      if (videoFile) zip.file(videoFile, videoBytes);
      return { ...template, id, labelId: custom[0].id, label, sessionId: "qa-catalog-fixture", videoFile };
    });
    zip.file("dataset.json", JSON.stringify({ schema: 1, samples }), { compression: "DEFLATE" });
    return zip.generateAsync({ type: "nodebuffer" });
  };
  const upload = async (buffer, name) => {
    await page.locator('input[accept=".json,.zip"]').setInputFiles({ name, mimeType: "application/zip", buffer });
  };
  await upload(await bundle(30, 29), "qa-29-videos.zip");
  await expect(page.locator(".sample-row")).toHaveCount(30, { timeout: 20000 });
  await expect(page.locator(".side-panel .count-tag")).toHaveText("29/30");
  await expect(page.locator(".side-panel [aria-label='Đủ 30 video']")).toHaveCount(0);
  await expect(page.locator(".goal-meter progress")).toHaveAttribute("value", "0");
  await page.locator(".vocabulary-button").click();
  await page.getByLabel("Tìm từ vựng").fill(label);
  await expect(page.locator(".vocab-item")).not.toHaveClass(/completed/);
  await expect(page.locator(".vocab-item progress")).toHaveAttribute("value", "29");
  await page.keyboard.press("Escape");
  report.checks.push({ name: "30 records with only29 video blobs stays incomplete", passed: true });

  await upload(await bundle(1, 1, 30), "qa-30th-video.zip");
  await expect(page.locator(".side-panel .count-tag")).toHaveText("30/30", { timeout: 20000 });
  await expect(page.locator(".sample-row")).toHaveCount(30);
  await expect(page.locator(".side-panel [aria-label='Đủ 30 video']")).toHaveCount(1);
  await expect(page.locator(".goal-meter progress")).toHaveAttribute("value", "1");
  await page.locator(".vocabulary-button").click();
  await page.getByLabel("Tìm từ vựng").fill(label);
  await expect(page.locator(".vocab-item")).toHaveClass(/completed/);
  await expect(page.locator(".vocab-item progress")).toHaveAttribute("value", "30");
  await expect(page.locator(".vocab-item [aria-label='Đủ 30 video']")).toHaveCount(1);
  await page.locator(".vocab-actions").getByRole("button", { name: "Đủ 30 video", exact: true }).click();
  await expect(page.locator(".vocab-item")).toHaveCount(1);
  await page.screenshot({ path: "qa/catalog-complete-desktop.png", fullPage: true });
  await page.keyboard.press("Escape");
  report.checks.push({ name: "30th video upserts existing record, turns tick on and enters completed filter", passed: true });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Thu mẫu", exact: true }).click();
  await selectCustom();
  await expect(page.locator(".side-panel .count-tag")).toHaveText("30/30");
  await expect(page.locator(".goal-meter progress")).toHaveAttribute("value", "1");
  report.checks.push({ name: "Thirty video records and completion persist after reload", passed: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".side-panel").getByRole("button", { name: "Kho video", exact: true }).click();
  await page.getByLabel("Mã kho", { exact: true }).fill("noi-qa-only-not-a-real-key");
  await page.locator(".cloud-panel").getByRole("button", { name: "Kết nối", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sao lưu nhãn", exact: true })).toBeVisible();
  await expect(page.locator(".cloud-panel")).toContainText("1/30");
  await page.locator(".cloud-files summary").click();
  await expect(page.locator(".cloud-files li")).toHaveCount(1);
  await page.locator(".cloud-panel").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "qa/catalog-cloud-mobile.png", fullPage: true });
  await page.locator(".cloud-panel").screenshot({ path: "qa/catalog-cloud-mobile-detail.png" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  const panelFit = await page.locator(".cloud-panel").evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth;
  });
  expect(panelFit).toBe(true);
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  report.mobileA11y = a11y.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.failureSummary) }));
  expect(report.mobileA11y).toEqual([]);
  expect(cloudRequests.some(r => new URL(r.url).searchParams.has("label"))).toBe(true);
  report.checks.push({ name: "Mobile cloud panel fits; mocked read-only connection renders actions", passed: true });

  await page.getByRole("button", { name: `Xóa mẫu ${label}`, exact: true }).first().click();
  await expect(page.locator(".side-panel .count-tag")).toHaveText("29/30");
  await expect(page.locator(".side-panel [aria-label='Đủ 30 video']")).toHaveCount(0);
  await expect(page.locator(".goal-meter progress")).toHaveAttribute("value", "0");
  await page.locator(".vocabulary-button").click();
  await page.getByLabel("Tìm từ vựng").fill(label);
  await expect(page.locator(".vocab-item")).not.toHaveClass(/completed/);
  await page.locator(".vocab-actions").getByRole("button", { name: "Đủ 30 video", exact: true }).click();
  await expect(page.locator(".vocab-item")).toHaveCount(0);
  report.checks.push({ name: "Deleting one video removes tick and completed-filter membership", passed: true });
  report.pageErrors = errors;
  expect(errors).toEqual([]);
  expect(report.initialAutofocus).toBe(true);
  report.result = "pass";
} catch (error) {
  report.result = "fail";
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await writeFile("qa/catalog-progress-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
