import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game.js';
import { memoryStorage } from '../src/sim/save.js';
import { resolveHit } from '../src/sim/combat.js';
import { xpToNext } from '../src/data/classes.js';
import { DT, run, tp } from './helpers.js';

const smite = (g, e, dmg = 99999) => { e.invuln = false; resolveHit(g, g.player, e, { move: { damage: dmg, poise: 0, knockback: 0 } }); };
function clearRoom(g) { for (let i = 0; i < 30; i++) { const live = g.chamber.enemies.filter((e) => !e.dead); if (!live.length && g.chamber.encounters.every((x) => x.state !== 'active')) break; for (const e of live) { e.spawnT = 0; smite(g, e); } run(g, 0.5); } }
function lootAll(g) { for (const l of [...g.chamber.loot]) { if (l.kind === 'item') { g.collectLoot(l.id); } else g.collectLoot(l.id); } }

describe('full campaign (headless playthrough)', () => {
  it('gate -> three wings -> sigils -> boss (3 phases) -> victory -> reload', () => {
    const storage = memoryStorage();
    const g = new Game({ classId: 'oathbound', seed: 21, storage, fade: false });
    g.player.invuln = true;
    const events = { phases: [], victory: 0, encounters: [], boss: [] };
    g.on('boss', (e) => events.boss.push(e.kind + (e.phase ?? '')));
    g.on('victory', () => events.victory++);
    g.on('encounterClear', (e) => events.encounters.push(e.id));

    // --- Sunken Gate: ambush, chest, exit
    tp(g, 13.5, 10.5); run(g, 1.2); clearRoom(g);
    expect(events.encounters).toContain('g_ambush');
    expect(g.chamber.props.get('g_chest').hidden).toBe(false);
    g.chamber.interact(g.chamber.props.get('g_chest')); lootAll(g);
    expect(g.inv.gold).toBeGreaterThan(0);

    // --- Embers
    g.enterChamber('embers', 'from_nave'); g.player.invuln = true;
    const seq = g.chamber.puzzleOf('e_seq');
    for (const id of seq.order) seq.light(id);
    expect(seq.solved).toBe(true);
    tp(g, 14.5, 10.5); run(g, 1.5); clearRoom(g);
    expect(events.encounters).toContain('e_wave');
    expect(g.chamber.gateClosed('e_lock')).toBe(false);
    g.chamber.interact(g.chamber.props.get('e_altar'));
    g.chamber.interact(g.chamber.props.get('e_chest')); lootAll(g);
    expect(g.progress.sigils).toContain('ash');
    expect(g.progress.uniques).toContain('cinder_crown');

    // --- Ossuary
    g.enterChamber('ossuary', 'from_nave'); g.player.invuln = true;
    tp(g, 8.5, 12.5); run(g, 1.0); clearRoom(g);
    const oz = g.chamber.puzzleOf('o_blocks');
    oz.place(g.chamber.props.get('o_b1'), 25, 12); oz.place(g.chamber.props.get('o_b2'), 24, 12); oz.check();
    expect(oz.solved).toBe(true);
    tp(g, 32.5, 11.5); run(g, 1.2); clearRoom(g);
    g.chamber.interact(g.chamber.props.get('o_altar'));
    expect(g.progress.sigils).toContain('bone');

    // --- Reliquary
    g.enterChamber('reliquary', 'from_nave'); g.player.invuln = true;
    const rz = g.chamber.puzzleOf('r_song'); rz.start(); run(g, 6);
    const gl = rz.glyphs;
    for (const i of rz.def.sequence) { tp(g, gl[i].x, gl[i].z); run(g, 0.1); tp(g, 14.5, 13.5); run(g, 0.1); }
    expect(rz.solved).toBe(true);
    tp(g, 14.5, 3.5); run(g, 1.2); clearRoom(g);
    g.chamber.interact(g.chamber.props.get('r_altar'));
    expect(g.progress.sigils.sort()).toEqual(['ash', 'bone', 'mourning']);

    // --- level up a bit, then the Sanctum through the sealed door
    while (g.player.level < 6) g.grantXp(xpToNext(g.player.level));
    g.enterChamber('nave', 'from_sanctum'); g.player.invuln = true;
    for (const e of g.chamber.enemies) e.dead = true;
    tp(g, 17.5, 2.5); run(g, 0.3);
    expect(g.chamber.id).toBe('sanctum');
    tp(g, 20.5, 22.5); run(g, 3.5);
    const boss = g.chamber.enemies.find((e) => e.def.boss);
    expect(boss).toBeTruthy();
    expect(g.chamber.gateClosed('b_gate')).toBe(true);
    // chip the boss down: it must pause at each phase boundary and play the transition
    const hits = () => { boss.invuln = false; smite(g, boss, boss.maxHp * 0.5); };
    hits(); expect(boss.hp).toBeGreaterThanOrEqual(boss.maxHp * 0.66 - 1); // clamped at the p2 boundary
    run(g, 4); expect(boss.ai.phase).toBe(1);
    hits(); expect(boss.hp).toBeGreaterThanOrEqual(boss.maxHp * 0.33 - 1);
    run(g, 4); expect(boss.ai.phase).toBe(2);
    expect(events.boss.filter((b) => b.startsWith('phase'))).toEqual(['phase1', 'phase2']);
    // the summon move in phase 2+ is capped
    expect(g.chamber.enemies.filter((e) => e.parentId === boss.id && !e.dead).length).toBeLessThanOrEqual(3);
    for (let i = 0; i < 12 && !boss.dead; i++) { hits(); run(g, 0.2); }
    expect(boss.dead).toBe(true);
    run(g, 6);
    expect(events.victory).toBe(1);
    expect(g.progress.flags.bishop_slain).toBe(true);
    expect(g.chamber.props.get('b_chest').hidden).toBe(false);
    expect(g.chamber.gateClosed('b_gate')).toBe(false);
    g.chamber.interact(g.chamber.props.get('b_chest')); lootAll(g);
    expect(g.progress.uniques).toContain('bishops_censer');

    // --- persistence of the finished game
    g.save('end');
    const g2 = new Game({ save: storage.load(), storage: memoryStorage(), fade: false });
    expect(g2.progress.victory).toBe(true);
    expect(g2.progress.sigils).toHaveLength(3);
    expect(g2.progress.stats.kills).toBeGreaterThan(20);
    g2.enterChamber('sanctum', 'from_nave');
    expect(g2.chamber.enemies.find((e) => e.def.boss)).toBeUndefined(); // boss stays dead
    expect(g2.chamber.encounters[0].state).toBe('cleared');
    void DT;
  }, 60000);

  it('the witch can clear the tutorial ambush with only her own skills (balance smoke)', () => {
    const g = new Game({ classId: 'cinderwitch', seed: 2, fade: false });
    tp(g, 13.5, 10.5);
    let died = false; g.on('playerDeath', () => { died = true; });
    for (let i = 0; i < 60 * 150 && g.chamber.encounters[0].state !== 'cleared' && !died; i++) {
      const p = g.player;
      const foes = g.chamber.enemies.filter((e) => !e.dead && e.spawnT <= 0).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const cmds = [];
      if (foes[0]) { const d = Math.hypot(foes[0].x - p.x, foes[0].z - p.z); if (d < 2.6 && !p.cd.dodge) cmds.push({ t: 'dodge', x: p.x - (foes[0].x - p.x), z: p.z - (foes[0].z - p.z) }); else if (p.intent.kind !== 'attack' || p.intent.target !== foes[0].id) cmds.push({ t: 'attack', id: foes[0].id }); }
      g.step(DT, cmds);
    }
    expect(died).toBe(false);
    expect(g.chamber.encounters[0].state).toBe('cleared');
  }, 30000);
});
