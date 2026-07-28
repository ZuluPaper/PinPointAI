// Multi-pose screenshot harness: boots the game, then drives the exposed
// window.__KWANZA__ handle into several poses and captures a labeled shot of each.
// Usage: node tools/shots.mjs <outPrefix> [warmupMs]
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PREFIX = process.argv[2] || path.join(ROOT, 'tools', 'pose');
const WARMUP = parseInt(process.argv[3] || '6000', 10);
const PORT = 8211;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-certificate-errors', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(WARMUP);
await page.evaluate(() => { const b = document.getElementById('start-btn'); if (b) b.click(); });
await page.waitForTimeout(1200);

// Pose helpers run inside the page against window.__KWANZA__.ctx
async function pose(name, fn, settleMs = 900) {
  await page.evaluate(fn);
  await page.waitForTimeout(settleMs);
  const out = `${PREFIX}-${name}.png`;
  try { await page.screenshot({ path: out, timeout: 90000, animations: 'disabled' }); console.log('SHOT:', out); }
  catch (e) { console.log('SHOT_FAIL', name, String(e.message).split('\n')[0]); }
}

// A: survey spawn, look slightly left across the plantation
await pose('survey', () => {
  const c = window.__KWANZA__.ctx; c.player.position.set(2, c.environment.getHeight(2,4)+1.7, 4);
  c.player.yaw = 0.25; c.player.pitch = -0.02;
});

// B: mid-corridor advance toward enemies
await pose('advance', () => {
  const c = window.__KWANZA__.ctx; const x=-6, z=-28;
  c.player.position.set(x, c.environment.getHeight(x,z)+1.7, z);
  c.player.yaw = -0.15; c.player.pitch = -0.03;
});

// C: aim down sights (hold right mouse a moment so ADS blends in)
await pose('ads', () => {
  const c = window.__KWANZA__.ctx; c.input.mouse.right = true;
  c.player.yaw = -0.1; c.player.pitch = 0.0;
}, 1400);

// D: firing — muzzle flash + particles (pulse left mouse)
await pose('fire', () => {
  const c = window.__KWANZA__.ctx; c.input.mouse.right = false;
  c.weapons.cooldown = 0; c.weapons._fire && c.weapons._fire();
}, 260);

// E: close look at an enemy soldier
await pose('enemy', () => {
  const c = window.__KWANZA__.ctx; const e = c.enemies.enemies && c.enemies.enemies[0];
  if (e) { const p=e.position; c.player.position.set(p.x+3, c.environment.getHeight(p.x+3,p.z+6)+1.7, p.z+7);
    c.player.yaw = Math.atan2(-(p.x-(p.x+3)), -(p.z-(p.z+7))); c.player.pitch = -0.05; }
}, 700);

await browser.close();
await new Promise((r) => server.close(r));
console.log('ERRORS:', errors.length);
errors.slice(0, 15).forEach((e) => console.log('  -', e.slice(0, 300)));
