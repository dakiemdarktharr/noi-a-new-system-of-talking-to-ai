import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
  }),
  page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
try {
  await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.screenshot({ path: "qa/app-desktop.png", fullPage: true });
  const fixture =
    "data:image/jpeg;base64," +
    (await readFile("qa/right_hands.jpg")).toString("base64");
  await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 480;
    const ctx = c.getContext("2d");
    const draw = () => {
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 640, 480);
      ctx.drawImage(img, 360, 0, 360, 382, 140, 49, 360, 382);
      requestAnimationFrame(draw);
    };
    draw();
    navigator.mediaDevices.getUserMedia = async () => c.captureStream(30);
  }, fixture);
  await page.getByRole("button", { name: "Bật camera", exact: true }).click();
  await expect(page.locator(".stage-badges")).toContainText("1 tay", {
    timeout: 60000,
  });
  await expect(
    page.locator(".hand-readout").filter({ hasText: "Tay phải" }),
  ).toContainText("Đã thấy");
  await page.getByRole("button", { name: "Tắt", exact: true }).click();
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page.getByRole("button", { name: "Bật camera", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Quyền camera chưa được cấp.",
  );
  await page.getByRole("button", { name: "Thu mẫu", exact: true }).click();
  await page
    .getByRole("button", { name: "Đóng thông báo", exact: true })
    .click();
  await page.screenshot({ path: "qa/app-collect.png", fullPage: true });
  await writeFile(
    "qa/production-report.json",
    JSON.stringify(
      {
        productionWorker: true,
        photoHandTracked: true,
        permissionDeniedHandled: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw Error(errors.join("\n"));
  console.log("PRODUCTION_PASS");
} finally {
  await browser.close();
}
