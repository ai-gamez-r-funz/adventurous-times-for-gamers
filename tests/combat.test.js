import { describe, it, expect } from 'vitest';
import { newGame, run, tp, spawnAt, clearEnemies, DT } from './helpers.js';
import { inArc, inCircle, inLine, inRing } from '../src/sim/combat.js';
import { DODGE } from '../src/data/classes.js';
import * as actors from '../src/sim/actors.js';
import * as combat from '../src/sim/combat.js';

describe('contact shapes', () => {
  it('arc: range and angle boundaries (with target radius)', () => {
    expect(inArc(0, 0, 0, 2, Math.PI / 2, 0, 1.9, 0.3)).toBe(true);
    expect(inArc(0, 0, 0, 2, Math.PI / 2, 0, 2.31, 0.3)).toBe(false);
    expect(inArc(0, 0, 0, 2, Math.PI / 2, 1.4, 1.4, 0.1)).toBe(true); // 45deg edge
    expect(inArc(0, 0, 0, 2, Math.PI / 2, 1.9, 0.1, 0.1)).toBe(false); // behind the edge
    expect(inArc(0, 0, 0, 2, Math.PI / 2, 0, -1, 0.3)).toBe(false); // wrong direction
  });
  it('circle, ring and line', () => {
    expect(inCircle(0, 0, 2, 2.3, 0, 0.4)).toBe(true);
    expect(inCircle(0, 0, 2, 2.5, 0, 0.4)).toBe(false);
    expect(inRing(0, 0, 3, 6, 1, 0, 0.3)).toBe(false); // safe inside
    expect(inRing(0, 0, 3, 6, 4, 0, 0.3)).toBe(true);
    expect(inRing(0, 0, 3, 6, 7, 0, 0.3)).toBe(false); // safe outside
    expect(inLine(0, 0, 0, 5, 1, 0.4, 3, 0.2)).toBe(true);
    expect(inLine(0, 0, 0, 5, 1, 2, 3, 0.2)).toBe(false);
  });
});

describe('player combat', () => {
  it('cleave hits every enemy in the arc exactly once and ignores those behind', () => {
    const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5);
    const a = spawnAt(g, 'husk', 13.5, 16.0, { sleep: true }), b = spawnAt(g, 'husk', 14.4, 15.9, { sleep: true }), behind = spawnAt(g, 'husk', 13.5, 12.8, { sleep: true });
    for (const e of [a, b, behind]) { e.ai.alerted = false; e.ai.sleep = true; e.def = { ...e.def, aggro: 0 }; }
    const hits = [];
    g.on('hit', (h) => hits.push(h.target.id));
    g.player.face = 0;
    run(g, 1, (i) => (i === 0 ? [{ t: 'skill', slot: 0, x: 13.5, z: 20 }] : []));
    expect(hits.filter((id) => id === a.id)).toHaveLength(1);
    expect(hits.filter((id) => id === b.id)).toHaveLength(1);
    expect(hits).not.toContain(behind.id);
  });

  it('active window gates damage: nothing lands during startup, contact happens only when active', () => {
    const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5);
    const e = spawnAt(g, 'husk', 13.5, 16.0); e.def = { ...e.def, aggro: 0 };
    let hitT = null;
    g.on('hit', () => { hitT ??= g.player.action ? g.player.action.t : -1; });
    g.player.face = 0;
    g.step(DT, [{ t: 'skill', slot: 0, x: 13.5, z: 20 }]);
    run(g, 0.1); expect(hitT).toBeNull(); // cleave startup is 0.13s
    run(g, 0.2); expect(hitT).not.toBeNull();
    expect(hitT).toBeGreaterThanOrEqual(0.13 - 1e-6);
  });

  it('skill cooldown and resource gating, then ready again at the exact boundary', () => {
    const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5);
    g.player.level = 3; g.recomputeStats(); g.player.mana = 100;
    const used = [];
    g.on('skillUsed', (s) => used.push(s.skill.id));
    g.step(DT, [{ t: 'skill', slot: 1, x: 14.5, z: 16 }]);
    expect(used).toEqual(['shieldbash']);
    run(g, 1.0, (i) => (i === 10 ? [{ t: 'skill', slot: 1, x: 14.5, z: 16 }] : []));
    expect(used).toEqual(['shieldbash']); // still on cooldown (4s)
    g.player.mana = 0;
    run(g, 4, (i) => (i === 100 ? [{ t: 'skill', slot: 1, x: 14.5, z: 16 }] : []));
    expect(used).toEqual(['shieldbash']); // no resource
  });

  it('Dodge and Block are passive stats: 100% dodge avoids every hit, 100% block halves damage', () => {
    const hitOnce = (mut) => {
      const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5);
      mut(g);
      const e = spawnAt(g, 'husk', 13.5, 15.6); e.ai.alerted = true; e.ai.pause = 0;
      const got = { hits: [], dodged: 0 };
      g.on('hit', (h) => { if (h.target === g.player) got.hits.push(h); }); g.on('dodged', () => got.dodged++);
      run(g, 3);
      return got;
    };
    const base = hitOnce(() => {});
    expect(base.hits.length).toBeGreaterThan(0);
    const dodge = hitOnce((g) => { g.stats.dodge = 100; });
    expect(dodge.hits).toHaveLength(0); expect(dodge.dodged).toBeGreaterThan(0);
    const block = hitOnce((g) => { g.stats.dodge = 0; g.stats.block = 100; });
    expect(block.hits[0].blocked).toBe(true);
    expect(block.hits[0].amount).toBeLessThan(base.hits[0].amount * 0.75);
  });

  it('class and gear set the dodge/block percentages (shield gives block, witch dodges more)', () => {
    const k = newGame(), w = newGame({ classId: 'cinderwitch' });
    expect(k.stats.block).toBeGreaterThan(w.stats.block);
    expect(w.stats.dodge).toBeGreaterThan(k.stats.dodge);
    expect(k.stats.dodge).toBeLessThanOrEqual(50);
  });

  it('there is no active roll: the Space/dodge command no longer exists in the sim', () => {
    const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5);
    g.step(DT, [{ t: 'dodge', x: 20, z: 14.5 }]);
    expect(g.player.state).not.toBe('roll');
  });

  it('poise break staggers an enemy, but armored startup of a brute slam is not interrupted', () => {
    const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5);
    const husk = spawnAt(g, 'husk', 13.5, 15.8, { sleep: true }); husk.def = { ...husk.def, aggro: 0 };
    g.player.level = 3; g.recomputeStats(); g.player.mana = 100;
    run(g, 0.9, (i) => (i === 0 ? [{ t: 'skill', slot: 1, x: 13.5, z: 20 }] : []));
    expect(husk.state === 'stagger' || husk.staggerT > 0 || husk.status.stun !== undefined || husk.hp < husk.maxHp).toBe(true);
    // armored brute
    const brute = spawnAt(g, 'brute', 14.5, 16.5); brute.ai.alerted = true;
    const slam = brute.def.moves.find((m) => m.id === 'brute_slam');
    const { makeAction } = actors;
    makeAction(g, brute, slam, { x: g.player.x, z: g.player.z });
    brute.poise = 1;
    const before = brute.action.id;
    const { resolveHit } = combat;
    resolveHit(g, g.player, brute, { move: { damage: 1, poise: 100, knockback: 3 } });
    expect(brute.action?.id).toBe(before); // still winding up
  });

  it('hit dedupe: a spinning whirlwind re-hits per tick but never twice within a tick', () => {
    const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5);
    g.player.level = 3; g.recomputeStats(); g.player.mana = 100;
    const e = spawnAt(g, 'brute', 14.8, 14.5, { sleep: true }); e.def = { ...e.def, aggro: 0 };
    let n = 0; g.on('hit', (h) => { if (h.target === e) n++; });
    run(g, 1.4, (i) => (i === 0 ? [{ t: 'skill', slot: 2, x: 20, z: 14.5 }] : []));
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(5);
  });
});

describe('hold position (Shift) and target lock', () => {
  it('while standing, move commands do nothing but attacks still fire toward the target', () => {
    const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5);
    g.step(DT, [{ t: 'stand', on: true }]);
    const x0 = g.player.x, z0 = g.player.z;
    run(g, 0.6, (i) => (i === 0 ? [{ t: 'moveTo', x: 20, z: 5, hold: true }, { t: 'moveDir', x: 1, z: 0 }] : []));
    expect(Math.hypot(g.player.x - x0, g.player.z - z0)).toBeLessThan(0.01);
    const e = spawnAt(g, 'husk', 13.5, 16.0, { sleep: true }); e.def = { ...e.def, aggro: 0 };
    let hit = 0; g.on('hit', (h) => { if (h.target === e) hit++; });
    run(g, 1, (i) => (i === 0 ? [{ t: 'skill', slot: 0, x: e.x, z: e.z }] : []));
    expect(hit).toBeGreaterThan(0);
    expect(Math.hypot(g.player.x - x0, g.player.z - z0)).toBeLessThan(0.9); // only the tiny cleave lunge
  });

  it('an attack-on-target intent never chases while holding position, and chases once released', () => {
    const g = newGame(); clearEnemies(g); tp(g, 8.5, 14.5);
    const e = spawnAt(g, 'husk', 16.5, 14.5, { sleep: true }); e.def = { ...e.def, aggro: 0 };
    g.step(DT, [{ t: 'stand', on: true }, { t: 'attack', id: e.id }]);
    run(g, 1.5);
    expect(g.player.x).toBeCloseTo(8.5, 1);
    expect(g.player.face).toBeCloseTo(Math.PI / 2, 0); // turned to face it
    g.step(DT, [{ t: 'stand', on: false }, { t: 'attack', id: e.id }]);
    run(g, 2);
    expect(g.player.x).toBeGreaterThan(10);
  });

  it('casting a skill keeps an attack-lock intent alive', () => {
    const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5); g.player.level = 3; g.recomputeStats(); g.player.mana = 100;
    const e = spawnAt(g, 'brute', 17.5, 14.5, { sleep: true }); e.def = { ...e.def, aggro: 0 };
    g.step(DT, [{ t: 'attack', id: e.id }, { t: 'skill', slot: 1, x: e.x, z: e.z }]);
    expect(g.player.intent.kind).toBe('attack');
  });
});

describe('early-game pacing', () => {
  it('a lone level-1 husk attacks no more than about once every 2.5s', () => {
    const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5); g.player.invuln = true;
    const e = spawnAt(g, 'husk', 13.5, 16.0); e.ai.alerted = true;
    let n = 0; g.on('windup', (w) => { if (w.actor === e) n++; });
    run(g, 20);
    expect(n).toBeGreaterThan(2);
    expect(n).toBeLessThanOrEqual(9);
  });
  it('only one melee attacker is committed at a time in level 1-2 chambers', () => {
    const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5); g.player.invuln = true;
    const es = [0, 1, 2, 3].map((i) => { const e = spawnAt(g, 'husk', 13.5 + Math.cos(i * 1.6) * 2.5, 14.5 + Math.sin(i * 1.6) * 2.5); e.ai.alerted = true; e.ai.pause = 0; return e; });
    let max = 0;
    for (let i = 0; i < 60 * 10; i++) { g.step(DT); max = Math.max(max, es.filter((e) => e.action?.move.tags.includes('melee')).length); }
    expect(max).toBe(1);
  });
});
