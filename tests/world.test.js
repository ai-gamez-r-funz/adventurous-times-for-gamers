import { describe, it, expect } from 'vitest';
import { newGame, run, tp, spawnAt, clearEnemies, gotoChamber, DT } from './helpers.js';
import { migrate, memoryStorage, SAVE_VERSION } from '../src/sim/save.js';
import { Game } from '../src/sim/game.js';
import { resolveHit } from '../src/sim/combat.js';
import { solvePush } from '../src/sim/puzzles.js';

const killAllEnc = (g) => { for (const e of g.chamber.enemies) if (!e.dead) { e.invuln = false; e.spawnT = 0; resolveHit(g, g.player, e, { move: { damage: 999, poise: 0, knockback: 0 }, mult: 1 }); } };

describe('encounters', () => {
  it('trigger -> gates close -> waves -> clear -> reward revealed once, never duplicated', () => {
    const g = newGame(); clearEnemies(g);
    expect(g.chamber.gateClosed('g_cage')).toBe(false);
    const chest = g.chamber.props.get('g_chest');
    expect(chest.hidden).toBe(true);
    tp(g, 13.5, 10.5);
    run(g, 0.2);
    expect(g.chamber.encounters[0].state).toBe('active');
    expect(g.chamber.gateClosed('g_cage')).toBe(true);
    for (let w = 0; w < 4 && g.chamber.encounters[0].state !== 'cleared'; w++) { run(g, 3); killAllEnc(g); run(g, 0.1); }
    expect(g.chamber.encounters[0].state).toBe('cleared');
    expect(g.chamber.gateClosed('g_cage')).toBe(false);
    expect(chest.hidden).toBe(false);
    // re-enter trigger: does not restart
    tp(g, 5.5, 18.5); run(g, 0.2); tp(g, 13.5, 10.5); run(g, 0.5);
    expect(g.chamber.encounters[0].state).toBe('cleared');
    // open chest once only
    tp(g, 24.5, 9); chest.opened = false;
    const prog = g.chamberProgress('gate');
    g.chamber.interact(chest); const n = prog.opened.length;
    expect(chest.opened).toBe(true);
    expect(prog.opened.filter((x) => x === 'g_chest')).toHaveLength(1);
    expect(n).toBe(1);
  });

  it('death resets an uncleared encounter; cleared state persists through reload', () => {
    const g = newGame(); clearEnemies(g);
    tp(g, 13.5, 10.5); run(g, 1.5);
    expect(g.chamber.encounters[0].state).toBe('active');
    g.player.hp = 1;
    resolveHit(g, { kind: 'enemy', team: 'enemy', id: 'x', level: 1, def: { damage: 500 }, x: 0, z: 0 }, g.player, { move: { damage: 5, poise: 0, knockback: 0 } });
    expect(g.player.dead).toBe(true);
    g.respawn();
    expect(g.chamber.encounters[0].state).toBe('idle');
    expect(g.chamber.gateClosed('g_cage')).toBe(false);
    expect(g.chamber.enemies.filter((e) => e.group === 'enc:g_ambush')).toHaveLength(0);
  });

  it('killed ambient enemies stay dead and do not re-drop after chamber reload', () => {
    const g = newGame();
    const husk = g.chamber.enemies.find((e) => e.persistId === 'g_h1');
    resolveHit(g, g.player, husk, { move: { damage: 999, poise: 0, knockback: 0 } });
    expect(husk.dead).toBe(true);
    const lootBefore = g.chamber.loot.length;
    gotoChamber(g, 'nave', 'from_gate'); gotoChamber(g, 'gate', 'from_nave');
    expect(g.chamber.enemies.find((e) => e.persistId === 'g_h1')).toBeUndefined();
    expect(g.chamber.loot.length).toBe(lootBefore); // drops persisted, not duplicated
  });
});

describe('doors, hub and sanctum seal', () => {
  it('walking into a door cell changes chamber and spawn position matches', () => {
    const g = newGame(); clearEnemies(g);
    tp(g, 13.5, 1.5); run(g, 0.1);
    expect(g.chamber.id).toBe('nave');
    expect(Math.hypot(g.player.x - 16.5, g.player.z - 22.5)).toBeLessThan(1.2);
  });
  it('the Sanctum door stays sealed until all three sigils are owned', () => {
    const g = newGame(); gotoChamber(g, 'nave', 'from_sanctum'); clearEnemies(g);
    tp(g, 17.5, 2.5); run(g, 0.2);
    expect(g.chamber.id).toBe('nave');
    g.progress.sigils.push('ash', 'bone', 'mourning');
    tp(g, 17.5, 2.5); run(g, 0.2);
    expect(g.chamber.id).toBe('sanctum');
    expect(g.progress.flags.sanctum_unsealed).toBe(true);
  });
  it('fade transitions swap the chamber mid-fade and block simulation meanwhile', () => {
    const g = new Game({ classId: 'oathbound', seed: 3, fade: true });
    clearEnemies(g); tp(g, 13.5, 1.5);
    run(g, 0.1);
    expect(g.transition).not.toBeNull();
    const t0 = g.time; run(g, 0.2); expect(g.time).toBe(t0); // paused during fade
    run(g, 0.7);
    expect(g.chamber.id).toBe('nave'); expect(g.transition).toBeNull();
  });
});

describe('puzzles', () => {
  const light = (g, id) => g.chamber.puzzleOf('e_seq').light(id);
  it('brazier sequence: wrong order resets and punishes; right order solves and opens the vault', () => {
    const g = newGame(); gotoChamber(g, 'embers', 'from_nave'); clearEnemies(g);
    const open = () => g.chamber.gateClosed('e_vault');
    expect(open()).toBe(true);
    expect(light(g, 'e_b0')).toBe(true);
    expect(light(g, 'e_b2')).toBe(false); // skipped one
    expect(g.chamber.props.get('e_b0').lit).toBe(false);
    expect(g.chamber.hazards.some((h) => h.trap)).toBe(true);
    for (const id of ['e_b0', 'e_b1', 'e_b2', 'e_b3']) light(g, id);
    expect(g.chamber.puzzleOf('e_seq').solved).toBe(true);
    expect(open()).toBe(false);
    expect(g.progress.flags.e_solved).toBe(true);
  });
  it('brazier is lit by a projectile and survives chamber reload when solved', () => {
    const g = newGame(); gotoChamber(g, 'embers', 'from_nave'); clearEnemies(g);
    for (const id of ['e_b0', 'e_b1', 'e_b2', 'e_b3']) light(g, id);
    gotoChamber(g, 'nave', 'from_embers'); gotoChamber(g, 'embers', 'from_nave');
    expect(g.chamber.props.get('e_b3').lit).toBe(true);
    expect(g.chamber.gateClosed('e_vault')).toBe(false);
  });
  it('a player attack hitting a brazier lights it (ranged and melee)', () => {
    const g = newGame({ classId: 'cinderwitch' }); gotoChamber(g, 'embers', 'from_nave'); clearEnemies(g);
    tp(g, 8.5, 17.5); g.player.face = -Math.PI / 2;
    run(g, 1, (i) => (i === 0 ? [{ t: 'skill', slot: 0, x: 4.5, z: 17.5 }] : []));
    expect(g.chamber.props.get('e_b0').lit).toBe(true);
  });
  it('glyph song: pedestal plays the sequence; correct steps solve; a wrong step resets', () => {
    const g = newGame(); gotoChamber(g, 'reliquary', 'from_nave'); clearEnemies(g);
    const pz = g.chamber.puzzleOf('r_song');
    pz.start(); run(g, 6);
    expect(pz.state).toBe('input');
    const gl = g.chamber.puzzleOf('r_song').glyphs;
    const step = (i) => { tp(g, gl[i].x, gl[i].z); run(g, 0.1); tp(g, 14.5, 13.5); run(g, 0.1); };
    step(2); step(1); // wrong second step (expected 0)
    expect(pz.state).toBe('idle');
    g.player.hp = g.stats.maxHp;
    pz.start(); run(g, 6);
    for (const i of [2, 0, 3, 1, 2]) step(i);
    expect(pz.solved).toBe(true);
    expect(g.chamber.gateClosed('r_vault')).toBe(false);
  });
  it('pushing a block moves it exactly one cell, respects walls/other blocks, and solving opens the gate', () => {
    const g = newGame(); gotoChamber(g, 'ossuary', 'from_nave'); clearEnemies(g);
    const b = g.chamber.props.get('o_b1'); const hx = b.cx, hz = b.cz;
    tp(g, hx - 0.65, hz + 0.5);
    run(g, 0.9, () => [{ t: 'moveDir', x: 1, z: 0 }]);
    run(g, 0.1, () => [{ t: 'moveDir', x: 0, z: 0 }]);
    expect(b.cx).toBeGreaterThan(hx);
    // forcibly place both blocks on plates
    const pz = g.chamber.puzzleOf('o_blocks');
    pz.place(g.chamber.props.get('o_b1'), 25, 12); pz.place(g.chamber.props.get('o_b2'), 24, 12); pz.check();
    expect(pz.solved).toBe(true);
    expect(g.chamber.gateClosed('o_gate')).toBe(false);
  });
  it('reset rune returns blocks home unless the puzzle is solved', () => {
    const g = newGame(); gotoChamber(g, 'ossuary', 'from_nave'); clearEnemies(g);
    const pz = g.chamber.puzzleOf('o_blocks'); const b = g.chamber.props.get('o_b1');
    pz.place(b, 18, 9);
    pz.reset();
    expect([b.cx, b.cz]).toEqual([19, 8]);
    expect(g.chamber.grid.dyn[g.chamber.grid.idx(18, 9)]).toBe(0);
  });
});

describe('save / load / migration', () => {
  it('round-trips progress, inventory and checkpoint', () => {
    const storage = memoryStorage();
    const g = new Game({ classId: 'cinderwitch', seed: 5, storage, fade: false });
    g.progress.sigils.push('ash'); g.grantXp(300);
    gotoChamber(g, 'nave', 'from_gate');
    g.chamber.interact(g.chamber.props.get('n_way'));
    const lvl = g.player.level;
    const g2 = new Game({ save: storage.load(), storage: memoryStorage(), fade: false });
    expect(g2.classId).toBe('cinderwitch');
    expect(g2.player.level).toBe(lvl);
    expect(g2.progress.sigils).toEqual(['ash']);
    expect(g2.chamber.id).toBe('nave');
    expect(g2.inv.equip.weapon.baseId).toBe('ash_wand');
  });
  it('migrates the legacy v0 prototype save and refuses saves from the future', () => {
    const legacy = { cls: 'oathbound', lvl: 4, xp: 20, gold: 55, sigils: ['bone'], bag: [null, { uid: 'a1', baseId: 'oathblade', rarity: 'common', ilvl: 1, name: 'Oathblade', affixes: [] }] };
    const m = migrate(legacy);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.inv.bag).toHaveLength(24); expect(m.inv.gold).toBe(55); expect(m.progress.sigils).toEqual(['bone']);
    const g = new Game({ save: legacy, fade: false });
    expect(g.player.level).toBe(4);
    expect(migrate({ version: 99, classId: 'oathbound' })).toBeNull();
    expect(migrate(null)).toBeNull();
    expect(migrate({})).toBeNull();
  });
  it('new game on empty storage starts clean (reset flow is idempotent)', () => {
    const s = memoryStorage(); const g = new Game({ storage: s, fade: false }); g.save();
    s.clear();
    const g2 = new Game({ storage: s, save: s.load(), fade: false });
    expect(g2.player.level).toBe(1); expect(g2.chamber.id).toBe('gate');
  });
});

describe('lock-on block pushing (mouse scheme)', () => {
  it('a push command walks to the far side and slides the block exactly one cell; blocked pushes do nothing', () => {
    const g = newGame(); gotoChamber(g, 'ossuary', 'from_nave'); clearEnemies(g); g.walkPush = false;
    const b = g.chamber.props.get('o_b1');
    tp(g, 15.5, 11.5);
    g.step(DT, [{ t: 'push', id: 'o_b1', dx: 1, dz: 0 }]);
    run(g, 5);
    expect([b.cx, b.cz]).toEqual([20, 8]);
    // push north into the room's wall: stays put
    run(g, 0.4);
    for (let i = 0; i < 4; i++) { g.step(DT, [{ t: 'push', id: 'o_b1', dx: 0, dz: -1 }]); run(g, 3); }
    expect(b.cz).toBeGreaterThanOrEqual(5);
    expect(g.chamber.grid.dyn[g.chamber.grid.idx(b.cx, b.cz)]).toBe(1);
  });

  it('walk-pushing is disabled in the mouse scheme (no accidental pushes while click-moving)', () => {
    const g = newGame(); gotoChamber(g, 'ossuary', 'from_nave'); clearEnemies(g); g.walkPush = false;
    const b = g.chamber.props.get('o_b1'); const hx = b.cx;
    tp(g, b.cx - 0.65, b.cz + 0.5);
    run(g, 1.2, () => [{ t: 'moveDir', x: 1, z: 0 }]);
    expect(b.cx).toBe(hx);
  });

  it('SOLVES the Ossuary using only lock-on push commands (solver plan replayed through the real controller)', () => {
    const g = newGame(); gotoChamber(g, 'ossuary', 'from_nave'); clearEnemies(g); g.walkPush = false;
    const def = g.chamber.def, gr = g.chamber.grid, pzd = def.entities.find((e) => e.kind === 'push_plates'), bd = pzd.bounds;
    const free = (x, z) => gr.isFloor(x, z) && !gr.solid[gr.idx(x, z)] && x >= bd.x && z >= bd.z && x < bd.x + bd.w && z < bd.z + bd.h;
    const pos = (id) => { const e = def.entities.find((x) => x.id === id); return [e.x, e.z]; };
    const sol = solvePush({ free, blocks: pzd.blocks.map(pos), plates: pzd.plates.map(pos), player: [15, 11], maxStates: 1500000 });
    expect(sol.solved).toBe(true);
    tp(g, 15.5, 11.5);
    for (const mv of sol.moves) {
      const b = g.chamber.props.get(pzd.blocks[mv.block]); const before = [b.cx, b.cz];
      g.step(DT, [{ t: 'push', id: b.id, dx: mv.dir[0], dz: mv.dir[1] }]);
      let t = 0; while (t < 12 && b.cx === before[0] && b.cz === before[1]) { g.step(DT); t += DT; }
      expect([b.cx, b.cz], `push ${JSON.stringify(mv)}`).toEqual([before[0] + mv.dir[0], before[1] + mv.dir[1]]);
      run(g, 0.3);
    }
    expect(g.chamber.puzzleOf('o_blocks').solved).toBe(true);
    expect(g.chamber.gateClosed('o_gate')).toBe(false);
  }, 90000);
});

describe('spawn safety', () => {
  it('an enemy spawned inside a solid object is moved to open floor (never unreachable)', () => {
    const g = newGame(); gotoChamber(g, 'ossuary', 'from_nave'); clearEnemies(g);
    const e = g.chamber.spawnEnemy('archer', 31, 15); // the lore tablet o_lore2 lives on this cell
    expect(g.chamber.grid.circleBlocked(e.x, e.z, e.radius * 0.9)).toBe(false);
    expect(Math.hypot(e.x - 31.5, e.z - 15.5)).toBeLessThan(3);
  });
  it('every authored enemy and wave spawn is clear of solids (validator guard)', async () => {
    const { validateContent } = await import('../src/data/validate.js');
    expect(validateContent().filter((m) => /spawns|overlaps a wall/.test(m))).toEqual([]);
  });
});
