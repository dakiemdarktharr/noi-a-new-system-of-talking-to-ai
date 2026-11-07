import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage(); let release, started, graph;
  const requested = new Promise(resolve => { started = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  await page.route('**/api/archive?**', async route => {
    const req = route.request(), query = new URL(req.url()).searchParams;
    if (query.get('action') === 'session') return route.fulfill({ json: { connected: true } });
    if (query.get('action') === 'workspace') {
      if (req.method() === 'POST') graph = { ...req.postDataJSON(), updatedAt: new Date().toISOString() };
      return route.fulfill({ json: { id: graph?.id, heads: graph ? [graph] : [] } });
    }
    if (query.get('label') === 'NOI0001') { started(); await delayed; return route.fulfill({ json: { samples: [{ id: 'old-label', bytes: 100 }], completed: [] } }); }
    return route.fulfill({ json: { samples: [{ id: 'new-1', bytes: 100 }, { id: 'new-2', bytes: 100 }], completed: [] } });
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Thu mẫu', exact: true }).click();
  await page.getByRole('button', { name: 'Kho video', exact: true }).click(); await requested;
  await page.locator('.label-select').click();
  await page.getByLabel('Tìm từ vựng').fill('bạn');
  await page.locator('.vocab-item').filter({ has: page.locator('strong', { hasText: /^bạn$/ }) }).click();
  await expect(page.locator('.cloud-panel > strong')).toHaveText('2/30');
  release(); await page.waitForTimeout(150);
  await expect(page.locator('.cloud-panel > strong')).toHaveText('2/30');
  await page.locator('.cloud-files summary').click();
  await expect(page.locator('.cloud-files li')).toHaveCount(2);
  console.log('CLOUD_LABEL_RACE_PASS: delayed previous-label response cannot replace current listing');
} finally { await browser.close(); }
