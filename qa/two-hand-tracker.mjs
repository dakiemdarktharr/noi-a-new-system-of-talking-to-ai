import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage(); await page.goto("http://127.0.0.1:5173");
  const report = await page.evaluate(async () => {
    const { extractHand } = await import("/src/lib/geometry.ts");
    const { HandIdentityTracker } = await import("/src/lib/hand-identity.ts");
    const photo = await createImageBitmap(await (await fetch("/qa/right_hands.jpg")).blob());
    const reports = [];
    for (const variant of ["lite", "full"]) {
      const worker = new Worker("/src/workers/hand.worker.ts", { type: "module" });
      const wait = () => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("Tracker timeout")), 45000);
        worker.onmessage = ({ data }) => { clearTimeout(timer); data.type.includes("error") ? reject(Error(data.message)) : resolve(data); };
        worker.onerror = e => { clearTimeout(timer); reject(Error(e.message)); };
      });
      let pending = wait(); worker.postMessage({ type: "init", base: location.origin, variant }); const ready = await pending;
      const identity = new HandIdentityTracker(), frames = [];
      for (const angle of [0, 30, 60, 90, 120, 150, 180]) {
        const canvas = new OffscreenCanvas(800, 800), ctx = canvas.getContext("2d");
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, 800, 800); ctx.translate(400, 400); ctx.rotate(angle * Math.PI / 180);
        ctx.drawImage(photo, -360, -191);
        for (let i = 0; i < 4; i++) {
          const bitmap = await createImageBitmap(canvas); pending = wait();
          worker.postMessage({ type: "frame", bitmap, t: performance.now() }, [bitmap]); const result = await pending;
          const measured = result.hands.map(raw => extractHand(raw, 1)).filter(Boolean);
          const assigned = identity.push({ t: result.t, hands: measured });
          frames.push({ angle, ms: result.inferenceMs, raw: result.hands.map(h => h.side), assigned: assigned.hands.map(h => h.side), points: assigned.hands.map(h => h.landmarks.length) });
          if (i === 3 && (measured.length !== 2 || new Set(assigned.hands.map(h => h.side)).size !== 2))
            throw Error("Two hands missing: " + JSON.stringify(frames.at(-1)));
        }
      }
      worker.terminate();
      const times = frames.slice(1).map(f => f.ms).sort((a, b) => a - b);
      reports.push({ variant, delegate: ready.delegate, coldMs: frames[0].ms, steadyMedianMs: times[Math.floor(times.length / 2)], steadyP95Ms: times[Math.floor(times.length * .95)], frames });
    }
    photo.close(); return { scope: "Real two-hand photograph rotated in image plane; not live signing or out-of-plane ground truth", reports };
  });
  await writeFile("qa/two-hand-tracker-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.reports.map(({ frames, ...summary }) => ({ ...summary, frames: frames.length, twoHands: frames.filter(f => f.assigned.length === 2).length }))));
} finally { await browser.close(); }
