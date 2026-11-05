import { chromium } from '@playwright/test';
import { writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const baselineCommit = 'dc4f69b2daf772ca2b9515f69112a560168893ba';
const legacy = execFileSync('git', ['show', baselineCommit + ':src/hooks/useCamera.ts'], { encoding: 'utf8' })
  .replace('"../lib/geometry"', '"/src/lib/geometry"')
  .replace('"../types"', '"/src/types"')
  .replace('new URL("../workers/hand.worker.ts", import.meta.url)', 'new URL("/src/workers/hand.worker.ts", location.origin)')
  .replace('{ type: "init", base: location.origin }', '{ type: "init", base: location.origin, variant: "full" }');
await writeFile('qa/.legacy-camera.ts', legacy);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
try {
  await page.route('**/qa/camera-benchmark', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Camera pipeline benchmark</title><div id="root"></div>' }));
  await page.goto('http://127.0.0.1:5173/qa/camera-benchmark');
  const report = await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { useCamera } = await import('/src/hooks/useCamera.ts');
    const { useCamera: useLegacyCamera } = await import('/qa/.legacy-camera.ts');
    const image = new Image(); image.src = '/qa/right_hands.jpg'; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d');
    let animated = true;
    function draw(time) {
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 640, 480);
      ctx.save(); ctx.translate(320 + 70 * Math.sin(time / 1000 * Math.PI * 4), 240);
      ctx.rotate(20 * Math.sin(time / 1000 * Math.PI * 4) * Math.PI / 180);
      ctx.drawImage(image, 360, 0, 360, 382, -150, -159, 300, 318); ctx.restore();
      if (animated) requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
    let constraints;
    navigator.mediaDevices.getUserMedia = async options => { constraints = options; return canvas.captureStream(options.video.frameRate?.max ?? 60); };
    let camera, frames = [];
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    function Harness({ old }) {
      camera = (old ? useLegacyCamera : useCamera)(frame => frames.push({ t: frame.t, arrival: performance.now(), hands: frame.hands.length, points: frame.hands.map(h => h.landmarks.length) }));
      return React.createElement('video', { ref: camera.videoRef, autoPlay: true, muted: true, playsInline: true, width: 640, height: 480 });
    }
    const root = createRoot(document.getElementById('root'));
    const results = [];
    for (const [run, variant] of ['legacy', 'lite', 'full', 'lite'].entries()) {
      camera = null; root.render(React.createElement(Harness, { key: run, old: variant === 'legacy' }));
      while (!camera) await wait(20);
      frames = [];
      await camera.start(variant === 'legacy' ? undefined : variant);
      const deadline = performance.now() + 30000;
      while (frames.length < 30 && !camera.error && performance.now() < deadline) await wait(50);
      if (camera.error || frames.length < 30) throw Error(camera.error || 'No usable camera frames');
      frames = []; await wait(5000);
      const elapsed = frames.at(-1).t - frames[0].t;
      const age = frames.map(f => f.arrival - f.t).sort((a, b) => a - b);
      results.push({ variant, requestedConstraints: constraints, frames: frames.length, spanMs: elapsed, measuredFps: (frames.length - 1) * 1000 / elapsed,
        detectedFrames: frames.filter(f => f.hands > 0).length, all21: frames.every(f => f.points.every(n => n === 21)),
        timestampsStrictlyIncreasing: frames.every((f, i) => i === 0 || f.t > frames[i - 1].t),
        p50CaptureToResultMs: age[Math.floor(age.length * .5)], p95CaptureToResultMs: age[Math.floor(age.length * .95)],
        metrics: camera.metrics });
      camera.stop(); await wait(150);
    }
    animated = false; root.unmount();
    return { kind: 'Actual useCamera pipeline using canvas.captureStream respecting requested max fps, photo with synthetic 2Hz motion. Not physical camera or human signing.', requestVideoFrameCallback: typeof HTMLVideoElement.prototype.requestVideoFrameCallback === 'function', results };
  });
  await writeFile('qa/fast-camera-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await unlink('qa/.legacy-camera.ts'); }
