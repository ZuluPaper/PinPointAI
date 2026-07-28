// Headless screenshot + console-error harness for the game.
// Usage: node tools/shoot.mjs [outfile] [waitMs]
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'tools', 'shot.png');
const WAIT = parseInt(process.argv[3] || '3500', 10);
const PORT = 8199;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

await new Promise((r) => server.listen(PORT, r));

// Game is fully self-contained (vendored three) — no external network needed.
const launchOpts = { args: ['--use-gl=swiftshader', '--ignore-certificate-errors', '--enable-webgl', '--ignore-gpu-blocklist'] };

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(WAIT);

// try to start the game
try {
  await page.evaluate(() => {
    const b = document.getElementById('start-btn');
    if (b && b.style.display !== 'none') b.click();
  });
  await page.waitForTimeout(1500);
} catch {}

await page.screenshot({ path: OUT });
await browser.close();
await new Promise((r) => server.close(r));

console.log('SCREENSHOT:', OUT);
console.log('ERRORS:', errors.length);
errors.slice(0, 20).forEach((e) => console.log('  -', e.slice(0, 300)));
process.exit(errors.length ? 1 : 0);
