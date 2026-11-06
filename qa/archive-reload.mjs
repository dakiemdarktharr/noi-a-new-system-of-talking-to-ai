import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Exercise the real recorder, IndexedDB, and queue. The archive transport is
// simulated here so this test cannot upload anything to the user's bucket.
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const attempts = [];
  let connected = false;
  let rejectUpload = true;
  await context.route("**/api/archive?**", async (route) => {
    const request = route.request();
    const params = new URL(request.url()).searchParams;
    const action = params.get("action");
    if (action === "connect") connected = true;
    if (action === "disconnect") connected = false;
    if (action) return route.fulfill({ json: { connected } });
    if (request.method() === "GET")
      return route.fulfill({ json: { samples: [], completed: [], goal: 30 } });
    attempts.push(params.get("id"));
    return route.fulfill(
      rejectUpload
        ? { status: 503, json: { error: "Kho tạm gián đoạn." } }
        : { status: 201, json: { id: params.get("id"), complete: false } },
    );
  });
  const url = "http://127.0.0.1:5173";
  const photo =
    "data:image/jpeg;base64," +
    (await readFile("qa/right_hands.jpg")).toString("base64");
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Thu mẫu", exact: true }).click();
  await page.getByRole("button", { name: "Kho video", exact: true }).click();
  await page.getByLabel("Mã kho", { exact: true }).fill("qa-only");
  await page.getByRole("button", { name: "Kết nối", exact: true }).click();
  await expect(page.getByText("Tự sao lưu bật", { exact: true })).toBeVisible();

  await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    function draw() {
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 640, 480);
      ctx.drawImage(image, 360, 0, 360, 382, 140, 49, 360, 382);
      requestAnimationFrame(draw);
    }
    draw();
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(60);
  }, photo);
  await page.getByRole("button", { name: "Bật camera", exact: true }).click();
  await expect(page.locator(".stage-badges")).toContainText("1 tay", {
    timeout: 60000,
  });
  await page.getByRole("button", { name: "Quay mẫu", exact: true }).click();
  await expect(page.locator(".backup-state")).toHaveText("Cần thử lại", {
    timeout: 20000,
  });
  expect(attempts).toHaveLength(1);
  await page.getByRole("button", { name: "Tắt", exact: true }).click();

  rejectUpload = false;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Thu mẫu", exact: true }).click();
  await expect(page.locator(".sample-row")).toHaveCount(1);
  await expect(page.locator(".backup-state")).toHaveText("Đã lên kho", {
    timeout: 15000,
  });
  expect(attempts).toEqual([attempts[0], attempts[0]]);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Thu mẫu", exact: true }).click();
  await expect(page.locator(".backup-state")).toHaveText("Đã lên kho");
  expect(attempts).toHaveLength(2);
  console.log(
    "ARCHIVE_RELOAD_PASS: real recording, retained on 503, retried same ID on reload, saved status persists",
  );
} finally {
  await browser.close();
}
