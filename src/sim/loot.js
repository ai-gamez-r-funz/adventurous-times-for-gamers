// Loot rolling. Deterministic given an RNG. Produces serialisable item objects.
import { BASES, UNIQUES, AFFIXES, RARITY, RARE_NAMES } from '../data/items.js';
import { uid } from '../core/util.js';

const SLOT_WEIGHTS = { weapon: 18, offhand: 12, helm: 14, chest: 16, amulet: 10, ring: 14 };
const ORDER = ['common', 'magic', 'rare', 'legendary'];
const maxTier = (ilvl) => (ilvl >= 5 ? 2 : ilvl >= 3 ? 1 : 0);

export function makeUnique(id) {
  const u = UNIQUES[id];
  return { uid: uid('i'), baseId: u.baseId, rarity: 'legendary', ilvl: 8, name: u.name, affixes: [], unique: id };
}

function rarityRoll(rng, ilvl, min) {
  const bonus = Math.min(1.8, 1 + (ilvl - 1) * 0.12);
  const w = { common: RARITY.common.weight / bonus, magic: RARITY.magic.weight * bonus, rare: RARITY.rare.weight * bonus * bonus };
  const list = Object.entries(w).filter(([r]) => ORDER.indexOf(r) >= ORDER.indexOf(min ?? 'common'));
  return rng.weighted(list, (x) => x[1])[0];
}

const roundV = (id, v) => (id === 'leech' || id === 'manaRegen' ? Math.round(v * 10) / 10 : Math.round(v));

export function rollItem(rng, { ilvl = 1, rarity, slot, classId, min } = {}) {
  const sl = slot ?? rng.weighted(Object.entries(SLOT_WEIGHTS), (x) => x[1])[0];
  const mt = maxTier(ilvl);
  let pool = Object.values(BASES).filter((b) => b.slot === sl && b.tier <= mt && (b.classes.includes('any') || !classId || b.classes.includes(classId)));
  if (!pool.length) pool = Object.values(BASES).filter((b) => b.slot === sl);
  // favour the highest tier available
  const top = Math.max(...pool.map((b) => b.tier));
  const weighted = pool.map((b) => ({ b, w: b.tier === top ? 3 : b.tier === top - 1 ? 1.5 : 0.5 }));
  const base = rng.weighted(weighted, (x) => x.w).b;
  const r = rarity ?? rarityRoll(rng, ilvl, min);
  const [lo, hi] = RARITY[r].affixes;
  const n = lo === hi ? lo : rng.int(lo, hi);
  const avail = Object.values(AFFIXES).filter((a) => a.slots.includes(sl));
  const chosen = [];
  while (chosen.length < n && avail.length) {
    const a = avail.splice(Math.floor(rng.next() * avail.length), 1)[0];
    const lowV = a.r[0] * (1 + 0.08 * (ilvl - 1)), highV = a.r[1] * (1 + 0.1 * (ilvl - 1));
    chosen.push({ id: a.id, v: roundV(a.id, rng.range(lowV, highV)) });
  }
  let name = base.name;
  if (r === 'magic') {
    const pre = chosen.map((c) => AFFIXES[c.id]).find((a) => a.prefix);
    const suf = chosen.map((c) => AFFIXES[c.id]).find((a) => a.suffix);
    if (pre) name = `${rng.pick(pre.prefix)} ${name}`;
    if (suf) name = `${name} ${rng.pick(suf.suffix)}`;
  } else if (r === 'rare') {
    name = `${rng.pick(RARE_NAMES.a)}${rng.pick(RARE_NAMES.b)}`;
  }
  return { uid: uid('i'), baseId: base.id, rarity: r, ilvl, name, affixes: chosen };
}

/** Enemy drops: { gold, potions:[kind], items:[item] } */
export function rollEnemyDrops(rng, def, { elite = false, level = 1, classId } = {}) {
  const d = def.drops ?? {};
  const out = { gold: 0, potions: [], items: [] };
  const [g0, g1] = d.gold ?? [0, 0];
  if (g1 > 0) out.gold = Math.round(rng.range(g0, g1) * (1 + 0.25 * (level - 1)) * (elite ? 2.2 : 1));
  const pBoost = elite ? 2 : 1;
  if (rng.chance(Math.min(1, (d.potion ?? 0) * pBoost))) out.potions.push(rng.chance(0.62) ? 'hp' : 'mana');
  const iChance = Math.min(1, (d.item ?? 0) * (elite ? 2.2 : 1));
  if (rng.chance(iChance)) out.items.push(rollItem(rng, { ilvl: level + (elite ? 1 : 0), classId, min: elite ? 'magic' : undefined }));
  if (elite && out.items.length === 0) out.items.push(rollItem(rng, { ilvl: level + 1, classId, min: 'magic' }));
  return out;
}

export function rollChest(rng, spec, classId) {
  const out = { gold: 0, potions: [], items: [] };
  if (spec.gold) out.gold = Math.round(rng.range(spec.gold[0], spec.gold[1]));
  for (let i = 0; i < (spec.potions ?? 0); i++) out.potions.push(rng.chance(0.6) ? 'hp' : 'mana');
  for (let i = 0; i < (spec.count ?? 0); i++) out.items.push(rollItem(rng, { ilvl: spec.ilvl ?? 1, classId, min: i === 0 ? spec.min : undefined }));
  if (spec.unique) out.items.push(makeUnique(spec.unique));
  return out;
}
