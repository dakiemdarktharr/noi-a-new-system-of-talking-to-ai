import { chromium } from "@playwright/test";
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
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error")
    console.log("CONSOLE_ERROR", m.text().slice(0, 400));
});
await page.goto("http://127.0.0.1:5173", {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.screenshot({ path: "qa/recognize-desktop.png", fullPage: true });
console.log("TITLE", await page.title(), "ERRORS", errors);
await page.getByRole("button", { name: "Bật camera", exact: true }).click();
try {
  await page
    .locator(".camera-state")
    .filter({ hasText: "Camera đang bật" })
    .waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log("CAMERA", await page.locator(".camera-state").innerText());
} catch {
  console.log("CAMERA_FAILED", await page.locator("body").innerText());
}
await page.screenshot({ path: "qa/camera-worker.png", fullPage: true });
console.log("PAGE_ERRORS", errors);
await browser.close();
