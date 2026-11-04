// Unified input. Two schemes (setting `controls`):
//   'mouse' (default, Diablo-style): LMB moves / attacks / interacts, RMB + 1-4 cast, WASD is ignored.
//   'wasd'  (twin-stick style): WASD moves, LMB casts the primary skill at the cursor, RMB the second.
// Shift = HOLD POSITION in both: no movement at all, clicks only attack/cast toward the cursor.
// Attacking locks onto an enemy: the lock is sticky (survives the cursor drifting off), follows it, and skills aim at it.
// Produces simulation commands; never mutates game state directly.
const SQ = Math.SQRT1_2;
const UP = { x: -SQ, z: -SQ }, RIGHT = { x: SQ, z: -SQ };
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

export class Input {
  constructor(canvas, view, getGame) {
    this.canvas = canvas; this.view = view; this.getGame = getGame;
    this.cmds = []; this.keys = new Set(); this.enabled = true; this.scheme = 'mouse';
    this.pointer = { x: 0, y: 0, has: false }; this.ground = { x: 0, z: 0 }; this.hover = null;
    this.lmb = false; this.rmb = false; this.lockId = null; this.touchMode = false; this.standKey = false; this.standTouch = false; this.standSent = false;
    this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, mag: 0 };
    this.lastDir = ''; this.handlers = [];
    this.on(canvas, 'pointerdown', (e) => this.down(e));
    this.on(window, 'pointermove', (e) => this.move(e));
    this.on(window, 'pointerup', (e) => this.up(e));
    this.on(window, 'pointercancel', (e) => this.up(e));
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(canvas, 'wheel', (e) => { e.preventDefault(); this.onZoom?.(e.deltaY < 0 ? 0.08 : -0.08); }, { passive: false });
    this.on(window, 'keydown', (e) => this.keydown(e));
    this.on(window, 'keyup', (e) => this.keyup(e));
    this.on(window, 'blur', () => { this.keys.clear(); this.lmb = this.rmb = false; this.standKey = false; this.pushDir(); });
  }
  on(t, ev, fn, o) { t.addEventListener(ev, fn, o); this.handlers.push([t, ev, fn, o]); }
  dispose() { for (const [t, ev, fn, o] of this.handlers) t.removeEventListener(ev, fn, o); }
  push(c) { if (this.enabled) this.cmds.push(c); }
  drain() { const c = this.cmds; this.cmds = []; return c; }
  get standing() { return this.standKey || this.standTouch; }
  syncStand() { if (this.standing !== this.standSent) { this.standSent = this.standing; this.push({ t: 'stand', on: this.standing }); } }
  setScheme(s) { this.scheme = s; this.keys.clear(); this.lastDir = ''; this.pushDir(); }

  updatePick(clientX, clientY) {
    this.pointer.x = clientX; this.pointer.y = clientY; this.pointer.has = true;
    const r = this.view.pick(clientX, clientY);
    this.ground = r.ground; this.hover = r.hover;
    return r;
  }
  move(e) {
    if (e.pointerType === 'touch') { if (this.stick.active && e.pointerId === this.stick.id) this.stickMove(e); return; }
    if (this.getGame()) this.updatePick(e.clientX, e.clientY);
  }

  // ---------------------------------------------------------------- targeting helpers
  lockedEntity() {
    const g = this.getGame(); if (!g || !this.lockId) return null;
    const t = g.chamber.byId(this.lockId) ?? g.chamber.props.get(this.lockId);
    if (t?.t === 'block' && g.chamber.puzzleOfBlock(t.id)?.solved) return null; // solved: nothing left to push, release automatically
    return t && !t.dead && !(t.prop && t.broken) ? t : null;
  }
  /** The block currently grabbed for pushing (lock-on + click to push), if any. */
  lockedBlock() { const t = this.lockedEntity(); return t?.t === 'block' ? t : null; }
  /** Axis-aligned push direction from the block toward the cursor. */
  pushDirection(b) { const dx = this.ground.x - b.x, dz = this.ground.z - b.z; return Math.abs(dx) >= Math.abs(dz) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dz) || 1]; }
  pushLocked() { const b = this.lockedBlock(); if (!b) return false; const d = this.pushDirection(b); this.push({ t: 'push', id: b.id, dx: d[0], dz: d[1] }); return true;
  }
  /** Where a skill aims: the locked target if any, else a hovered enemy while holding position, else the cursor. */
  aimPoint() {
    const g = this.getGame();
    if (this.touchMode || !this.pointer.has) return this.touchAim(g);
    const lk = this.lockedEntity();
    if (lk && lk.t !== 'block' && !this.standing) return { x: lk.x, z: lk.z };
    if (this.hover?.kind === 'enemy') return { x: this.hover.entity.x, z: this.hover.entity.z };
    return this.ground;
  }
  lock(id) { this.lockId = id; }
  unlock() { this.lockId = null; }

  // ---------------------------------------------------------------- mouse
  down(e) {
    const game = this.getGame(); if (!game || !this.enabled) return;
    this.canvas.focus?.();
    if (e.pointerType === 'touch') { this.touchMode = true; this.touchDown(e); return; }
    this.touchMode = false;
    this.standKey = e.shiftKey; this.syncStand(); // the hold state must be current before this click's command
    const r = this.updatePick(e.clientX, e.clientY);
    if (e.button === 0) { this.lmb = true; this.leftClick(r.hover, e.shiftKey); }
    else if (e.button === 2) { this.rmb = true; if (this.lockedBlock()) { this.unlock(); this.push({ t: 'stop' }); } else this.skillSlot(1); }
  }
  leftClick(h, shift = this.standing) {
    const use = h && (h.kind === 'loot' || h.kind === 'interact');
    if (h?.kind === 'block') { // click a block to grab it; click it again to let go
      if (this.lockId === h.id) { this.unlock(); this.push({ t: 'stop' }); } else this.lock(h.id);
      return;
    }
    if (this.lockedBlock() && !shift) { this.pushLocked(); return; } // grabbed block: any click pushes toward the cursor
    if (shift) { // hold position: only attack/cast toward the cursor, never walk
      if (use) { this.push({ t: 'interact', id: h.id }); return; }
      if (h && (h.kind === 'enemy' || h.kind === 'prop')) this.lock(h.id);
      this.skillSlot(0); return;
    }
    if (this.scheme === 'wasd') { // twin-stick: LMB is always the primary skill
      if (use) { this.push({ t: 'interact', id: h.id }); return; }
      this.skillSlot(0); return;
    }
    if (h && (h.kind === 'enemy' || h.kind === 'prop')) { this.lock(h.id); this.push({ t: 'attack', id: h.id, slot: 0 }); return; }
    if (use) { this.unlock(); this.push({ t: 'interact', id: h.id }); return; }
    this.unlock();
    this.push({ t: 'moveTo', x: this.ground.x, z: this.ground.z, hold: true });
  }
  up(e) {
    if (e.pointerType === 'touch') { if (this.stick.active && e.pointerId === this.stick.id) { this.stick.active = false; this.stick.mag = 0; this.pushDir(); } return; }
    if (e.button === 0) this.lmb = false; else if (e.button === 2) this.rmb = false;
  }

  // ---------------------------------------------------------------- touch
  touchDown(e) {
    const w = window.innerWidth;
    if (e.clientX < w * 0.45 && e.clientY > window.innerHeight * 0.3 && !this.stick.active) { this.stick = { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0, mag: 0 }; this.unlock(); return; }
    const r = this.updatePick(e.clientX, e.clientY);
    this.scheme === 'wasd' ? this.leftClick(r.hover) : this.leftClick(r.hover);
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
    if (s.active && s.mag > 0.15) { const sx = s.x / 56, sy = s.y / 56; x = RIGHT.x * sx + (-UP.x) * sy; z = RIGHT.z * sx + (-UP.z) * sy; }
    else if (this.scheme === 'wasd') {
      const k = this.keys;
      const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      const r = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      x = UP.x * f + RIGHT.x * r; z = UP.z * f + RIGHT.z * r;
      const l = Math.hypot(x, z); if (l > 0) { x /= l; z /= l; }
    }
    const key = `${x.toFixed(2)},${z.toFixed(2)}`;
    if (key === this.lastDir) return;
    this.lastDir = key;
    if ((x || z) && !this.lockedBlock()) this.unlock(); else if (x || z) { this.unlock(); }
    this.push({ t: 'moveDir', x, z });
  }

  // ---------------------------------------------------------------- keyboard
  keydown(e) {
    const game = this.getGame(); if (!game) return;
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'shift') { this.standKey = true; this.syncStand(); return; }
    if (e.repeat) return;
    if (MOVE_KEYS.includes(k)) { if (this.scheme === 'wasd') { this.keys.add(k); this.pushDir(); e.preventDefault(); } return; }
    if (k >= '1' && k <= '4') { this.skillSlot(Number(k) - 1); return; }
    if (k === 'e') { this.interact(); return; }
    if (k === 'f') { this.push({ t: 'potion', kind: 'hp' }); return; }
    if (k === 'g') { this.push({ t: 'potion', kind: 'mana' }); return; }
    if (k === 'q') { this.skillSlot(2); return; }
    if (k === 'r') { this.skillSlot(3); return; }
    this.onKey?.(k, e);
  }
  keyup(e) {
    const k = e.key.toLowerCase();
    if (k === 'shift') { this.standKey = false; this.syncStand(); return; }
    if (this.keys.delete(k)) this.pushDir();
  }

  // ---------------------------------------------------------------- actions usable by buttons (touch HUD)
  touchAim(g) {
    const p = g.player, lk = this.lockedEntity();
    if (lk) return { x: lk.x, z: lk.z };
    let best = null, bd = 12;
    for (const e of g.chamber.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < bd && g.grid.los(p.x, p.z, e.x, e.z)) { bd = d; best = e; }
    }
    if (best) { this.lock(best.id); return { x: best.x, z: best.z }; }
    return { x: p.x + Math.sin(p.face) * 5, z: p.z + Math.cos(p.face) * 5 };
  }
  skillSlot(slot) { const a = this.aimPoint(); this.push({ t: 'skill', slot, x: a.x, z: a.z }); }
  interact() { this.push({ t: 'interact' }); }
  potion(kind) { this.push({ t: 'potion', kind }); }
  toggleStandTouch() { this.standTouch = !this.standTouch; return this.standTouch; }

  /** Called once per frame before stepping the sim: refresh hover, hold-position state, held-button behaviour, sticky lock. */
  frame() {
    const g = this.getGame(); if (!g) return;
    if (!this.touchMode && this.pointer.has) { const r = this.view.pick(this.pointer.x, this.pointer.y); this.ground = r.ground; this.hover = r.hover; }
    this.syncStand();
    if (this.lockId && !this.lockedEntity()) this.lockId = null;
    const h = this.hover;
    if (this.lmb && !this.touchMode && this.enabled && this.lockedBlock() && !(h && h.kind === 'block')) this.pushLocked(); // hold to keep pushing
    else if (this.lmb && !this.touchMode && this.enabled) {
      if (this.standing || this.scheme === 'wasd') {
        if (!(h && (h.kind === 'loot' || h.kind === 'interact'))) this.skillSlot(0); // hold to keep attacking in place
      } else if (h && (h.kind === 'enemy' || h.kind === 'prop')) {
        if (this.lockId !== h.id) { this.lock(h.id); this.push({ t: 'attack', id: h.id, slot: 0 }); }
      } else if (this.lockId) {
        // sticky lock: the cursor drifted off the enemy but the button is still down, so keep following/attacking it
        const lk = this.lockedEntity(); if (lk && lk.t !== 'block' && g.player.intent.kind !== 'attack') this.push({ t: 'attack', id: lk.id, slot: 0 });
      } else this.push({ t: 'moveTo', x: this.ground.x, z: this.ground.z, hold: true });
    }
    const lb = this.lockedBlock();
    this.view.lockTarget = this.lockedEntity();
    this.view.pushDir = lb ? this.pushDirection(lb) : null;
    this.canvas.style.cursor = h?.kind === 'enemy' || h?.kind === 'prop' ? 'crosshair' : this.lockedBlock() ? 'move' : h ? 'pointer' : this.standing ? 'not-allowed' : 'default';
  }
  clear() { this.cmds = []; this.keys.clear(); this.lmb = this.rmb = false; this.stick.active = false; this.lastDir = ''; this.lockId = null; this.standSent = false; this.standKey = false; }
}
