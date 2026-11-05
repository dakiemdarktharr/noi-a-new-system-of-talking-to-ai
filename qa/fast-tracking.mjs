import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
try {
  // Isolate the benchmark from app HMR reloads while other work is in progress.
  await page.route('**/qa/fast-benchmark', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Tracker benchmark</title>' }));
  await page.goto('http://127.0.0.1:5173/qa/fast-benchmark');
  const report = await page.evaluate(async requestedDelegate => {
    const { extractHand, quaternionDistance, degrees } = await import('/src/lib/geometry.ts');
    const image = await createImageBitmap(await (await fetch('/qa/right_hands.jpg')).blob());
    const canvas = new OffscreenCanvas(640, 480), ctx = canvas.getContext('2d');
    const gl = new OffscreenCanvas(16, 16).getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    const results = [];
    const draw = (mode, i = 0) => {
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 640, 480);
      const hand = (x, y, angle, mirror, size) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(angle * Math.PI / 180); if (mirror) ctx.scale(-1, 1);
        ctx.drawImage(image, 360, 0, 360, 382, -size / 2, -size * 382 / 720, size, size * 382 / 360); ctx.restore();
      };
      if (mode === 'two') { hand(165, 240, 0, false, 225); hand(475, 240, 0, true, 225); }
      else if (mode === 'quick') { const phase = i / 60 * Math.PI * 6; hand(320 + 90 * Math.sin(phase), 240, 35 * Math.sin(phase), false, 300); }
      else hand(320, 240, mode === 'rotate' ? 90 : 0, false, 300);
    };
    const percentile = (values, p) => values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
    for (const variant of ['full', 'lite']) {
      const worker = new Worker('/src/workers/hand.worker.ts', { type: 'module' });
      const wait = () => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Worker timeout')), 45000);
        worker.onmessage = e => { clearTimeout(timer); e.data.type.includes('error') ? reject(Error(e.data.message)) : resolve(e.data); };
        worker.onerror = e => { clearTimeout(timer); reject(Error(e.message)); };
      });
      let t = 1;
      const init = wait(), started = performance.now();
      worker.postMessage({ type: 'init', base: location.origin, variant, delegate: requestedDelegate });
      const ready = await init, initMs = performance.now() - started;
      const infer = async () => {
        const bitmap = await createImageBitmap(canvas), pending = wait();
        worker.postMessage({ type: 'frame', bitmap, t: t += 1000 / 60 }, [bitmap]);
        return await pending;
      };
      draw('one');
      const cold = await infer();
      for (let i = 0; i < 8; i++) await infer();
      const staticRows = [];
      for (let i = 0; i < 25; i++) staticRows.push(await infer());
      const neutral = extractHand(staticRows.at(-1).hands[0], 640 / 480);
      draw('rotate'); let rotated;
      for (let i = 0; i < 5; i++) { const row = await infer(); if (row.hands[0]) rotated = extractHand(row.hands[0], 640 / 480); }
      draw('two'); const both = [];
      for (let i = 0; i < 20; i++) both.push(await infer());
      const quick = [];
      for (let i = 0; i < 60; i++) { draw('quick', i); quick.push(await infer()); }
      const stat = rows => ({ frames: rows.length, detected: rows.filter(row => row.hands.length > 0).length,
        p50InferenceMs: percentile(rows.map(row => row.inferenceMs), .5), p95InferenceMs: percentile(rows.map(row => row.inferenceMs), .95) });
      results.push({ variant, model: ready.model, delegate: ready.delegate, initMs, coldInferenceMs: cold.inferenceMs,
        static: stat(staticRows), twoHands: { ...stat(both), bothDetected: both.filter(row => row.hands.length === 2).length,
          distinctSides: both.filter(row => new Set(row.hands.map(h => h.side)).size === 2).length },
        quickPhotoSequence: stat(quick), orientationDeltaDegrees: neutral && rotated ? degrees(quaternionDistance(neutral.quaternion, rotated.quaternion)) : null,
        allLandmarkCountsValid: [...staticRows, ...both, ...quick].every(row => row.hands.every(h => h.landmarks.length === 21 && h.world.length === 21)) });
      worker.terminate();
    }
    image.close();
    return { kind: 'Real hand photo + synthetic 3Hz rigid translation/rotation sampled at 60Hz; NOT real signing or real camera throughput',
      browser: navigator.userAgent, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable',
      inputSize: [640, 480], fixture: 'qa/right_hands.jpg, existing MediaPipe test fixture', results };
  }, process.env.TRACKING_DELEGATE || 'GPU');
  report.pageErrors = errors;
  await writeFile(process.env.TRACKING_DELEGATE === 'CPU' ? 'qa/fast-tracking-cpu-report.json' : 'qa/fast-tracking-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
