// Real-browser playthrough (desktop + touch). Run: npx vite --port 5173 & node tests/e2e/playthrough.mjs
// Uses real mouse/keyboard events. Exits non-zero on any failed check or console error.
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE ?? 'http://localhost:5173/';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
let failures = 0; const errors = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };
const ev = (page, f, a) => page.evaluate(f, a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(page, f, arg, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(f, arg)) return true; await sleep(120); } return false; }

// software GL runs the sim slower than real time, so wait on *simulated* seconds, not wall-clock sleeps
const simWait = async (page, sec, max = 60000) => { const t0 = await page.evaluate(() => window.__game.time); await until(page, (a) => window.__game.time - a[0] >= a[1], [t0, sec], max); };

async function desktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '?q=low');
  await page.waitForSelector('.logo');
  check('title screen shows, Continue disabled with no save', await ev(page, () => document.querySelector('[data-a=cont]').disabled === true));
  await page.click('[data-a=new]');
  await page.click('.card[data-c=oathbound]');
  await page.click('.screen .btn');   // Descend
  check('game starts in play mode with HUD', await until(page, () => window.__app.mode === 'play' && !document.getElementById('hud').classList.contains('hidden')));
  const P = () => ev(page, () => { const p = window.__game.player; return { x: p.x, z: p.z, hp: p.hp, state: p.state, lvl: p.level }; });
  const screenOf = (x, z, y = 0) => ev(page, ([x, z, y]) => window.__app.view.project(x, y, z), [x, z, y]);

  // click-to-move with the real mouse
  const p0 = await P(); const dest = await screenOf(p0.x + 3, p0.z - 3);
  await page.mouse.click(dest.x, dest.y);
  await simWait(page, 1.6);
  const p1 = await P();
  check('left-click moves the hero toward the cursor', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1.5, `moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)}`);

  // mouse scheme: WASD must NOT interfere
  const pw0 = await P();
  await page.keyboard.down('w'); await simWait(page, 0.7); await page.keyboard.up('w');
  const pw1 = await P();
  check('mouse scheme ignores WASD (no competing controls)', Math.hypot(pw1.x - pw0.x, pw1.z - pw0.z) < 0.05);

  // Shift = hold position, even when clicking elsewhere
  const ph0 = await P(); const far = await screenOf(ph0.x + 4, ph0.z - 4);
  await page.keyboard.down('Shift');
  await page.mouse.click(far.x, far.y); await simWait(page, 1.0);
  const ph1 = await P();
  check('Shift holds position: clicking elsewhere does not move the hero', Math.hypot(ph1.x - ph0.x, ph1.z - ph0.z) < 0.9, `moved ${Math.hypot(ph1.x - ph0.x, ph1.z - ph0.z).toFixed(2)}`);
  await page.keyboard.up('Shift');
  await page.mouse.click(far.x, far.y); await simWait(page, 1.0);
  const ph2 = await P();
  check('releasing Shift restores click-to-move', Math.hypot(ph2.x - ph1.x, ph2.z - ph1.z) > 1.5);

  // fight: walk to the nearest husk and click it
  await ev(page, () => { const g = window.__game; g.chamber.enemies.length = 0; const e = g.chamber.spawnEnemy('husk', 10, 18); e.ai.sleep = true; e.ai.alerted = false; window.__t = e.id; g.player.x = 7.5; g.player.z = 18.5; window.__app.view.cam.snap = true; });
  await sleep(900);
  const tgt = await ev(page, () => { const e = window.__game.chamber.byId(window.__t); return { x: e.x, z: e.z, hp: e.hp }; });
  const ts = await screenOf(tgt.x, tgt.z, 0.9);
  await page.mouse.move(ts.x, ts.y); await sleep(200);
  check('hovering an enemy picks it', await ev(page, () => window.__app.input.hover?.kind === 'enemy'));
  await page.mouse.click(ts.x, ts.y);
  const killed = await until(page, () => { const e = window.__game.chamber.byId(window.__t); return !e || e.dead; }, null, 90000);
  check('attacking locks onto the enemy (lock ring target)', await ev(page, () => window.__app.view.lockTarget?.id === window.__t || window.__app.input.lockId === window.__t));
  check('click-to-attack kills a husk (real combat loop)', killed);
  check('kill awards xp and drops loot', await ev(page, () => window.__game.progress.stats.kills >= 1 && (window.__game.player.xp > 0 || window.__game.player.level > 1)));

  check('lock clears when the target dies', await until(page, () => window.__app.input.lockId === null, null, 3000));

  // WASD scheme is opt-in via settings
  await ev(page, () => { window.__app.settings.controls = 'wasd'; window.__app.input.setScheme('wasd'); });
  const pk0 = await P(); await page.keyboard.down('d'); await simWait(page, 0.7); await page.keyboard.up('d');
  const pk1 = await P();
  check('WASD scheme (opt-in) moves the hero', Math.hypot(pk1.x - pk0.x, pk1.z - pk0.z) > 1);
  await ev(page, () => { window.__app.settings.controls = 'mouse'; window.__app.input.setScheme('mouse'); });

  // inventory + codex
  await page.keyboard.press('i');
  check('I opens inventory', await until(page, () => !document.getElementById('invpanel').classList.contains('hidden'), null, 1500));
  await page.keyboard.press('Escape');
  check('Esc closes panel first', await ev(page, () => document.getElementById('invpanel').classList.contains('hidden') && window.__app.mode === 'play'));
  await page.keyboard.press('c');
  check('C opens codex', await until(page, () => !document.getElementById('codex').classList.contains('hidden'), null, 1500));
  await page.keyboard.press('Escape');

  // potion
  await ev(page, () => { window.__game.player.hp = 40; });
  await page.keyboard.press('f');
  check('F drinks a health potion', await until(page, () => window.__game.player.hp > 100 && window.__game.inv.potions.hp === 2, null, 1500));

  // interact: read a lore tablet
  await ev(page, () => { const g = window.__game; const l = g.chamber.props.get('g_lore1'); g.player.x = l.x - 1; g.player.z = l.z; });
  await sleep(200); await page.keyboard.press('e');
  check('E reads an inscription (lore modal, added to codex)', await until(page, () => window.__app.mode === 'paused' && window.__game.progress.lore.includes('l_gate1'), null, 2000));
  await page.keyboard.press('Escape'); await sleep(200);
  await page.click('.screen .btn').catch(() => {});
  await sleep(200);
  if (await ev(page, () => window.__app.mode) !== 'play') await ev(page, () => { document.querySelector('.screen .xbtn')?.click(); });

  // pause / settings
  await page.keyboard.press('Escape');
  check('Esc opens pause menu', await until(page, () => window.__app.mode === 'paused' && !!document.querySelector('.screen .menu'), null, 1500));
  await page.click('[data-a=v]');
  check('manual save writes localStorage', await ev(page, () => !!localStorage.getItem('emberhollow.save')));
  await page.click('[data-a=r]');
  check('Resume returns to play', await ev(page, () => window.__app.mode === 'play'));

  // chamber transition through a real door + hub
  await ev(page, () => { const g = window.__game; for (const e of g.chamber.enemies) { e.dead = true; e.deadT = 99; } g.chamber.enemies = []; g.player.x = 13.5; g.player.z = 1.5; });
  check('walking through the door transitions to the Nave', await until(page, () => window.__game.chamber.id === 'nave', null, 4000));
  await sleep(1200);
  // reload -> Continue resumes at checkpoint with progression intact
  const lvl = await ev(page, () => window.__game.player.level);
  await ev(page, () => window.__game.save('test'));
  await page.reload(); await page.waitForSelector('.logo');
  check('Continue enabled after reload', await ev(page, () => !document.querySelector('[data-a=cont]').disabled));
  await page.click('[data-a=cont]');
  check('Continue restores class, level and chamber', await until(page, ([l]) => window.__app.mode === 'play' && window.__game.classId === 'oathbound' && window.__game.player.level === l && window.__game.chamber.id.length > 0, [lvl], 4000));
  // death + respawn
  await ev(page, () => { const g = window.__game; g.player.invuln = false; g.player.hp = 1; g.chamber.enemies.length = 0; g.chamber.spawnEnemy('husk', Math.floor(g.player.x) + 1, Math.floor(g.player.z)).ai.alerted = true; });
  check('player can die', await until(page, () => window.__game.player.dead, null, 15000));
  check('death screen offers respawn', await until(page, () => !!document.querySelector('[data-a=r]'), null, 4000));
  await page.click('[data-a=r]');
  check('respawn restores health at the waystone', await until(page, () => !window.__game.player.dead && window.__game.player.hp > 50, null, 3000));
  // block puzzle with Diablo controls: lock on to a coffin, then click toward the direction to push
  await ev(page, () => { const g = window.__game; g.enterChamber('ossuary', 'from_nave'); g.chamber.enemies.length = 0; g.player.invuln = true; g.player.x = 16.5; g.player.z = 10.5; window.__app.view.cam.snap = true; });
  await sleep(1500);
  const bpos = await screenOf(19.5, 8.5, 0.4);
  await page.mouse.move(bpos.x, bpos.y); await sleep(250);
  check('hovering a coffin picks it as a block', await ev(page, () => window.__app.input.hover?.kind === 'block'));
  await page.mouse.click(bpos.x, bpos.y);
  check('clicking a coffin locks onto it', await ev(page, () => window.__app.input.lockedBlock()?.id === 'o_b1'));
  const east = await screenOf(23.5, 8.5);
  await page.mouse.click(east.x, east.y);
  check('clicking toward the east pushes the coffin one cell east (hero walks round to push)', await until(page, () => window.__game.chamber.props.get('o_b1').cx === 20, null, 45000));
  await page.mouse.click(bpos.x + 0, bpos.y).catch(() => {});
  await page.keyboard.press('Escape');
  check('Esc releases the block lock (and does not open the pause menu)', await ev(page, () => window.__app.input.lockedBlock() === null && window.__app.mode === 'play'));
  await ctx.close();
}

async function mobile(browser) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[mobile] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[mobile] ' + e.message));
  await page.goto(BASE + '?q=low&autostart&nosave&class=cinderwitch');
  check('mobile: touch layout active', await until(page, () => document.body.classList.contains('touch') && window.__app.mode === 'play'));
  await sleep(800);
  const vis = await ev(page, () => [...document.querySelectorAll('.tbtn')].map((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.top >= 0; }));
  check('mobile: all touch buttons are on-screen', vis.every(Boolean), JSON.stringify(vis));
  const p0 = await ev(page, () => ({ x: window.__game.player.x, z: window.__game.player.z }));
  // virtual stick: drag with a real touch via CDP
  const cdp = await ctx.newCDPSession(page);
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await tp('touchStart', 80, 300); await tp('touchMove', 130, 300); await simWait(page, 1.0);
  const p1 = await ev(page, () => ({ x: window.__game.player.x, z: window.__game.player.z }));
  await tp('touchEnd', 130, 300);
  check('mobile: virtual stick moves the hero', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1, `moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)}`);
  const b = await ev(page, () => { const r = document.querySelector('.tbtn.big').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await ev(page, () => { const g = window.__game; g.chamber.enemies.length = 0; g.player.x = 10.5; g.player.z = 12.5; g.player.face = Math.PI / 2; const e = g.chamber.spawnEnemy('husk', 13, 12); e.ai.alerted = false; e.ai.sleep = true; window.__t = e.id; });
  await page.touchscreen.tap(b.x, b.y); await simWait(page, 1.2);
  check('mobile: attack button fires a skill at the nearest enemy', await until(page, () => { const e = window.__game.chamber.byId(window.__t); return !e || e.hp < e.maxHp; }, null, 20000));
  const noScroll = await ev(page, () => document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1);
  check('mobile: no page scroll / overflow', noScroll);
  await ctx.close();
}

const browser = await chromium.launch({ args: ARGS });
try { await desktop(browser); await mobile(browser); } catch (e) { console.error('E2E crashed:', e.message); failures++; }
await browser.close();
const fatal = errors.filter((e) => !/favicon|ERR_|WebGL.*deprecated|GPU stall|swiftshader/i.test(e));
check('no console errors during the run', fatal.length === 0, fatal.slice(0, 3).join(' | '));
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll e2e checks passed');
process.exit(failures ? 1 : 0);
