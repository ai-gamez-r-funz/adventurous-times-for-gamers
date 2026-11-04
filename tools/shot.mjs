// Dev tool: headless Chromium screenshots. node tools/shot.mjs <url-query> <out.png> [js-to-eval-before] [wait-ms] [w] [h]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [, , query = '', out = 'shot.png', js = '', waitMs = '1500', w = '1280', h = '720'] = process.argv;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:5173/${query}`);
await page.waitForTimeout(800);
if (js) { try { await page.evaluate(js); } catch (e) { logs.push('[eval] ' + e.message); } }
await page.waitForTimeout(+waitMs);
await page.screenshot({ path: out });
console.log(logs.slice(0, 15).join('\n') || 'no console errors');
await browser.close();
