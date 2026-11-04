// Unified input: mouse (Diablo-style click-to-move / click-to-attack), keyboard, and touch (virtual stick + buttons).
// Produces simulation commands; never mutates game state directly.
const SQ = Math.SQRT1_2;
const UP = { x: -SQ, z: -SQ }, RIGHT = { x: SQ, z: -SQ };

export class Input {
  constructor(canvas, view, getGame) {
    this.canvas = canvas; this.view = view; this.getGame = getGame;
    this.cmds = []; this.keys = new Set(); this.enabled = true;
    this.pointer = { x: 0, y: 0, has: false }; this.ground = { x: 0, z: 0 }; this.hover = null;
    this.lmb = false; this.lastAttackId = null; this.touchMode = false;
    this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, mag: 0 };
    this.lastDir = '';
    this.handlers = [];
    this.on(canvas, 'pointerdown', (e) => this.down(e));
    this.on(window, 'pointermove', (e) => this.move(e));
    this.on(window, 'pointerup', (e) => this.up(e));
    this.on(window, 'pointercancel', (e) => this.up(e));
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(canvas, 'wheel', (e) => { e.preventDefault(); this.onZoom?.(e.deltaY < 0 ? 0.08 : -0.08); }, { passive: false });
    this.on(window, 'keydown', (e) => this.keydown(e));
    this.on(window, 'keyup', (e) => this.keyup(e));
    this.on(window, 'blur', () => { this.keys.clear(); this.lmb = false; this.pushDir(); });
  }
  on(t, ev, fn, o) { t.addEventListener(ev, fn, o); this.handlers.push([t, ev, fn, o]); }
  dispose() { for (const [t, ev, fn, o] of this.handlers) t.removeEventListener(ev, fn, o); }
  push(c) { if (this.enabled) this.cmds.push(c); }
  drain() { const c = this.cmds; this.cmds = []; return c; }

  updatePick(clientX, clientY) {
    this.pointer.x = clientX; this.pointer.y = clientY; this.pointer.has = true;
    const r = this.view.pick(clientX, clientY);
    this.ground = r.ground; this.hover = r.hover;
    return r;
  }
  move(e) {
    if (e.pointerType === 'touch') {
      if (this.stick.active && e.pointerId === this.stick.id) this.stickMove(e);
      return;
    }
    if (!this.getGame()) return;
    this.updatePick(e.clientX, e.clientY);
  }
  down(e) {
    const game = this.getGame(); if (!game || !this.enabled) return;
    this.canvas.focus?.();
    if (e.pointerType === 'touch') { this.touchMode = true; this.touchDown(e); return; }
    this.touchMode = false;
    const r = this.updatePick(e.clientX, e.clientY);
    if (e.button === 0) {
      this.lmb = true;
      if (e.shiftKey) { this.push({ t: 'skill', slot: 0, x: this.ground.x, z: this.ground.z }); return; }
      this.leftClick(r.hover);
    } else if (e.button === 2) {
      const t = r.hover && (r.hover.kind === 'enemy') ? r.hover.entity : null;
      this.push({ t: 'skill', slot: 1, x: t ? t.x : this.ground.x, z: t ? t.z : this.ground.z });
    }
  }
  leftClick(h) {
    if (h) {
      if (h.kind === 'enemy' || h.kind === 'prop') { this.push({ t: 'attack', id: h.id, slot: 0 }); this.lastAttackId = h.id; return; }
      if (h.kind === 'loot' || h.kind === 'interact') { this.push({ t: 'interact', id: h.id }); return; }
    }
    this.lastAttackId = null;
    this.push({ t: 'moveTo', x: this.ground.x, z: this.ground.z, hold: true });
  }
  up(e) {
    if (e.pointerType === 'touch') { if (this.stick.active && e.pointerId === this.stick.id) { this.stick.active = false; this.stick.mag = 0; this.pushDir(); } return; }
    if (e.button === 0) this.lmb = false;
  }

  // ---------------------------------------------------------------- touch
  touchDown(e) {
    const w = window.innerWidth;
    if (e.clientX < w * 0.45 && e.clientY > window.innerHeight * 0.3 && !this.stick.active) {
      this.stick = { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0, mag: 0 };
      return;
    }
    // tap: pick target or move
    const r = this.updatePick(e.clientX, e.clientY);
    this.leftClick(r.hover);
  }
  stickMove(e) {
    const s = this.stick; let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
    const R = 56, m = Math.hypot(dx, dy);
    if (m > R) { dx = (dx / m) * R; dy = (dy / m) * R; }
    s.x = dx; s.y = dy; s.mag = Math.min(1, m / R);
    this.pushDir();
  }
  pushDir() {
    let x = 0, z = 0;
    const s = this.stick;
    if (s.active && s.mag > 0.15) {
      const sx = s.x / 56, sy = s.y / 56; // screen right / screen down
      x = RIGHT.x * sx + (-UP.x) * sy; z = RIGHT.z * sx + (-UP.z) * sy;
    } else {
      const k = this.keys;
      const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      const r = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      x = UP.x * f + RIGHT.x * r; z = UP.z * f + RIGHT.z * r;
      const l = Math.hypot(x, z); if (l > 0) { x /= l; z /= l; }
    }
    const key = `${x.toFixed(2)},${z.toFixed(2)}`;
    if (key === this.lastDir) return;
    this.lastDir = key;
    this.push({ t: 'moveDir', x, z });
  }

  // ---------------------------------------------------------------- keyboard
  keydown(e) {
    if (e.repeat) return;
    const game = this.getGame(); if (!game) return;
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { this.keys.add(k); this.pushDir(); e.preventDefault(); return; }
    if (k >= '1' && k <= '4') { this.skillSlot(Number(k) - 1); return; }
    if (k === ' ') { e.preventDefault(); this.dodge(); return; }
    if (k === 'e') { this.interact(); return; }
    if (k === 'f') { this.push({ t: 'potion', kind: 'hp' }); return; }
    if (k === 'g') { this.push({ t: 'potion', kind: 'mana' }); return; }
    if (k === 'q') { this.skillSlot(2); return; }
    if (k === 'r') { this.skillSlot(3); return; }
    this.onKey?.(k, e);
  }
  keyup(e) {
    const k = e.key.toLowerCase();
    if (this.keys.delete(k)) this.pushDir();
  }

  // ---------------------------------------------------------------- actions usable by buttons (touch HUD)
  aimPoint() {
    const g = this.getGame();
    if (this.touchMode || !this.pointer.has) return this.touchAim(g);
    return this.ground;
  }
  touchAim(g) {
    const p = g.player;
    let best = null, bd = 12;
    for (const e of g.chamber.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < bd && g.grid.los(p.x, p.z, e.x, e.z)) { bd = d; best = e; }
    }
    if (best) return { x: best.x, z: best.z };
    return { x: p.x + Math.sin(p.face) * 5, z: p.z + Math.cos(p.face) * 5 };
  }
  skillSlot(slot) { const a = this.aimPoint(); this.push({ t: 'skill', slot, x: a.x, z: a.z }); }
  dodge() {
    const g = this.getGame();
    if (this.touchMode || !this.pointer.has) { const m = g.player.intent?.dir; if (m && (m.x || m.z)) this.push({ t: 'dodge', x: g.player.x + m.x, z: g.player.z + m.z }); else this.push({ t: 'dodge' }); return; }
    this.push({ t: 'dodge', x: this.ground.x, z: this.ground.z });
  }
  interact() { this.push({ t: 'interact' }); }
  potion(kind) { this.push({ t: 'potion', kind }); }

  /** Called once per frame before stepping the sim: refresh hover and held-button behaviour. */
  frame() {
    const g = this.getGame(); if (!g) return;
    if (!this.touchMode && this.pointer.has) {
      const r = this.view.pick(this.pointer.x, this.pointer.y);
      this.ground = r.ground; this.hover = r.hover;
    }
    if (this.lmb && !this.touchMode && this.enabled) {
      const h = this.hover;
      if (!(h && (h.kind === 'enemy' || h.kind === 'prop' || h.kind === 'loot' || h.kind === 'interact'))) {
        if (!this.keys.size) this.push({ t: 'moveTo', x: this.ground.x, z: this.ground.z, hold: true });
      }
    }
    // keep attacking the clicked target while the button stays down
    if (this.lmb && this.hover?.kind === 'enemy' && this.lastAttackId !== this.hover.id) { this.push({ t: 'attack', id: this.hover.id, slot: 0 }); this.lastAttackId = this.hover.id; }
  }
  clear() { this.cmds = []; this.keys.clear(); this.lmb = false; this.stick.active = false; this.lastDir = ''; }
}
