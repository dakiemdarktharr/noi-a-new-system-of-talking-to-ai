import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
  }),
  page = await context.newPage(),
  results = [];
try {
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  const check = async (state) => {
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    results.push({
      state,
      violations: r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          html: n.html,
          summary: n.failureSummary,
        })),
      })),
    });
  };
  await check("recognize");
  await page.getByRole("button", { name: "Thu mẫu", exact: true }).click();
  await check("collect");
  await page.locator(".vocabulary-button").click();
  await check("vocabulary");
  await page.keyboard.press("Escape");
  await expect(page.locator(".vocabulary-dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Thông số theo dõi", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Kiểm tra rotation", exact: true })
    .click();
  await check("rotation dialog");
  await page.keyboard.press("Escape");
  await expect(page.locator(".lab-modal")).not.toBeVisible();
  await writeFile(
    "qa/accessibility-report.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
  if (results.some((r) => r.violations.length)) process.exitCode = 1;
} finally {
  await browser.close();
}
