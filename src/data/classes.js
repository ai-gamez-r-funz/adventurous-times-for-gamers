// Player classes and skills. Authored, immutable content. Runtime state lives in sim/.
// Every skill is a "move": startup -> active -> recovery, with a contact shape resolved by sim/combat.js.
const P = Math.PI;

export const DODGE = {
  id: 'dodge', name: 'Dodge Roll', duration: 0.42, distance: 3.6, iFrom: 0.03, iTo: 0.27, cooldown: 0.85,
};

export const SKILLS = {
  // ---------------- Oathbound (melee) ----------------
  cleave: {
    id: 'cleave', name: 'Cleave', icon: 'cleave', tags: ['melee', 'primary'],
    desc: 'A wide, rending swing. Generates Resolve on every enemy struck.',
    cost: 0, cooldown: 0, startup: 0.13, active: 0.1, recovery: 0.27,
    shape: { type: 'arc', range: 2.6, arc: P * 0.78 }, damage: 1.0, poise: 16, knockback: 1.1,
    anim: 'slash', lunge: 0.7, gain: 4, sfx: 'swing', vfx: 'slash', unlock: 1,
  },
  shieldbash: {
    id: 'shieldbash', name: 'Shield Bash', icon: 'bash', tags: ['melee'],
    desc: 'Smash enemies in front of you, breaking their poise and stunning them briefly.',
    cost: 10, cooldown: 4, startup: 0.2, active: 0.1, recovery: 0.35,
    shape: { type: 'arc', range: 2.1, arc: P * 0.55 }, damage: 0.9, poise: 90, knockback: 2.6,
    status: { stun: 0.9 }, anim: 'bash', lunge: 0.9, sfx: 'bash', vfx: 'slash', unlock: 1,
  },
  whirlwind: {
    id: 'whirlwind', name: 'Whirlwind', icon: 'whirl', tags: ['melee', 'spin'],
    desc: 'Spin in a murderous storm, moving slowly toward the cursor.',
    cost: 22, cooldown: 7, startup: 0.12, active: 0.84, recovery: 0.3, tick: 0.21,
    shape: { type: 'circle', radius: 2.4 }, damage: 0.62, poise: 22, knockback: 0.9,
    moveDuring: { speed: 3.3, phase: 'active' }, anim: 'spin', sfx: 'whirl', vfx: 'spin', unlock: 2,
  },
  charge: {
    id: 'charge', name: 'Iron Charge', icon: 'charge', tags: ['melee', 'dash'],
    desc: 'Rush forward, trampling everything in your path.',
    cost: 16, cooldown: 6, startup: 0.16, active: 0.26, recovery: 0.3,
    shape: { type: 'line', length: 1.9, width: 1.7 }, damage: 1.25, poise: 70, knockback: 2.2,
    move: { type: 'dash', dist: 6.2 }, anim: 'thrust', sfx: 'charge', vfx: 'dash', unlock: 4,
  },
  // ---------------- Cinder Witch (caster) ----------------
  emberbolt: {
    id: 'emberbolt', name: 'Ember Bolt', icon: 'bolt', tags: ['ranged', 'primary'],
    desc: 'Hurl a bolt of living ember. Lights braziers it touches.',
    cost: 0, cooldown: 0, startup: 0.15, active: 0.05, recovery: 0.27, range: 10,
    shape: { type: 'projectile', speed: 15, radius: 0.32, life: 0.9, pierce: 0, light: true },
    damage: 1.0, poise: 12, knockback: 0.6, anim: 'cast', sfx: 'ember', vfx: 'bolt', unlock: 1,
  },
  frostnova: {
    id: 'frostnova', name: 'Frost Nova', icon: 'nova', tags: ['spell', 'aoe'],
    desc: 'A freezing ring explodes from you, chilling and slowing foes.',
    cost: 18, cooldown: 6, startup: 0.22, active: 0.08, recovery: 0.35,
    shape: { type: 'circle', radius: 3.7 }, damage: 0.85, poise: 40, knockback: 1.4,
    status: { slow: { t: 3.2, mag: 0.5 } }, anim: 'cast_aoe', sfx: 'nova', vfx: 'nova', unlock: 1,
  },
  arclightning: {
    id: 'arclightning', name: 'Arc Lightning', icon: 'arc', tags: ['spell', 'chain'],
    desc: 'Lightning leaps between up to four enemies.',
    cost: 14, cooldown: 3, startup: 0.2, active: 0.06, recovery: 0.34, range: 9.5,
    shape: { type: 'chain', range: 9.5, hops: 3, hopRange: 4.6, cone: P * 0.4 }, damage: 0.8, poise: 20, knockback: 0.4,
    anim: 'cast', sfx: 'arc', vfx: 'arc', unlock: 2,
  },
  blink: {
    id: 'blink', name: 'Ember Blink', icon: 'blink', tags: ['spell', 'blink'],
    desc: 'Vanish in a burst of cinders and reappear toward the cursor.',
    cost: 10, cooldown: 5, startup: 0.1, active: 0.05, recovery: 0.2,
    shape: { type: 'circle', radius: 2.2 }, damage: 0.55, poise: 30, knockback: 1.8,
    move: { type: 'blink', dist: 6.5 }, anim: 'cast_aoe', sfx: 'blink', vfx: 'blink', unlock: 4,
  },
};

export const CLASSES = {
  oathbound: {
    id: 'oathbound', name: 'Oathbound', title: 'Sworn Knight of the Vigil',
    blurb: 'Iron, resolve and a cracked oath. Close-range brawler who builds Resolve by cleaving and spends it on brutal skills.',
    resource: 'Resolve', resourceColor: '#c8a24a', rig: 'oathbound',
    base: { maxHp: 150, hpPerLevel: 16, maxMana: 60, manaPerLevel: 3, armor: 22, dmgPerLevel: 0.07, manaRegen: 1.2, speed: 4.9, crit: 5, dodge: 4, block: 12 },
    skills: ['cleave', 'shieldbash', 'whirlwind', 'charge'],
    start: { weapon: 'rusted_sword', offhand: 'splintered_shield', chest: 'tattered_mail' },
    weaponKinds: ['sword', 'axe', 'mace'], offhandKinds: ['shield'],
  },
  cinderwitch: {
    id: 'cinderwitch', name: 'Cinder Witch', title: 'Last Ember of the Choir',
    blurb: 'Fragile and ferocious. Kites with ember and storm, freezes crowds, and blinks out of trouble.',
    resource: 'Cinders', resourceColor: '#e8742c', rig: 'cinderwitch',
    base: { maxHp: 105, hpPerLevel: 11, maxMana: 100, manaPerLevel: 6, armor: 8, dmgPerLevel: 0.075, manaRegen: 4.2, speed: 5.1, crit: 8, dodge: 10, block: 0 },
    skills: ['emberbolt', 'frostnova', 'arclightning', 'blink'],
    start: { weapon: 'ash_wand', offhand: 'cracked_focus', chest: 'threadbare_robe' },
    weaponKinds: ['wand', 'staff'], offhandKinds: ['focus'],
  },
};

export const MAX_LEVEL = 12;
export const xpToNext = (level) => Math.round(55 * Math.pow(level, 1.55));
export const POTION = { hp: { heal: 0.45, cooldown: 7 }, mana: { restore: 0.55, cooldown: 7 } };
export const CHAMBER_LEVELS = { gate: 1, nave: 2, embers: 3, ossuary: 3, reliquary: 4, sanctum: 6 };
