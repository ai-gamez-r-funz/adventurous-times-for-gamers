import './styles.css';
import { Game } from './sim/game.js';
import { GameView } from './render/view.js';
import { Input } from './core/input.js';
import { AudioSys } from './core/audio.js';
import { browserStorage, memoryStorage, SETTINGS_KEY } from './sim/save.js';
import { startGallery } from './render/gallery.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { SKILLS } from './data/classes.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
if (params.get('view') === 'gallery') startGallery(canvas);
else boot();

function loadSettings() {
  const d = { volume: 0.7, muted: false, quality: 'auto', reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, labels: true };
  let o = d; try { o = { ...d, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; } catch { /* ignore */ }
  if (params.get('q')) o.quality = params.get('q');
  return o;
}

function boot() {
  const coarse = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (coarse) document.body.classList.add('touch');
  const settings = loadSettings();
  const storage = params.has('nosave') ? memoryStorage() : browserStorage();
  const screens = new Screens(uiRoot);
  let view;
  try { view = new GameView(canvas, { quality: settings.quality === 'low' || (settings.quality === 'auto' && coarse) ? 'low' : 'high', mobile: coarse }); }
  catch (e) { screens.error('Emberhollow needs WebGL. Please enable hardware acceleration or try another browser.'); console.error(e); return; }
  const audio = new AudioSys(); audio.vol = settings.volume; audio.muted = settings.muted;
  let game = null, mode = 'title', stage = null, input = null, hud = null, saveHandle = null;
  const app = { get game() { return game; }, get mode() { return mode; }, view, audio, settings, hud: null, input: null };
  window.__app = app;

  const applySettings = () => {
    audio.setVolume(settings.volume); audio.setMuted(settings.muted);
    view.reducedMotion = settings.reducedMotion; document.body.classList.toggle('reduced', settings.reducedMotion);
    const q = settings.quality === 'auto' ? (coarse ? 'low' : (view.autoQ ?? 'high')) : settings.quality;
    if (q !== view.quality) view.setQuality(q);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  };
  applySettings();

  const getGame = () => (mode === 'title' ? null : game);
  input = new Input(canvas, view, getGame); app.input = input;
  input.onZoom = (d) => view.setZoom(view.cam.zoom + d);
  hud = new Hud(uiRoot, { view, input, audio, settings, onMenu: () => openPause(), onLore: (e) => openLore(e.id), onPanel: () => { input.clear(); } }); app.hud = hud;
  window.addEventListener('pointerdown', () => audio.unlock(), { once: false });
  window.addEventListener('keydown', () => audio.unlock());

  // ------------------------------------------------------------ audio bindings
  const wireAudio = (g) => {
    const A = audio, pan = (x) => Math.max(-0.8, Math.min(0.8, (x - g.player.x) * 0.08));
    g.on('swing', (e) => { const m = e.move, a = e.actor; A.play(m.sfx ? (m.sfx === 'swing' && a.def?.tags?.includes('heavy') ? 'swing_heavy' : m.sfx) : 'swing', { pan: pan(a.x), vol: a.kind === 'player' ? 1 : 0.8 }); });
    g.on('windup', (e) => { if (e.actor.kind === 'enemy' && ['rite', 'summon', 'toll'].includes(e.move.sfx)) A.play(e.move.sfx, { pan: pan(e.actor.x) }); });
    g.on('roll', () => A.play('roll')); g.on('levelup', () => A.play('levelup')); g.on('chestOpen', () => A.play('chest')); g.on('break', (e) => A.play('break', { pan: pan(e.prop.x), vol: e.hit ? 0.5 : 1 }));
    g.on('gate', () => A.play('gate')); g.on('rest', () => A.play('rest')); g.on('denied', () => A.play('denied')); g.on('aggro', (e) => A.play('aggro', { pan: pan(e.actor.x), vol: 0.6 }));
    g.on('death', (e) => A.play('death', { pan: pan(e.actor.x) })); g.on('unseal', () => A.play('unseal')); g.on('victory', () => A.play('victory'));
    g.on('boss', (e) => { if (e.kind === 'shift') A.play('toll'); });
    g.on('projectileEnd', (e) => { if (e.wall) A.play('break', { vol: 0.25 }); });
    g.on('puzzle', (e) => { if (e.event === 'step') A.play('puzzle_step', { note: e.index ?? e.step ?? 0 }); else if (e.event === 'show') A.play('puzzle_step', { note: e.index }); else if (e.event === 'fail') A.play('puzzle_fail'); else if (e.event === 'solved') A.play('puzzle_solved'); else if (e.event === 'push') A.play('push'); });
  };

  // ------------------------------------------------------------ title stage (live 3D backdrop)
  function startStage(classId = 'oathbound') {
    stopGame();
    stage = new Game({ classId, seed: 9, storage: null, fade: false });
    stage.chamber.enemies.length = 0;
    stage.player.x = 13.5; stage.player.z = 14.5; stage.player.face = Math.PI * 0.8;
    view.bind(stage); view.cam.snap = true;
    mode = 'title';
  }
  function stopGame() { if (game && mode === 'play') game.save('exit'); game = null; clearInterval(saveHandle); }

  function openTitle() {
    hud.show(false); screens.hide();
    startStage(); audio.setMusicState('title');
    const has = !!storage.load();
    screens.title({
      hasSave: has,
      onContinue: () => { const s = storage.load(); if (s) startGame(null, s); },
      onNew: () => openClassSelect(), onSettings: () => openSettings(openTitle), onHelp: () => openHelp(openTitle),
    });
  }
  function openClassSelect() {
    screens.classSelect({ onPick: (id) => { storage.clear(); screens.intro({ onBegin: () => startGame(id, null) }); }, onBack: openTitle, hover: (id) => { startStage(id); } });
  }

  // ------------------------------------------------------------ gameplay
  function startGame(classId, save) {
    screens.hide();
    game = new Game({ classId: classId ?? 'oathbound', seed: (Math.random() * 1e9) | 0, save, storage });
    stage = null; mode = 'play';
    view.bind(game); view.cam.snap = true; hud.bind(game); hud.show(true); input.clear();
    wireAudio(game);
    game.on('playerDeath', () => setTimeout(() => { if (mode === 'play' && game.player.dead) screens.death({ onRespawn: () => { screens.hide(); game.respawn(); input.clear(); }, onTitle: () => { screens.hide(); openTitle(); } }); }, 1600));
    game.on('victory', () => { screens.victory({ game, onContinue: () => screens.hide(), onTitle: () => { screens.hide(); openTitle(); } }); });
    game.on('toast', () => {});
    clearInterval(saveHandle); saveHandle = setInterval(() => { if (mode === 'play' && game.dirty) game.save('auto'); }, 15000);
    if (settings.quality === 'auto') view.autoQ = view.autoQ ?? view.quality;
    window.__game = game;
    if (params.has('fx')) { /* deterministic review fixtures */ import('./fixtures.js').then((m) => m.apply(game, view, params.get('fx'))); }
  }
  function openPause() {
    if (mode !== 'play' || screens.open) return;
    mode = 'paused'; input.clear();
    const back = () => { screens.hide(); mode = 'play'; };
    const menu = () => screens.pause({ onResume: back, onSettings: () => openSettings(menu), onHelp: () => openHelp(menu), onSave: () => game.save('manual'), onQuit: () => { game.save('quit'); screens.hide(); mode = 'title'; openTitle(); } });
    menu(); audio.play('ui_open');
  }
  function openSettings(back) { screens.settings({ s: settings, onChange: (v) => { Object.assign(settings, v); applySettings(); }, onBack: back }); }
  function openHelp(back) { screens.help({ onBack: back }); }
  function openLore(id) { if (mode !== 'play') return; mode = 'paused'; input.clear(); screens.lore({ id, onClose: () => { screens.hide(); mode = 'play'; } }); audio.play('ui_open'); }

  input.onKey = (k) => {
    if (mode !== 'play' && mode !== 'paused') return;
    if (k === 'escape') { if (screens.open && mode === 'paused') { /* handled by buttons */ } }
  };
  window.addEventListener('keydown', (e) => {
    if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (hud.panelOpen) { hud.closePanels(); return; }
      if (mode === 'play') openPause(); else if (mode === 'paused' && screens.open) { screens.hide(); mode = 'play'; }
      return;
    }
    if (mode !== 'play') return;
    if (k === 'i') hud.toggleInv(); else if (k === 'c') hud.toggleCodex(); else if (k === 'm') { settings.muted = !settings.muted; applySettings(); hud.toast(settings.muted ? 'Sound off' : 'Sound on'); } else if (k === 'tab') { e.preventDefault(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (mode === 'play') { game.save('hidden'); openPause(); } } });
  addEventListener('pagehide', () => { if (game && mode !== 'title') game.save('pagehide'); });

  // ------------------------------------------------------------ main loop
  const resize = () => view.resize(window.innerWidth, window.innerHeight);
  addEventListener('resize', resize); addEventListener('orientationchange', () => setTimeout(resize, 200)); resize();
  let last = performance.now(), acc = 0, slow = 0, fast = 0, frames = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const g = mode === 'title' ? stage : game;
    if (g) {
      if (mode === 'play') {
        input.frame(); acc += dt;
        let n = 0; while (acc >= 1 / 60 && n++ < 5) { g.step(1 / 60, input.drain()); acc -= 1 / 60; }
        if (n >= 5) acc = 0;
        hud.update(dt);
        // music state
        const boss = g.chamber.enemies.some((e) => e.def.boss && !e.dead && e.spawnT <= 0);
        const fight = g.chamber.enemies.some((e) => !e.dead && e.ai.alerted && e.spawnT <= 0 && Math.hypot(e.x - g.player.x, e.z - g.player.z) < 14);
        audio.setMusicState(boss ? 'boss' : fight ? 'combat' : 'explore');
        // adaptive quality: sustained slow frames drop to the low tier (Auto only)
        if (settings.quality === 'auto' && view.quality === 'high') { if (dt > 0.034) slow += dt; else slow = Math.max(0, slow - dt * 0.5); if (slow > 3) { view.autoQ = 'low'; applySettings(); hud.toast('Graphics lowered for performance'); slow = 0; } }
        void fast; void frames;
      } else if (mode === 'title') {
        const t = now / 1000;
        view.cam.target.x += 0; g.player.face = Math.PI * 0.8 + Math.sin(t * 0.3) * 0.15;
      }
      view.update(dt, mode === 'play' && input.pointer.has && !coarse ? input.ground : null);
      if (mode === 'title') { view.camera.position.x += Math.sin(now / 4000) * 1.2; view.camera.lookAt(view.cam.target.x, 0, view.cam.target.z); }
      view.render();
    }
    requestAnimationFrame(frame);
  }
  openTitle();
  if (params.has('autostart')) { storage.clear?.(); startGame(params.get('class') ?? 'oathbound', null); }
  requestAnimationFrame(frame);
}
