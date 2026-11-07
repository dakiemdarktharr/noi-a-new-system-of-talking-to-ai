import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const records = new Map(), errors = [], report = {}, clients = [];
let writes = 0, badAck = false, hold = null;
const ids = () => [...records.keys()].sort();
async function client() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const state = { broken: false };
  await context.route('**/api/archive?**', async route => {
    const req = route.request(), action = new URL(req.url()).searchParams.get('action');
    if (action === 'session') return route.fulfill({ json: { connected: true } });
    if (action !== 'workspace') return route.fulfill({ json: { samples: [], completed: [], labels: [] } });
    if (state.broken) return route.fulfill({ status: 503, json: { error: 'Kho gián đoạn kiểm thử.' } });
    if (req.method() === 'GET') return route.fulfill({ json: { heads: [...records.values()] } });
    const body = req.postDataJSON();
    if (hold) { const pending = hold; hold = null; pending.started(); await pending.promise; }
    if (!records.has(body.id)) {
      if (JSON.stringify(body.parents.sort()) !== JSON.stringify(ids())) return route.fulfill({ status: 409, json: { error: 'Graph đã thay đổi.' } });
      records.clear(); records.set(body.id, { ...body, updatedAt: new Date().toISOString() }); writes++;
    }
    const id = badAck ? 'wrong-id' : body.id; badAck = false;
    return route.fulfill({ json: { id, heads: [...records.values()] } });
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e)));
  const open = async () => { await page.goto('http://127.0.0.1:5173'); await page.getByRole('button', { name: 'Thu mẫu', exact: true }).click(); await page.getByRole('button', { name: 'Block', exact: true }).click(); };
  const status = () => page.locator('.workspace-sync > [role=status]');
  const saved = () => expect(status()).toHaveText('Đã đồng bộ', { timeout: 20000 });
  const find = async label => { await page.getByLabel('Tìm block', { exact: true }).fill(label); await page.locator('.graph-search .graph-results').getByRole('button', { name: label, exact: true }).click(); };
  const attach = async (label, target) => { await find(label); await page.getByRole('button', { name: 'Ghép dưới', exact: true }).click(); await page.getByLabel('Từ đứng trước block đang chọn').fill(target); await page.locator('.graph-attach').getByRole('button', { name: target, exact: true }).click(); };
  const sync = () => page.locator('.workspace-sync').getByRole('button', { name: 'Đồng bộ', exact: true }).click();
  const local = () => page.evaluate(() => JSON.parse(localStorage.getItem('noi-workspace-v1')));
  const instance = { context, page, state, open, saved, find, attach, sync, local, status }; clients.push(instance); return instance;
}
try {
  const a = await client(); await a.open(); await a.saved();
  await a.attach('chúng ta', 'tôi');
  await a.page.locator('.graph-actions').getByRole('button', { name: 'Thêm từ', exact: true }).click();
  await a.page.getByRole('dialog', { name: 'Thêm từ', exact: true }).locator('input').fill('từ đồng bộ kiểm thử');
  await a.page.getByRole('button', { name: 'Lưu từ', exact: true }).click();
  await a.saved();
  const b = await client(); await b.open(); await b.saved(); await b.find('tôi');
  await expect(b.page.locator('.graph-canvas')).toHaveAttribute('data-total-blocks', '6001');
  await expect(b.page.locator('.graph-chain button')).toHaveText(['tôi', 'chúng ta', 'chúng tôi']);
  expect((await b.local()).data).toEqual((await a.local()).data); report.newDeviceRestoresAll = true;
  a.state.broken = true;
  await a.attach('bạn', 'tôi'); await a.sync();
  await expect(a.status()).toHaveText('Chờ thử lại');
  const pending = (await a.local()).data;
  await a.open(); expect((await a.local()).data).toEqual(pending); report.pendingSurvivesReload = true;
  await b.attach('chúng ta', 'bạn'); await b.saved();
  const remoteBeforeConflict = structuredClone([...records.values()][0]);
  a.state.broken = false; await a.sync();
  await expect(a.status()).toHaveText('Chọn bản graph');
  expect([...records.values()][0]).toEqual(remoteBeforeConflict); report.noSilentOverwrite = true;
  await a.page.getByRole('button', { name: /Dùng bản trên máy/ }).click(); await a.saved();
  expect([...records.values()][0].data).toEqual(pending); report.explicitConflictResolution = true;
  await b.sync(); await b.saved(); expect((await b.local()).data).toEqual(pending);

  // New edits arriving while a POST is in flight must remain dirty until a
  // second acknowledged write, rather than being cleared by the first ACK.
  let release, started;
  const began = new Promise(r => { started = r; });
  hold = { started, promise: new Promise(r => { release = r; }) };
  await a.attach('chúng ta', 'tôi'); await a.sync(); await began;
  await a.attach('chúng tôi', 'bạn');
  const latest = (await a.local()).data; release(); await a.saved();
  expect([...records.values()][0].data).toEqual(latest); report.editsDuringUploadPreserved = true;
  badAck = true; await a.attach('chúng ta', 'bạn'); await a.sync();
  await expect(a.status()).toHaveText('Chờ thử lại');
  expect((await a.local()).dirty).toBe(true);
  await a.sync(); await a.saved(); report.invalidAckRetriesSafely = true;
  await a.context.setOffline(true);
  await a.attach('bạn', 'chúng ta');
  await expect(a.status()).toHaveText('Chờ mạng');
  expect((await a.local()).dirty).toBe(true);
  await a.context.setOffline(false); await a.saved(); report.offlineQueueResumes = true;
  const sameBrowser = await a.context.newPage();
  await sameBrowser.goto('http://127.0.0.1:5173');
  await a.attach('chúng ta', 'tôi'); await a.saved();
  await expect.poll(() => sameBrowser.evaluate(() => JSON.parse(localStorage.getItem('noi-workspace-v1')).dirty)).toBe(false);
  await sameBrowser.close(); report.sharedBrowserStorage = true;
  expect(errors).toEqual([]);
  report.writes = writes; report.pageErrors = errors;
  await writeFile('qa/workspace-sync-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await browser.close(); }
