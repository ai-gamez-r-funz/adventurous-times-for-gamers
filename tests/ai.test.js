import { describe, it, expect } from 'vitest';
import { newGame, run, tp, spawnAt, clearEnemies, DT } from './helpers.js';
import * as actors from '../src/sim/actors.js';
import * as combat from '../src/sim/combat.js';

describe('enemy AI', () => {
  it('sleeping enemies ignore a distant player; awake enemies with line of sight aggro', () => {
    const g = newGame(); clearEnemies(g); tp(g, 5.5, 18.5);
    const sleeper = g.chamber.spawnEnemy('husk', 20, 8, { sleep: true });
    const awake = g.chamber.spawnEnemy('husk', 10, 17, { sleep: false });
    run(g, 0.5);
    expect(sleeper.ai.alerted).toBe(false);
    expect(awake.ai.alerted).toBe(true);
  });

  it('no line of sight through walls: an enemy behind a wall does not notice', () => {
    const g = newGame(); clearEnemies(g);
    tp(g, 13.5, 3.5); // in the north corridor
    const e = g.chamber.spawnEnemy('husk', 13, 8, { sleep: false }); e.x = 13.5; e.z = 6.6;
    g.chamber.setGateLock('g_cage', 'test', true);
    run(g, 0.3);
    // gate is not a wall for LOS purposes, but dyn blockers are in blocked(): LOS should be blocked
    expect(e.ai.alerted).toBe(false);
  });

  it('never deals damage before the full telegraph elapses', () => {
    const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5);
    const e = spawnAt(g, 'husk', 13.5, 16.0); e.ai.alerted = true; e.ai.pause = 0;
    let first = null; let windup = null;
    g.on('windup', (w) => { if (w.actor === e) windup ??= g.time; });
    g.on('hit', (h) => { if (h.target === g.player) first ??= g.time; });
    run(g, 3);
    expect(windup).not.toBeNull();
    expect(first).not.toBeNull();
    expect(first - windup).toBeGreaterThanOrEqual(0.5); // claw startup 0.55 (tracking can't skip it)
  });

  it('caps simultaneous melee attackers via attack tokens', () => {
    const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5);
    const es = [];
    for (let i = 0; i < 5; i++) { const e = spawnAt(g, 'husk', 13.5 + Math.cos(i) * 2.4, 14.5 + Math.sin(i) * 2.4); e.ai.alerted = true; e.ai.pause = 0; es.push(e); }
    g.player.invuln = true;
    let maxCommitted = 0;
    for (let i = 0; i < 60 * 8; i++) {
      g.step(DT);
      maxCommitted = Math.max(maxCommitted, es.filter((e) => e.action && e.action.move.tags.includes('melee')).length);
    }
    expect(maxCommitted).toBeLessThanOrEqual(2);
    expect(maxCommitted).toBeGreaterThanOrEqual(1);
  });

  it('archers keep their distance and retreat when pressed', () => {
    const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5);
    const a = spawnAt(g, 'archer', 13.5, 16.5); a.ai.alerted = true; a.ai.pause = 5;
    g.player.invuln = true;
    run(g, 2);
    expect(Math.hypot(a.x - g.player.x, a.z - g.player.z)).toBeGreaterThan(4.5);
  });

  it('a stunned enemy cancels its action and cancels owned hazards (cultist rite)', () => {
    const g = newGame(); clearEnemies(g); tp(g, 13.5, 14.5);
    const c = spawnAt(g, 'cultist', 13.5, 19.0); c.ai.alerted = true; c.ai.pause = 0;
    run(g, 0.4);
    expect(g.chamber.hazards.length + g.chamber.projectiles.length + (c.action ? 1 : 0)).toBeGreaterThan(0);
    // force the rite
    const rite = c.def.moves.find((m) => m.id === 'cultist_rite');
    if (c.action) { c.action = null; }
    g.chamber.hazards = [];
    const { makeAction } = actors;
    makeAction(g, c, rite, { x: g.player.x, z: g.player.z });
    expect(g.chamber.hazards.some((h) => h.ownerId === c.id)).toBe(true);
    const { beginStagger } = combat;
    beginStagger(c, 0.5);
    expect(g.chamber.hazards.some((h) => h.ownerId === c.id)).toBe(false);
  });

  it('enemies leash back home and heal when the player escapes', () => {
    const g = newGame(); clearEnemies(g); tp(g, 5.5, 18.5);
    const e = spawnAt(g, 'husk', 10.5, 17.5); e.ai.alerted = true; e.hp = 5; e.ai.home = { x: 10.5, z: 17.5 };
    g.player.invuln = true;
    // player is "dead" => enemies disengage and return
    g.player.dead = true;
    run(g, 3);
    expect(e.ai.alerted).toBe(false);
    expect(e.hp).toBeGreaterThan(5);
  });
});
