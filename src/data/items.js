// Item definitions. Runtime items reference these by id: { uid, baseId, rarity, ilvl, affixes:[{id,v}], name }.
export const SLOTS = ['weapon', 'offhand', 'helm', 'chest', 'amulet', 'ring'];
export const SLOT_LABEL = { weapon: 'Weapon', offhand: 'Off-hand', helm: 'Head', chest: 'Chest', amulet: 'Amulet', ring: 'Ring' };
export const RARITY = {
  common: { id: 'common', label: 'Common', color: '#b7b2a8', affixes: [0, 0], weight: 62 },
  magic: { id: 'magic', label: 'Blessed', color: '#6aa7ff', affixes: [1, 2], weight: 28 },
  rare: { id: 'rare', label: 'Rare', color: '#f0cf5a', affixes: [3, 4], weight: 9 },
  legendary: { id: 'legendary', label: 'Relic', color: '#ff8a2a', affixes: [0, 0], weight: 0 },
};

// kind: used for class compatibility. stats are the *base* stats before affixes (scaled by tier).
// dmg: [min,max], armor, hp, mana ...
export const BASES = {
  // weapons
  rusted_sword: { id: 'rusted_sword', slot: 'weapon', kind: 'sword', name: 'Rusted Sword', classes: ['oathbound'], tier: 0, stats: { dmg: [8, 12] } },
  oathblade: { id: 'oathblade', slot: 'weapon', kind: 'sword', name: 'Oathblade', classes: ['oathbound'], tier: 1, stats: { dmg: [13, 19] } },
  vigil_greatsword: { id: 'vigil_greatsword', slot: 'weapon', kind: 'sword', name: 'Vigil Greatsword', classes: ['oathbound'], tier: 2, stats: { dmg: [20, 29] } },
  grave_axe: { id: 'grave_axe', slot: 'weapon', kind: 'axe', name: 'Grave Axe', classes: ['oathbound'], tier: 1, stats: { dmg: [14, 21] } },
  iron_mace: { id: 'iron_mace', slot: 'weapon', kind: 'mace', name: 'Iron Mace', classes: ['oathbound'], tier: 2, stats: { dmg: [19, 27] } },
  ash_wand: { id: 'ash_wand', slot: 'weapon', kind: 'wand', name: 'Ash Wand', classes: ['cinderwitch'], tier: 0, stats: { dmg: [7, 11] } },
  yew_wand: { id: 'yew_wand', slot: 'weapon', kind: 'wand', name: 'Yew Wand', classes: ['cinderwitch'], tier: 1, stats: { dmg: [12, 17] } },
  bone_staff: { id: 'bone_staff', slot: 'weapon', kind: 'staff', name: 'Bone Staff', classes: ['cinderwitch'], tier: 1, stats: { dmg: [13, 20] } },
  choir_staff: { id: 'choir_staff', slot: 'weapon', kind: 'staff', name: 'Choirmaster Staff', classes: ['cinderwitch'], tier: 2, stats: { dmg: [19, 28] } },
  // off-hand
  splintered_shield: { id: 'splintered_shield', slot: 'offhand', kind: 'shield', name: 'Splintered Shield', classes: ['oathbound'], tier: 0, stats: { armor: 8, block: 8 } },
  tower_shield: { id: 'tower_shield', slot: 'offhand', kind: 'shield', name: 'Tower Shield', classes: ['oathbound'], tier: 1, stats: { armor: 17, block: 14 } },
  warden_shield: { id: 'warden_shield', slot: 'offhand', kind: 'shield', name: "Warden's Aegis", classes: ['oathbound'], tier: 2, stats: { armor: 28, hp: 20, block: 20 } },
  cracked_focus: { id: 'cracked_focus', slot: 'offhand', kind: 'focus', name: 'Cracked Focus', classes: ['cinderwitch'], tier: 0, stats: { mana: 12 } },
  censer_orb: { id: 'censer_orb', slot: 'offhand', kind: 'focus', name: 'Censer Orb', classes: ['cinderwitch'], tier: 1, stats: { mana: 24, dmgPct: 4 } },
  choir_tome: { id: 'choir_tome', slot: 'offhand', kind: 'focus', name: 'Choir Tome', classes: ['cinderwitch'], tier: 2, stats: { mana: 36, dmgPct: 8 } },
  // armour
  tattered_mail: { id: 'tattered_mail', slot: 'chest', kind: 'heavy', name: 'Tattered Mail', classes: ['oathbound'], tier: 0, stats: { armor: 14 } },
  gravewrought_plate: { id: 'gravewrought_plate', slot: 'chest', kind: 'heavy', name: 'Gravewrought Plate', classes: ['oathbound'], tier: 1, stats: { armor: 30, hp: 14 } },
  vigil_cuirass: { id: 'vigil_cuirass', slot: 'chest', kind: 'heavy', name: 'Vigil Cuirass', classes: ['oathbound'], tier: 2, stats: { armor: 48, hp: 30 } },
  threadbare_robe: { id: 'threadbare_robe', slot: 'chest', kind: 'cloth', name: 'Threadbare Robe', classes: ['cinderwitch'], tier: 0, stats: { armor: 6, mana: 8 } },
  ash_vestments: { id: 'ash_vestments', slot: 'chest', kind: 'cloth', name: 'Ash Vestments', classes: ['cinderwitch'], tier: 1, stats: { armor: 13, mana: 18 } },
  choir_raiment: { id: 'choir_raiment', slot: 'chest', kind: 'cloth', name: 'Choir Raiment', classes: ['cinderwitch'], tier: 2, stats: { armor: 22, mana: 30, hp: 12 } },
  rusted_helm: { id: 'rusted_helm', slot: 'helm', kind: 'any', name: 'Rusted Helm', classes: ['any'], tier: 0, stats: { armor: 5 } },
  grim_visage: { id: 'grim_visage', slot: 'helm', kind: 'any', name: 'Grim Visage', classes: ['any'], tier: 1, stats: { armor: 11, hp: 8 } },
  cowl_of_vigils: { id: 'cowl_of_vigils', slot: 'helm', kind: 'any', name: 'Cowl of Vigils', classes: ['any'], tier: 2, stats: { armor: 18, hp: 16 } },
  // jewellery
  bone_charm: { id: 'bone_charm', slot: 'amulet', kind: 'any', name: 'Bone Charm', classes: ['any'], tier: 0, stats: { hp: 10 } },
  silver_locket: { id: 'silver_locket', slot: 'amulet', kind: 'any', name: 'Silver Locket', classes: ['any'], tier: 1, stats: { hp: 20, crit: 2 } },
  tin_band: { id: 'tin_band', slot: 'ring', kind: 'any', name: 'Tin Band', classes: ['any'], tier: 0, stats: { armor: 3 } },
  garnet_ring: { id: 'garnet_ring', slot: 'ring', kind: 'any', name: 'Garnet Ring', classes: ['any'], tier: 1, stats: { dmgPct: 4, crit: 2 } },
};

export const UNIQUES = {
  vigils_edge: { id: 'vigils_edge', baseId: 'vigil_greatsword', name: "Vigil's Edge", lore: 'Forged to guard a flame that no longer burns.',
    fixed: { dmg: [24, 33], dmgPct: 14, leech: 2, crit: 6 } },
  wick_last_candle: { id: 'wick_last_candle', baseId: 'choir_staff', name: 'Wick of the Last Candle', lore: 'Its tip never stops smouldering.',
    fixed: { dmg: [22, 31], dmgPct: 16, manaRegen: 2.5, atkSpeed: 8 } },
  ossuary_plate: { id: 'ossuary_plate', baseId: 'vigil_cuirass', name: 'Ossuary Plate', lore: 'Ten thousand small bones, riveted to hold.',
    fixed: { armor: 66, hp: 55, speed: 4 } },
  cinder_crown: { id: 'cinder_crown', baseId: 'cowl_of_vigils', name: 'Cinder Crown', lore: 'Warm to the touch, as if recently worn.',
    fixed: { armor: 22, hp: 24, mana: 24, dmgPct: 10, manaRegen: 1.5 } },
  quiet_ash: { id: 'quiet_ash', baseId: 'garnet_ring', name: 'Ring of Quiet Ash', lore: 'It muffles footsteps and prayers alike.',
    fixed: { crit: 7, speed: 8, dmgPct: 6 } },
  bishops_censer: { id: 'bishops_censer', baseId: 'silver_locket', name: "The Bishop's Censer", lore: 'Still swinging on its chain, though no one holds it.',
    fixed: { hp: 60, leech: 3, dmgPct: 12, armor: 18, manaRegen: 1.2 } },
};

// Affix pool. `r` = [min,max] at tier 0; scaled by ilvl. `slots` restricts where it can roll.
export const AFFIXES = {
  dmgPct: { id: 'dmgPct', stat: 'dmgPct', prefix: ['Cruel', 'Vicious', 'Merciless'], suffix: null, r: [4, 10], slots: ['weapon', 'offhand', 'amulet', 'ring', 'helm'], fmt: (v) => `+${v}% Damage` },
  dmgFlat: { id: 'dmgFlat', stat: 'dmgFlat', prefix: ['Honed', 'Tempered'], suffix: null, r: [2, 5], slots: ['weapon'], fmt: (v) => `+${v} Damage` },
  armor: { id: 'armor', stat: 'armor', prefix: ['Bulwarked', 'Gilded'], suffix: null, r: [4, 11], slots: ['helm', 'chest', 'offhand', 'ring', 'amulet'], fmt: (v) => `+${v} Armor` },
  hp: { id: 'hp', stat: 'hp', prefix: null, suffix: ['of the Bear', 'of Vigor', 'of the Oak'], r: [10, 24], slots: ['helm', 'chest', 'amulet', 'ring', 'offhand'], fmt: (v) => `+${v} Life` },
  mana: { id: 'mana', stat: 'mana', prefix: null, suffix: ['of the Well', 'of Embers'], r: [8, 20], slots: ['helm', 'chest', 'amulet', 'ring', 'offhand', 'weapon'], fmt: (v) => `+${v} Resource` },
  crit: { id: 'crit', stat: 'crit', prefix: null, suffix: ['of Ruin', 'of Wounding'], r: [2, 6], slots: ['weapon', 'amulet', 'ring', 'helm'], fmt: (v) => `+${v}% Crit Chance` },
  speed: { id: 'speed', stat: 'speed', prefix: null, suffix: ['of the Hare', 'of Haste'], r: [3, 8], slots: ['chest', 'helm', 'ring', 'amulet'], fmt: (v) => `+${v}% Move Speed` },
  atkSpeed: { id: 'atkSpeed', stat: 'atkSpeed', prefix: ['Swift', 'Nimble'], suffix: null, r: [3, 8], slots: ['weapon', 'ring', 'amulet'], fmt: (v) => `+${v}% Attack Speed` },
  dodge: { id: 'dodge', stat: 'dodge', prefix: ['Elusive', 'Fleet'], suffix: null, r: [2, 5], slots: ['chest', 'helm', 'ring', 'amulet', 'offhand'], fmt: (v) => `+${v}% Dodge` },
  block: { id: 'block', stat: 'block', prefix: ['Stalwart'], suffix: null, r: [3, 7], slots: ['offhand'], fmt: (v) => `+${v}% Block` },
  leech: { id: 'leech', stat: 'leech', prefix: null, suffix: ['of the Leech', 'of Thirst'], r: [1, 2.5], slots: ['weapon', 'amulet', 'ring'], fmt: (v) => `+${v} Life per Hit` },
  manaRegen: { id: 'manaRegen', stat: 'manaRegen', prefix: null, suffix: ['of Renewal', 'of the Spring'], r: [0.6, 1.6], slots: ['offhand', 'helm', 'amulet', 'ring', 'chest'], fmt: (v) => `+${v}/s Resource Regen` },
};
export const STAT_LABEL = {
  dmgPct: (v) => `+${v}% Damage`, dmgFlat: (v) => `+${v} Damage`, armor: (v) => `+${v} Armor`, hp: (v) => `+${v} Life`, mana: (v) => `+${v} Resource`,
  crit: (v) => `+${v}% Crit Chance`, speed: (v) => `+${v}% Move Speed`, atkSpeed: (v) => `+${v}% Attack Speed`, leech: (v) => `+${v} Life per Hit`,
  manaRegen: (v) => `+${v}/s Resource Regen`, dodge: (v) => `+${v}% Dodge`, block: (v) => `+${v}% Block`,
};
export const RARE_NAMES = {
  a: ['Gloom', 'Dirge', 'Sorrow', 'Pale', 'Wraith', 'Cinder', 'Hollow', 'Mourn', 'Ashen', 'Veil', 'Rue', 'Thorn'],
  b: ['bite', 'wrought', 'song', 'fall', 'ward', 'mark', 'bane', 'weep', 'touch', 'brand', 'keep', 'shroud'],
};
export const POTION_ITEMS = { hp: { id: 'hp', name: 'Sanguine Draught', color: '#d23a3a' }, mana: { id: 'mana', name: 'Pale Elixir', color: '#4d8bff' } };
export const BAG_SIZE = 24;
