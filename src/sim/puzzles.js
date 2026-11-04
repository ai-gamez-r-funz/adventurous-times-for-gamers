// Chamber puzzles. Each puzzle is a small state machine owned by the chamber runtime; solved state persists via flags.
// All puzzle geometry is on the single gameplay plane (blocks slide on cells; nothing is lifted).

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------------------------------------------------------------- brazier sequence
export class BrazierSeq {
  constructor(ch, def) {
    this.ch = ch; this.def = def; this.id = def.id; this.order = def.order; this.progress = 0; this.solved = false;
  }
  get braziers() { return this.order.map((id) => this.ch.props.get(id)); }
  restoreSolved() { this.solved = true; this.progress = this.order.length; for (const b of this.braziers) b.lit = true; }
  light(id) {
    if (this.solved) return false;
    const b = this.ch.props.get(id);
    if (!b || b.lit) return false;
    if (id === this.order[this.progress]) {
      b.lit = true; this.progress++;
      this.ch.game.emit('puzzle', { id: this.id, kind: 'brazier_seq', event: 'step', index: this.progress - 1, prop: b });
      if (this.progress >= this.order.length) this.ch.solvePuzzle(this);
      return true;
    }
    this.fail(b);
    return false;
  }
  fail(b) {
    for (const x of this.braziers) x.lit = false;
    this.progress = 0;
    this.ch.game.emit('puzzle', { id: this.id, kind: 'brazier_seq', event: 'fail', prop: b });
    const burst = this.def.burst;
    if (burst) this.ch.spawnHazard({ ownerId: 'trap', pattern: 'circle', x: b.x, z: b.z, r: burst.radius, telegraph: 0.7, damage: burst.damage, poise: 20, knockback: 2.4, moveId: 'brazier_backlash', trap: true });
    this.ch.game.emit('toast', { text: 'The braziers gutter. The flames are jealous of disorder.', kind: 'warn' });
  }
  update() {}
  reset() {}
}

// ---------------------------------------------------------------- push blocks onto plates
export class PushPlates {
  constructor(ch, def) {
    this.ch = ch; this.def = def; this.id = def.id; this.solved = false; this.pushT = new Map();
    this.bounds = def.bounds ?? null;
  }
  get blocks() { return this.def.blocks.map((id) => this.ch.props.get(id)); }
  get plates() { return this.def.plates.map((id) => this.ch.props.get(id)); }
  restoreSolved() {
    this.solved = true;
    // place blocks on plates in definition order
    const bs = this.blocks, ps = this.plates;
    bs.forEach((b, i) => this.place(b, ps[i].cx, ps[i].cz));
  }
  place(b, cx, cz) {
    this.ch.grid.removeDyn(b.cx, b.cz);
    b.cx = cx; b.cz = cz; b.x = cx + 0.5; b.z = cz + 0.5; b.slideT = 0;
    this.ch.grid.addDyn(cx, cz);
  }
  reset() {
    if (this.solved) return;
    for (const b of this.blocks) { this.place(b, b.homeCx, b.homeCz); b.slideT = 0; }
    this.ch.game.emit('puzzle', { id: this.id, kind: 'push_plates', event: 'reset' });
    this.ch.game.emit('toast', { text: 'The coffins slide back to where they began.', kind: 'info' });
  }
  cellFree(cx, cz, self) {
    const g = this.ch.grid;
    if (!g.isFloor(cx, cz) || g.solid[g.idx(cx, cz)] || g.dyn[g.idx(cx, cz)] > 0) return false;
    if (this.bounds && (cx < this.bounds.x || cz < this.bounds.z || cx >= this.bounds.x + this.bounds.w || cz >= this.bounds.z + this.bounds.h)) return false;
    for (const e of this.ch.enemies) if (!e.dead && Math.floor(e.x) === cx && Math.floor(e.z) === cz) return false;
    void self;
    return true;
  }
  update(dt) {
    const p = this.ch.game.player;
    for (const b of this.blocks) {
      if (b.slideT > 0) b.slideT = Math.max(0, b.slideT - dt);
      if (this.solved || p.dead) continue;
      // player must be pressing against one face of the block while moving into it
      const dx = b.x - p.x, dz = b.z - p.z;
      const touching = Math.abs(dx) < 0.5 + p.radius + 0.14 && Math.abs(dz) < 0.5 + p.radius + 0.14;
      let dir = null;
      if (touching) {
        if (Math.abs(dx) > Math.abs(dz)) dir = [Math.sign(dx), 0]; else dir = [0, Math.sign(dz)];
        const mv = p.moveVec;
        if (!(mv.x * dir[0] + mv.z * dir[1] > 0.5) || b.slideT > 0 || p.state === 'roll') dir = null;
        // must be roughly lined up with the block centre on the other axis
        else if ((dir[0] ? Math.abs(dz) : Math.abs(dx)) > 0.62) dir = null;
      }
      if (!dir) { this.pushT.set(b.id, 0); continue; }
      const t = (this.pushT.get(b.id) ?? 0) + dt;
      this.pushT.set(b.id, t);
      if (t >= 0.28) {
        this.pushT.set(b.id, 0);
        const nx = b.cx + dir[0], nz = b.cz + dir[1];
        if (this.cellFree(nx, nz, b)) {
          b.fromX = b.x; b.fromZ = b.z;
          this.place(b, nx, nz); b.slideT = 0.24; b.slideDur = 0.24;
          this.ch.game.emit('puzzle', { id: this.id, kind: 'push_plates', event: 'push', prop: b });
          this.check();
        } else this.ch.game.emit('puzzle', { id: this.id, kind: 'push_plates', event: 'blocked', prop: b });
      }
    }
  }
  check() {
    const bs = this.blocks, ps = this.plates;
    for (const pl of ps) pl.pressed = bs.some((b) => b.cx === pl.cx && b.cz === pl.cz);
    if (ps.every((pl) => pl.pressed)) this.ch.solvePuzzle(this);
  }
}

/** BFS Sokoban-style solver used by tests to prove a block puzzle is solvable. Returns { solved, pushes }. */
export function solvePush({ free, blocks, plates, player, maxStates = 400000 }) {
  const key = (bl) => bl.map((b) => b[0] + ',' + b[1]).sort().join('|');
  const plateSet = new Set(plates.map((p) => p[0] + ',' + p[1]));
  const isSolved = (bl) => bl.every((b) => plateSet.has(b[0] + ',' + b[1]));
  const region = (bl, start) => {
    const occ = new Set(bl.map((b) => b[0] + ',' + b[1]));
    const seen = new Set([start[0] + ',' + start[1]]); const q = [start]; let min = start;
    while (q.length) {
      const [x, z] = q.pop();
      if (x < min[0] || (x === min[0] && z < min[1])) min = [x, z];
      for (const [dx, dz] of DIRS) { const nx = x + dx, nz = z + dz, k = nx + ',' + nz; if (seen.has(k) || occ.has(k) || !free(nx, nz)) continue; seen.add(k); q.push([nx, nz]); }
    }
    return { seen, min };
  };
  const start = { bl: blocks.map((b) => [...b]), pl: player, d: 0 };
  const r0 = region(start.bl, start.pl);
  const visited = new Set([key(start.bl) + '#' + r0.min.join(',')]);
  let frontier = [{ ...start, reach: r0.seen }];
  while (frontier.length) {
    const next = [];
    for (const s of frontier) {
      if (isSolved(s.bl)) return { solved: true, pushes: s.d };
      const occ = new Set(s.bl.map((b) => b[0] + ',' + b[1]));
      for (let i = 0; i < s.bl.length; i++) {
        for (const [dx, dz] of DIRS) {
          const [bx, bz] = s.bl[i];
          if (!s.reach.has((bx - dx) + ',' + (bz - dz))) continue;
          const nx = bx + dx, nz = bz + dz;
          if (!free(nx, nz) || occ.has(nx + ',' + nz)) continue;
          const nb = s.bl.map((b) => [...b]); nb[i] = [nx, nz];
          const pl = [bx, bz];
          const rg = region(nb, pl);
          const k = key(nb) + '#' + rg.min.join(',');
          if (visited.has(k)) continue;
          visited.add(k);
          if (visited.size > maxStates) return { solved: false, pushes: -1, exhausted: true };
          next.push({ bl: nb, pl, d: s.d + 1, reach: rg.seen });
        }
      }
    }
    frontier = next;
  }
  return { solved: false, pushes: -1 };
}

// ---------------------------------------------------------------- glyph memory
export class GlyphSeq {
  constructor(ch, def) {
    this.ch = ch; this.def = def; this.id = def.id; this.solved = false; this.state = 'idle'; this.t = 0; this.idx = 0; this.input = 0; this.showing = -1; this.onGlyph = -1;
  }
  get glyphs() { return this.def.glyphs.map((id) => this.ch.props.get(id)); }
  restoreSolved() { this.solved = true; this.state = 'solved'; }
  start() {
    if (this.solved || this.state === 'showing') return;
    this.state = 'showing'; this.t = 0; this.idx = 0; this.input = 0; this.showing = -1;
    this.ch.game.emit('puzzle', { id: this.id, kind: 'glyph_seq', event: 'start' });
  }
  reset() {}
  fail(g) {
    this.state = 'idle'; this.input = 0;
    for (const x of this.glyphs) x.lit = 0;
    if (g) g.err = 0.6;
    this.ch.game.emit('puzzle', { id: this.id, kind: 'glyph_seq', event: 'fail', prop: g });
    this.ch.game.emit('toast', { text: 'A discordant note. Wake the pedestal to hear it again.', kind: 'warn' });
    const p = this.ch.game.player;
    this.ch.spawnHazard({ ownerId: 'trap', pattern: 'circle', x: p.x, z: p.z, r: 1.3, telegraph: 0.5, damage: 0.5, poise: 10, knockback: 1.4, moveId: 'glyph_shock', trap: true });
  }
  update(dt) {
    const seq = this.def.sequence, gl = this.glyphs;
    for (const g of gl) { if (g.lit > 0) g.lit = Math.max(0, g.lit - dt); if (g.err > 0) g.err = Math.max(0, g.err - dt); }
    if (this.solved) return;
    if (this.state === 'showing') {
      this.t += dt;
      const step = 0.78, i = Math.floor(this.t / step);
      if (i >= seq.length) { this.state = 'input'; this.t = 0; this.input = 0; this.onGlyph = -1; this.ch.game.emit('puzzle', { id: this.id, kind: 'glyph_seq', event: 'listen' }); return; }
      if (i !== this.showing) { this.showing = i; gl[seq[i]].lit = 0.55; this.ch.game.emit('puzzle', { id: this.id, kind: 'glyph_seq', event: 'show', index: seq[i], step: i }); }
    } else if (this.state === 'input') {
      this.t += dt;
      if (this.t > 14) { this.state = 'idle'; this.input = 0; return; }
      const p = this.ch.game.player;
      let on = -1;
      gl.forEach((g, i) => { if (Math.hypot(p.x - g.x, p.z - g.z) < 0.7 && !p.dead) on = i; });
      if (on !== this.onGlyph) {
        this.onGlyph = on;
        if (on >= 0) {
          this.t = 0;
          if (on === seq[this.input]) {
            gl[on].lit = 0.7; this.input++;
            this.ch.game.emit('puzzle', { id: this.id, kind: 'glyph_seq', event: 'step', index: on, step: this.input - 1 });
            if (this.input >= seq.length) this.ch.solvePuzzle(this);
          } else this.fail(gl[on]);
        }
      }
    }
  }
}

export const PUZZLES = { brazier_seq: BrazierSeq, push_plates: PushPlates, glyph_seq: GlyphSeq };
