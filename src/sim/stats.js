// Derived stats: class base + level + equipment. Pure function of serialisable state.
import { CLASSES } from '../data/classes.js';
import { BASES, UNIQUES } from '../data/items.js';

export function itemStats(item) {
  if (!item) return {};
  const base = BASES[item.baseId];
  const st = item.unique ? { ...UNIQUES[item.unique].fixed } : { ...base.stats };
  for (const a of item.affixes ?? []) {
    if (a.id === 'dmgFlat') {
      const d = st.dmg ?? [0, 0];
      st.dmg = [d[0] + a.v, d[1] + a.v];
    } else st[a.id] = (st[a.id] ?? 0) + a.v;
  }
  return st;
}

export function computeStats(classId, level, equip) {
  const c = CLASSES[classId];
  const b = c.base;
  const sum = {};
  let dmg = [3, 5];
  for (const item of Object.values(equip)) {
    if (!item) continue;
    const st = itemStats(item);
    for (const [k, v] of Object.entries(st)) {
      if (k === 'dmg') { if (BASES[item.baseId].slot === 'weapon') dmg = [v[0], v[1]]; continue; }
      sum[k] = (sum[k] ?? 0) + v;
    }
  }
  const lv = level - 1;
  const levelMul = 1 + b.dmgPerLevel * lv;
  const dmgMul = levelMul * (1 + (sum.dmgPct ?? 0) / 100);
  return {
    maxHp: Math.round(b.maxHp + b.hpPerLevel * lv + (sum.hp ?? 0)),
    maxMana: Math.round(b.maxMana + b.manaPerLevel * lv + (sum.mana ?? 0)),
    armor: Math.round(b.armor + lv * 1.5 + (sum.armor ?? 0)),
    dmgMin: dmg[0] * dmgMul, dmgMax: dmg[1] * dmgMul,
    crit: b.crit + (sum.crit ?? 0), critMult: 1.6,
    speed: b.speed * (1 + (sum.speed ?? 0) / 100),
    atkSpeed: sum.atkSpeed ?? 0,
    leech: sum.leech ?? 0,
    manaRegen: b.manaRegen + (sum.manaRegen ?? 0),
  };
}
