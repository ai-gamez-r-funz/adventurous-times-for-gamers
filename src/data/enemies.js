// Enemy archetypes: immutable authored definitions. AI chooses legal move ids; combat owns timing & outcomes.
// Rig/presentation specs live in render/rigs.js, referenced by `rig`.
const P = Math.PI;

export const ENEMIES = {
  husk: {
    id: 'husk', name: 'Hollow Husk', rig: 'husk', role: 'brawler', tags: ['undead', 'melee'],
    hp: 62, damage: 9, speed: 2.55, radius: 0.42, armor: 4, poise: 34, xp: 14, aggro: 9.5, leash: 22,
    drops: { gold: [2, 7], potion: 0.07, item: 0.1 },
    moves: [
      { id: 'husk_claw', name: 'Rake', tags: ['melee'], minR: 0, maxR: 1.9, weight: 3, startup: 0.55, active: 0.12, recovery: 0.7, cooldown: 0.9,
        shape: { type: 'arc', range: 2.05, arc: 1.7 }, damage: 1.0, poise: 12, knockback: 1.0, anim: 'slash', track: 0.65, sfx: 'swing' },
      { id: 'husk_lunge', name: 'Lunge', tags: ['melee'], minR: 2.3, maxR: 4.3, weight: 1.3, startup: 0.78, active: 0.2, recovery: 0.95, cooldown: 4.5,
        shape: { type: 'line', length: 2.7, width: 1.1 }, move: { type: 'lunge', dist: 2.6 }, damage: 1.3, poise: 18, knockback: 1.6, anim: 'thrust', track: 0.55, sfx: 'swing' },
    ],
  },
  archer: {
    id: 'archer', name: 'Bone Archer', rig: 'archer', role: 'ranged', tags: ['undead', 'ranged'],
    hp: 42, damage: 10, speed: 2.9, radius: 0.38, armor: 2, poise: 22, xp: 17, aggro: 12, leash: 24, keepRange: [6.2, 9.8],
    drops: { gold: [3, 9], potion: 0.1, item: 0.12 },
    moves: [
      { id: 'archer_shot', name: 'Bone Arrow', tags: ['ranged'], minR: 2.5, maxR: 13, weight: 3, startup: 0.95, active: 0.05, recovery: 0.8, cooldown: 1.9, needsLos: true,
        shape: { type: 'projectile', speed: 12.5, radius: 0.22, life: 1.4, pierce: 0 }, damage: 1.0, poise: 8, knockback: 0.5, anim: 'shoot', track: 0.75, telegraph: 'aim', sfx: 'bow' },
    ],
  },
  cultist: {
    id: 'cultist', name: 'Ashen Cultist', rig: 'cultist', role: 'caster', tags: ['human', 'ranged'],
    hp: 54, damage: 14, speed: 2.7, radius: 0.4, armor: 3, poise: 24, xp: 24, aggro: 11, leash: 22, keepRange: [5, 9],
    drops: { gold: [4, 12], potion: 0.14, item: 0.16 },
    moves: [
      { id: 'cultist_rite', name: 'Ember Rite', tags: ['ranged'], minR: 2, maxR: 11, weight: 2.4, startup: 1.3, active: 0.15, recovery: 0.85, cooldown: 3.4, needsLos: true,
        shape: { type: 'hazard', pattern: 'target', radius: 1.75, lock: 0.62 }, damage: 1.5, poise: 20, knockback: 1.8, anim: 'cast_aoe', sfx: 'rite' },
      { id: 'cultist_bolt', name: 'Ash Bolt', tags: ['ranged'], minR: 3, maxR: 12, weight: 1.4, startup: 0.7, active: 0.05, recovery: 0.7, cooldown: 2.2, needsLos: true,
        shape: { type: 'projectile', speed: 7.5, radius: 0.36, life: 2.2, pierce: 0, color: 0xd0562a }, damage: 0.9, poise: 8, knockback: 0.6, anim: 'cast', track: 0.8, telegraph: 'aim', sfx: 'ember' },
    ],
  },
  brute: {
    id: 'brute', name: 'Gravebrute', rig: 'brute', role: 'bruiser', tags: ['undead', 'melee', 'heavy'],
    hp: 230, damage: 22, speed: 2.1, radius: 0.68, armor: 18, poise: 130, xp: 75, aggro: 10, leash: 26,
    drops: { gold: [14, 32], potion: 0.3, item: 0.55 },
    moves: [
      { id: 'brute_slam', name: 'Grave Slam', tags: ['melee', 'heavy'], minR: 0, maxR: 3.0, weight: 2.4, startup: 1.05, active: 0.14, recovery: 1.05, cooldown: 3.2, armor: 'startup',
        shape: { type: 'circle', radius: 2.3, offset: 1.9 }, damage: 1.4, poise: 70, knockback: 3.2, anim: 'overhead', track: 0.5, sfx: 'slam' },
      { id: 'brute_sweep', name: 'Ruin Sweep', tags: ['melee', 'heavy'], minR: 0, maxR: 2.9, weight: 2, startup: 0.85, active: 0.16, recovery: 0.9, cooldown: 2.4,
        shape: { type: 'arc', range: 2.9, arc: 2.3 }, damage: 1.0, poise: 50, knockback: 2.4, anim: 'slash', track: 0.55, sfx: 'swing' },
      { id: 'brute_charge', name: 'Rampage', tags: ['melee', 'heavy'], minR: 5, maxR: 11, weight: 1.6, startup: 1.05, active: 0.5, recovery: 1.5, cooldown: 8, armor: 'active',
        shape: { type: 'line', length: 2.4, width: 1.7 }, move: { type: 'lunge', dist: 7.5 }, damage: 1.5, poise: 90, knockback: 3.5, anim: 'thrust', track: 0.7, telegraph: 'line', sfx: 'charge' },
    ],
  },
  bishop: {
    id: 'bishop', name: 'The Hollow Bishop', rig: 'bishop', role: 'boss', tags: ['undead', 'boss', 'melee', 'ranged'],
    hp: 1250, damage: 17, speed: 2.5, radius: 0.78, armor: 24, poise: 300, xp: 900, aggro: 40, leash: 99, boss: true,
    drops: { gold: [120, 200], potion: 1, item: 1 },
    phases: [
      { id: 'p1', from: 1.0, moves: ['bishop_mace', 'bishop_backswing', 'bishop_censer', 'bishop_slam'], speedMult: 1, recoveryMult: 1 },
      { id: 'p2', from: 0.66, moves: ['bishop_mace', 'bishop_backswing', 'bishop_censer', 'bishop_slam', 'bishop_summon', 'bishop_rites'], speedMult: 1.06, recoveryMult: 0.92 },
      { id: 'p3', from: 0.33, moves: ['bishop_mace', 'bishop_backswing', 'bishop_censer', 'bishop_slam', 'bishop_summon', 'bishop_rites', 'bishop_nova'], speedMult: 1.15, recoveryMult: 0.8 },
    ],
    moves: [
      { id: 'bishop_mace', name: 'Censure', tags: ['melee'], minR: 0, maxR: 3.4, weight: 3, startup: 0.78, active: 0.13, recovery: 0.5, cooldown: 1.4, chain: 'bishop_backswing', chainChance: 0.55,
        shape: { type: 'arc', range: 3.2, arc: 2.0 }, damage: 1.0, poise: 40, knockback: 2.0, anim: 'overhead', track: 0.6, sfx: 'slam' },
      { id: 'bishop_backswing', name: 'Recant', tags: ['melee'], minR: 0, maxR: 3.6, weight: 0, chainOnly: true, startup: 0.34, active: 0.13, recovery: 0.95, cooldown: 0,
        shape: { type: 'arc', range: 3.3, arc: 2.5 }, damage: 1.1, poise: 40, knockback: 2.4, anim: 'slash', track: 0.2, sfx: 'swing' },
      { id: 'bishop_censer', name: 'Censer Fan', tags: ['ranged'], minR: 3.2, maxR: 15, weight: 2.4, startup: 1.0, active: 0.1, recovery: 0.95, cooldown: 4.2, needsLos: true,
        shape: { type: 'projectile', speed: 8.2, radius: 0.42, life: 2.6, pierce: 0, fan: 5, spread: 0.62, color: 0xe0902a }, damage: 0.8, poise: 10, knockback: 0.9, anim: 'cast', track: 0.7, telegraph: 'aim', sfx: 'ember' },
      { id: 'bishop_slam', name: 'Hollow Slam', tags: ['melee', 'heavy'], minR: 0, maxR: 4.5, weight: 2, startup: 1.1, active: 0.14, recovery: 1.0, cooldown: 5,
        shape: { type: 'circle', radius: 3.0, offset: 2.2 }, damage: 1.3, poise: 60, knockback: 3.2, anim: 'overhead', track: 0.5, sfx: 'slam' },
      { id: 'bishop_summon', name: 'Call the Husks', tags: ['summon'], minR: 0, maxR: 99, weight: 2, startup: 1.7, active: 0.1, recovery: 1.0, cooldown: 20, maxAdds: 3, adds: { def: 'husk', count: 2 },
        shape: { type: 'summon' }, damage: 0, poise: 0, knockback: 0, anim: 'summon', track: 0, sfx: 'summon' },
      { id: 'bishop_rites', name: 'Rites of Ash', tags: ['ranged'], minR: 0, maxR: 99, weight: 2.2, startup: 1.35, active: 0.12, recovery: 1.0, cooldown: 9,
        shape: { type: 'hazard', pattern: 'triple', radius: 1.9, lock: 0.7, stagger: 0.42 }, damage: 1.4, poise: 20, knockback: 2.0, anim: 'cast_aoe', track: 0, sfx: 'rite' },
      { id: 'bishop_nova', name: 'Tolling Ring', tags: ['ranged'], minR: 0, maxR: 99, weight: 1.8, startup: 1.5, active: 0.18, recovery: 1.1, cooldown: 11,
        shape: { type: 'hazard', pattern: 'ring', radius: 7.2, inner: 3.1, lock: 0 }, damage: 1.5, poise: 40, knockback: 3.0, anim: 'cast_aoe', track: 0, sfx: 'toll' },
    ],
    phaseShift: { duration: 2.1, ring: { radius: 5.5, damage: 0.6, knockback: 5 } },
  },
};

export const ELITE = { hp: 2.4, damage: 1.25, scale: 1.22, xp: 3, affixes: ['frenzied', 'bulwark', 'vengeful'] };
export const enemyScale = (level) => 1 + 0.13 * (level - 1);
export const NAMES = { elitePrefix: { frenzied: 'Frenzied', bulwark: 'Bulwark', vengeful: 'Vengeful' } };
