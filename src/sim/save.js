// Save format, migration, and storage adapter. Versioned; migration is a pure function so it can be tested.
export const SAVE_VERSION = 1;
export const SAVE_KEY = 'emberhollow.save';
export const SETTINGS_KEY = 'emberhollow.settings';

export const defaultProgress = () => ({
  flags: {}, chambers: {}, sigils: [], relics: [], lore: [], uniques: [], bestiary: {}, checkpoint: { chamber: 'gate', spawn: 'start' },
  stats: { kills: 0, deaths: 0, chests: 0, puzzles: 0, encounters: 0, time: 0 }, victory: false,
});

/** Bring any historical save shape up to SAVE_VERSION. Returns null for unusable input. */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let s = raw;
  if (s.version === undefined || s.version === 0) {
    // v0: early flat prototype shape { cls, lvl, xp, gold, bag, equip, chamber, sigils }
    if (!s.cls && !s.classId) return null;
    const progress = defaultProgress();
    progress.sigils = Array.isArray(s.sigils) ? [...s.sigils] : [];
    progress.checkpoint = { chamber: s.chamber ?? 'gate', spawn: s.chamber ? 'from_nave' : 'start' };
    s = {
      version: 1, classId: s.cls ?? s.classId, seed: s.seed ?? 1,
      player: { level: s.lvl ?? 1, xp: s.xp ?? 0, hp: null, mana: null },
      inv: { bag: padBag(s.bag), equip: { weapon: null, offhand: null, helm: null, chest: null, amulet: null, ring: null, ...(s.equip ?? {}) }, gold: s.gold ?? 0, potions: { hp: 3, mana: 1 } },
      progress, savedAt: s.savedAt ?? 0,
    };
  }
  if (s.version > SAVE_VERSION) return null; // from the future: refuse rather than corrupt
  // defensive normalisation so a hand-edited or partial save cannot crash the loader
  const prog = { ...defaultProgress(), ...(s.progress ?? {}) };
  prog.stats = { ...defaultProgress().stats, ...(prog.stats ?? {}) };
  for (const k of ['sigils', 'relics', 'lore', 'uniques']) if (!Array.isArray(prog[k])) prog[k] = [];
  s.progress = prog;
  s.inv.bag = padBag(s.inv.bag);
  s.player = { level: 1, xp: 0, ...(s.player ?? {}) };
  return s;
}
function padBag(bag) { const out = Array.isArray(bag) ? bag.slice(0, 24) : []; while (out.length < 24) out.push(null); return out.map((x) => x ?? null); }

export function browserStorage(key = SAVE_KEY) {
  return {
    load() { try { const t = localStorage.getItem(key); return t ? JSON.parse(t) : null; } catch { return null; } },
    save(data) { try { localStorage.setItem(key, JSON.stringify(data)); return true; } catch { return false; } },
    clear() { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };
}
export function memoryStorage() {
  let v = null;
  return { load: () => (v ? JSON.parse(v) : null), save: (d) => { v = JSON.stringify(d); return true; }, clear: () => { v = null; }, raw: () => v };
}
