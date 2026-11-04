// Inventory as pure transactions. Every operation validates, computes the whole next state, and commits once or rejects.
// Items are immutable value objects { uid, baseId, rarity, ilvl, name, affixes, unique? } so identity survives swaps.
import { BAG_SIZE, BASES, SLOTS } from '../data/items.js';

export const emptyInventory = () => ({
  bag: Array(BAG_SIZE).fill(null),
  equip: Object.fromEntries(SLOTS.map((s) => [s, null])),
  gold: 0,
  potions: { hp: 3, mana: 1 },
});
const clone = (inv) => ({ bag: [...inv.bag], equip: { ...inv.equip }, gold: inv.gold, potions: { ...inv.potions } });
const fail = (reason) => ({ ok: false, reason });

export function canEquip(item, classId) {
  const base = BASES[item.baseId];
  if (!base) return fail('unknown item');
  if (!base.classes.includes('any') && !base.classes.includes(classId)) return fail('wrong class');
  return { ok: true };
}
export const firstEmpty = (inv) => inv.bag.findIndex((x) => x === null);

export function addToBag(inv, item) {
  if (!item) return fail('no item');
  if (allItems(inv).some((i) => i.uid === item.uid)) return fail('duplicate');
  const i = firstEmpty(inv);
  if (i < 0) return fail('bag full');
  const next = clone(inv);
  next.bag[i] = item;
  return { ok: true, inv: next, index: i };
}

export function equipFromBag(inv, index, classId) {
  const item = inv.bag[index];
  if (!item) return fail('empty slot');
  const c = canEquip(item, classId);
  if (!c.ok) return c;
  const slot = BASES[item.baseId].slot;
  const next = clone(inv);
  const prev = next.equip[slot];
  next.equip[slot] = item;
  next.bag[index] = prev ?? null; // swap in place: identity conserved, never needs a free slot
  return { ok: true, inv: next, slot, replaced: prev };
}

export function unequip(inv, slot) {
  const item = inv.equip[slot];
  if (!item) return fail('nothing equipped');
  const i = firstEmpty(inv);
  if (i < 0) return fail('bag full');
  const next = clone(inv);
  next.bag[i] = item;
  next.equip[slot] = null;
  return { ok: true, inv: next, index: i };
}

export function dropFromBag(inv, index) {
  const item = inv.bag[index];
  if (!item) return fail('empty slot');
  const next = clone(inv);
  next.bag[index] = null;
  return { ok: true, inv: next, dropped: item };
}

export function moveBag(inv, from, to) {
  if (from === to || from < 0 || to < 0 || from >= BAG_SIZE || to >= BAG_SIZE) return fail('bad slot');
  if (!inv.bag[from]) return fail('empty slot');
  const next = clone(inv);
  [next.bag[from], next.bag[to]] = [next.bag[to], next.bag[from]];
  return { ok: true, inv: next };
}

export function addGold(inv, n) { const next = clone(inv); next.gold += Math.max(0, Math.floor(n)); return { ok: true, inv: next }; }
export function addPotion(inv, kind, n = 1) { const next = clone(inv); next.potions[kind] = Math.min(9, (next.potions[kind] ?? 0) + n); return { ok: true, inv: next }; }
export function usePotion(inv, kind) {
  if ((inv.potions[kind] ?? 0) <= 0) return fail('no potion');
  const next = clone(inv); next.potions[kind] -= 1; return { ok: true, inv: next };
}

export const allItems = (inv) => [...inv.bag.filter(Boolean), ...Object.values(inv.equip).filter(Boolean)];
export const itemUids = (inv) => allItems(inv).map((i) => i.uid).sort();

/** Quick compare used by tooltips: positive means candidate is better. */
export function weaponScore(item) {
  if (!item) return 0;
  return 0;
}
