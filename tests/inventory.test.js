import { describe, it, expect } from 'vitest';
import * as Inv from '../src/sim/inventory.js';
import { rollItem, makeUnique, rollChest } from '../src/sim/loot.js';
import { computeStats, itemStats } from '../src/sim/stats.js';
import { RNG } from '../src/core/util.js';
import { BAG_SIZE, BASES } from '../src/data/items.js';
import { newGame } from './helpers.js';

const rng = () => new RNG(99);
const mk = (baseId, extra = {}) => ({ uid: `t${Math.random()}`, baseId, rarity: 'common', ilvl: 1, name: BASES[baseId].name, affixes: [], ...extra });

describe('inventory transactions', () => {
  it('equip swaps in place and conserves item identity', () => {
    let inv = Inv.emptyInventory();
    const a = mk('rusted_sword'), b = mk('oathblade');
    inv = Inv.addToBag(inv, a).inv; inv = Inv.equipFromBag(inv, 0, 'oathbound').inv;
    inv = Inv.addToBag(inv, b).inv;
    const before = Inv.itemUids(inv);
    const r = Inv.equipFromBag(inv, 0, 'oathbound');
    expect(r.ok).toBe(true);
    expect(r.inv.equip.weapon.uid).toBe(b.uid);
    expect(r.inv.bag[0].uid).toBe(a.uid);
    expect(Inv.itemUids(r.inv)).toEqual(before);
    expect(inv.equip.weapon.uid).toBe(a.uid); // original state untouched (immutable)
  });
  it('rejects wrong-class equips without changing anything', () => {
    let inv = Inv.addToBag(Inv.emptyInventory(), mk('ash_wand')).inv;
    const r = Inv.equipFromBag(inv, 0, 'oathbound');
    expect(r).toMatchObject({ ok: false, reason: 'wrong class' });
    expect(inv.bag[0]).not.toBeNull();
  });
  it('full bag: pickup rejected, unequip rejected, equip swap still works', () => {
    let inv = Inv.emptyInventory();
    for (let i = 0; i < BAG_SIZE; i++) inv = Inv.addToBag(inv, mk('tin_band')).inv;
    expect(Inv.addToBag(inv, mk('tin_band'))).toMatchObject({ ok: false, reason: 'bag full' });
    inv.equip.weapon = mk('rusted_sword');
    expect(Inv.unequip(inv, 'weapon')).toMatchObject({ ok: false });
    const w = mk('oathblade'); inv.bag[3] = w;
    const r = Inv.equipFromBag(inv, 3, 'oathbound');
    expect(r.ok).toBe(true);
    expect(Inv.itemUids(r.inv)).toEqual(Inv.itemUids(inv));
  });
  it('duplicate pickup of the same uid is rejected', () => {
    const it = mk('tin_band');
    const inv = Inv.addToBag(Inv.emptyInventory(), it).inv;
    expect(Inv.addToBag(inv, it)).toMatchObject({ ok: false, reason: 'duplicate' });
  });
  it('drop removes exactly one item and potions cannot go negative', () => {
    let inv = Inv.addToBag(Inv.emptyInventory(), mk('tin_band')).inv;
    const r = Inv.dropFromBag(inv, 0);
    expect(r.ok).toBe(true); expect(Inv.itemUids(r.inv)).toHaveLength(0);
    let p = Inv.emptyInventory(); p.potions.hp = 1;
    p = Inv.usePotion(p, 'hp').inv;
    expect(Inv.usePotion(p, 'hp')).toMatchObject({ ok: false });
  });
  it('repeated dispatch is idempotent for equip of an already-emptied slot', () => {
    let inv = Inv.addToBag(Inv.emptyInventory(), mk('oathblade')).inv;
    inv = Inv.equipFromBag(inv, 0, 'oathbound').inv;
    expect(Inv.equipFromBag(inv, 0, 'oathbound')).toMatchObject({ ok: false, reason: 'empty slot' });
  });
});

describe('game inventory flow', () => {
  it('equipping a better weapon raises damage; effects are not double-registered after a swap', () => {
    const g = newGame();
    const base = g.stats.dmgMax;
    const better = mk('oathblade');
    g.inv = Inv.addToBag(g.inv, better).inv; g.recomputeStats();
    const idx = g.inv.bag.findIndex((x) => x?.uid === better.uid);
    expect(g.equip(idx)).toBe(true);
    const after = g.stats.dmgMax;
    expect(after).toBeGreaterThan(base);
    g.equip(g.inv.bag.findIndex((x) => x && x.baseId === 'rusted_sword'));
    g.equip(g.inv.bag.findIndex((x) => x && x.baseId === 'oathblade'));
    expect(g.stats.dmgMax).toBeCloseTo(after, 6);
  });
  it('dropping then picking up an item returns it exactly once', () => {
    const g = newGame();
    const it = mk('tin_band'); g.inv = Inv.addToBag(g.inv, it).inv;
    const idx = g.inv.bag.findIndex((x) => x?.uid === it.uid);
    g.dropItem(idx);
    expect(g.inv.bag.some((x) => x?.uid === it.uid)).toBe(false);
    const l = g.chamber.loot.find((x) => x.item?.uid === it.uid);
    expect(l).toBeTruthy();
    expect(g.collectLoot(l.id)).toBe(true);
    expect(g.collectLoot(l.id)).toBe(false);
    expect(Inv.itemUids(g.inv).filter((u) => u === it.uid)).toHaveLength(1);
  });
  it('a full pack leaves the loot on the ground (no loss)', () => {
    const g = newGame();
    for (let i = 0; i < BAG_SIZE; i++) g.inv = Inv.addToBag(g.inv, mk('tin_band')).inv;
    g.chamber.loot.push({ id: 'lx', kind: 'item', item: mk('garnet_ring'), x: 1, z: 1, age: 1 });
    expect(g.collectLoot('lx')).toBe(false);
    expect(g.chamber.loot.some((l) => l.id === 'lx')).toBe(true);
  });
});

describe('loot and stats', () => {
  it('rolls are deterministic per seed and respect class + rarity floors', () => {
    const a = rollItem(rng(), { ilvl: 5, classId: 'cinderwitch', min: 'rare' });
    const b = rollItem(rng(), { ilvl: 5, classId: 'cinderwitch', min: 'rare' });
    expect({ ...a, uid: 0 }).toEqual({ ...b, uid: 0 });
    expect(['rare', 'legendary']).toContain(a.rarity);
    expect(BASES[a.baseId].classes.some((c) => c === 'any' || c === 'cinderwitch')).toBe(true);
    expect(a.affixes.length).toBeGreaterThanOrEqual(3);
  });
  it('uniques apply their fixed stats and chests award a guaranteed unique', () => {
    const u = makeUnique('vigils_edge');
    expect(itemStats(u).dmg[0]).toBeGreaterThan(20);
    const drops = rollChest(rng(), { count: 1, ilvl: 3, unique: 'cinder_crown' }, 'oathbound');
    expect(drops.items.some((i) => i.unique === 'cinder_crown')).toBe(true);
  });
  it('level and gear scale stats upward', () => {
    const e = { weapon: mk('rusted_sword'), offhand: null, helm: null, chest: null, amulet: null, ring: null };
    const l1 = computeStats('oathbound', 1, e), l5 = computeStats('oathbound', 5, e);
    expect(l5.maxHp).toBeGreaterThan(l1.maxHp); expect(l5.dmgMax).toBeGreaterThan(l1.dmgMax);
  });
});
