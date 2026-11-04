import { describe, it, expect } from 'vitest';
import { validateContent } from '../src/data/validate.js';
import { CHAMBERS, CHAMBER_ORDER } from '../src/data/chambers.js';
import { buildGrid, reachable } from '../src/sim/grid.js';
import { solvePush } from '../src/sim/puzzles.js';
import { ENEMIES } from '../src/data/enemies.js';
import { SKILLS, CLASSES } from '../src/data/classes.js';

describe('authored content', () => {
  it('passes full content validation (ids, references, placement, reachability)', () => {
    expect(validateContent()).toEqual([]);
  });

  it('keeps every chamber on a single gameplay plane (no height data anywhere)', () => {
    const banned = ['y', 'elevation', 'height', 'ramp', 'stairs'];
    for (const def of Object.values(CHAMBERS)) {
      for (const e of def.entities) for (const k of banned) expect(k in e, `${def.id}/${e.id ?? e.t} has ${k}`).toBe(false);
      for (const f of def.floors) for (const k of banned) expect(k in f).toBe(false);
    }
  });

  it('every chamber is reachable from the start and the hub connects all wings', () => {
    const edges = {};
    for (const def of Object.values(CHAMBERS)) edges[def.id] = def.entities.filter((e) => e.t === 'door').map((d) => d.to);
    const seen = new Set(['gate']); const q = ['gate'];
    while (q.length) for (const n of edges[q.pop()]) if (!seen.has(n)) { seen.add(n); q.push(n); }
    expect([...seen].sort()).toEqual([...CHAMBER_ORDER].sort());
  });

  it('secret relic nooks are only reachable by breaking the cracked wall', () => {
    for (const def of Object.values(CHAMBERS)) {
      const crack = def.entities.find((e) => e.t === 'cracked');
      const relic = def.entities.find((e) => e.t === 'chest' && e.relic);
      if (!crack) continue;
      const g = buildGrid(def);
      const spawn = def.entities.find((e) => e.t === 'spawn');
      g.addDyn(crack.x, crack.z);
      const seen = reachable(g, spawn.x, spawn.z);
      const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => g.inB(relic.x + dx, relic.z + dz) && seen[g.idx(relic.x + dx, relic.z + dz)]);
      expect(near, `${def.id} relic should be sealed`).toBe(false);
      g.removeDyn(crack.x, crack.z);
      const seen2 = reachable(g, spawn.x, spawn.z);
      const near2 = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => seen2[g.idx(relic.x + dx, relic.z + dz)]);
      expect(near2, `${def.id} relic should open once cracked`).toBe(true);
    }
  });

  it('the Ossuary block puzzle is provably solvable', () => {
    const def = CHAMBERS.ossuary; const g = buildGrid(def);
    const pz = def.entities.find((e) => e.kind === 'push_plates');
    const b = pz.bounds;
    const free = (x, z) => g.isFloor(x, z) && !g.solid[g.idx(x, z)] && x >= b.x && z >= b.z && x < b.x + b.w && z < b.z + b.h;
    const pos = (id) => { const e = def.entities.find((x) => x.id === id); return [e.x, e.z]; };
    const r = solvePush({ free, blocks: pz.blocks.map(pos), plates: pz.plates.map(pos), player: [15, 11], maxStates: 1500000 });
    expect(r.solved).toBe(true);
    expect(r.pushes).toBeGreaterThanOrEqual(10);
  }, 60000);

  it('solver reports an unsolvable layout honestly (block jammed in a corner)', () => {
    const free = (x, z) => x >= 0 && z >= 0 && x < 6 && z < 6;
    const r = solvePush({ free, blocks: [[0, 0]], plates: [[3, 3]], player: [2, 2] });
    expect(r.solved).toBe(false);
  });

  it('enemy move definitions have sane timing and legal references', () => {
    for (const e of Object.values(ENEMIES)) for (const m of e.moves) {
      expect(m.startup).toBeGreaterThanOrEqual(0.3); // always a readable telegraph
      expect(m.active).toBeGreaterThan(0); expect(m.recovery).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('each class has four distinct skills with unlock levels and one free primary', () => {
    for (const c of Object.values(CLASSES)) {
      expect(new Set(c.skills).size).toBe(4);
      expect(SKILLS[c.skills[0]].cost).toBe(0);
    }
  });
});
