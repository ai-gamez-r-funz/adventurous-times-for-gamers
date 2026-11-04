// Game: the headless, deterministic-given-seed simulation. Owns player, chamber, progression and persistence.
// No THREE / DOM imports. The renderer, HUD and audio subscribe to `game.events`.
import { RNG, Emitter, deepClone } from '../core/util.js';
import { CLASSES, SKILLS, MAX_LEVEL, xpToNext } from '../data/classes.js';
import { CHAMBERS } from '../data/chambers.js';
import { BASES, UNIQUES } from '../data/items.js';
import { createPlayer } from './actors.js';
import { handleCommand, updatePlayer } from './player.js';
import { Chamber } from './world.js';
import { computeStats } from './stats.js';
import * as Inv from './inventory.js';
import { defaultProgress, migrate, SAVE_VERSION } from './save.js';
import { uid } from '../core/util.js';

export class Game {
  constructor({ classId = 'oathbound', seed = 1, save = null, storage = null, fade = true } = {}) {
    this.rng = new RNG(seed);
    this.seed = seed;
    this.events = new Emitter();
    this.storage = storage;
    this.fade = fade;
    this.walkPush = true; // main turns this off for the mouse scheme (blocks are pushed by lock-on + click instead)
    this.time = 0; this.idc = 1; this.dirty = false; this.transition = null; this.pendingVictory = 0; this.deadT = 0; this.over = false;
    const s = save ? migrate(save) : null;
    this.classId = s?.classId ?? classId;
    this.progress = s ? { ...defaultProgress(), ...s.progress } : defaultProgress();
    this.inv = s ? s.inv : this.starterInventory(this.classId);
    this.player = createPlayer(this, this.classId, 0, 0, 0);
    this.player.intent = { kind: 'none', dir: { x: 0, z: 0 } };
    this.player.buffer = null;
    this.player.level = s?.player.level ?? 1;
    this.player.xp = s?.player.xp ?? 0;
    this.recomputeStats();
    this.player.hp = s?.player.hp ?? this.stats.maxHp;
    this.player.mana = s?.player.mana ?? this.stats.maxMana;
    if (s) { this.player.hp = this.stats.maxHp; this.player.mana = this.stats.maxMana; }
    this.on('boss', (e) => { if (e.kind === 'dead') this.pendingVictory = 4.5; });
    const cp = this.progress.checkpoint;
    this.chamber = null;
    this.enterChamber(cp.chamber, cp.spawn, { silent: true });
    if (!s) this.emit('toast', { text: 'Emberhollow awaits.', kind: 'info' });
  }

  get grid() { return this.chamber.grid; }
  emit(type, payload) { this.events.emit(type, payload); }
  on(type, fn) { return this.events.on(type, fn); }
  nextId(p = 'x') { return `${p}${this.idc++}`; }
  markDirty() { this.dirty = true; }

  // ------------------------------------------------------------ setup helpers
  starterInventory(classId) {
    let inv = Inv.emptyInventory();
    const c = CLASSES[classId];
    for (const [slot, baseId] of Object.entries(c.start)) inv.equip[slot] = { uid: uid('i'), baseId, rarity: 'common', ilvl: 1, name: BASES[baseId].name, affixes: [] };
    return inv;
  }
  recomputeStats() {
    const prev = this.stats;
    this.stats = computeStats(this.classId, this.player.level, this.inv.equip);
    if (prev) {
      this.player.hp = Math.min(this.player.hp, this.stats.maxHp);
      this.player.mana = Math.min(this.player.mana, this.stats.maxMana);
    }
  }
  chamberProgress(id = this.chamber?.id) {
    const c = (this.progress.chambers[id] ??= { visited: false, killed: [], opened: [], broken: [], loot: [], explored: '' });
    return c;
  }

  // ------------------------------------------------------------ chambers
  enterChamber(id, spawnId, { silent = false } = {}) {
    const def = CHAMBERS[id];
    if (!def) throw new Error(`unknown chamber ${id}`);
    const prev = this.chamber;
    if (prev) prev.persist(this.chamberProgress(prev.id));
    this.chamber = new Chamber(this, def);
    this.chamberProgress(id);
    this.chamber.persist(this.chamberProgress(id));
    const p = this.player;
    let sp = this.chamber.spawns[spawnId];
    if (!sp && spawnId?.startsWith('way:')) {
      const w = this.chamber.props.get(spawnId.slice(4));
      const free = w && this.chamber.grid.nearestFree(w.cx, w.cz + 1, 3);
      if (free) sp = { x: free[0] + 0.5, z: free[1] + 0.5, face: 0 };
    }
    sp ??= Object.values(this.chamber.spawns)[0];
    p.x = sp.x; p.z = sp.z; p.face = sp.face; p.vx = p.vz = 0; p.action = null; p.state = 'idle'; p.intent = { kind: 'none', dir: { x: 0, z: 0 } }; p.buffer = null;
    this.chamber.markExplored();
    if (!silent) this.emit('chamber', { id, prev: prev?.id ?? null, def });
    else this.emit('chamber', { id, prev: null, def, initial: true });
    this.progress.visitedOnce ??= {};
    return this.chamber;
  }
  beginTransition(to, spawn) {
    if (this.transition) return;
    if (!this.fade) { this.enterChamber(to, spawn); this.save('chamber'); return; }
    this.transition = { to, spawn, t: 0, swapped: false };
    this.emit('transition', { phase: 'out', to });
  }

  // ------------------------------------------------------------ main step
  step(dt, cmds = []) {
    if (this.over) return;
    if (this.transition) {
      const tr = this.transition; tr.t += dt;
      if (!tr.swapped && tr.t >= 0.35) { tr.swapped = true; this.enterChamber(tr.to, tr.spawn); this.emit('transition', { phase: 'in', to: tr.to }); this.save('chamber'); }
      if (tr.t >= 0.75) this.transition = null;
      return;
    }
    this.time += dt;
    this.progress.stats.time += dt;
    const p = this.player;
    for (const c of cmds) handleCommand(this, p, c);
    if (p.dead) { this.deadT += dt; p.deadT += dt; }
    updatePlayer(this, p, dt);
    this.chamber.update(dt);
    if (this.pendingVictory > 0) { this.pendingVictory -= dt; if (this.pendingVictory <= 0) { this.progress.victory = true; this.emit('victory', {}); this.save('victory'); } }
  }

  // ------------------------------------------------------------ progression
  grantXp(n) {
    const p = this.player;
    if (p.level >= MAX_LEVEL) return;
    p.xp += n;
    this.emit('xp', { amount: n });
    while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      this.recomputeStats();
      p.hp = this.stats.maxHp; p.mana = this.stats.maxMana;
      const unlocked = CLASSES[this.classId].skills.map((s) => SKILLS[s]).filter((s) => s.unlock === p.level);
      this.emit('levelup', { level: p.level, unlocked });
      this.emit('toast', { text: `Level ${p.level}${unlocked.length ? ` — ${unlocked.map((s) => s.name).join(', ')} unlocked` : ''}`, kind: 'good' });
      this.save('level');
    }
    if (p.level >= MAX_LEVEL) p.xp = 0;
  }

  // ------------------------------------------------------------ inventory glue
  setInv(res) {
    if (!res.ok) { this.emit('denied', { reason: res.reason }); this.emit('toast', { text: cap(res.reason), kind: 'warn' }); return false; }
    this.inv = res.inv; this.recomputeStats(); this.markDirty(); this.emit('inventory', {}); return true;
  }
  equip(index) {
    const r = Inv.equipFromBag(this.inv, index, this.classId);
    if (this.setInv(r)) { this.emit('equip', { slot: r.slot }); return true; }
    return false;
  }
  unequip(slot) { return this.setInv(Inv.unequip(this.inv, slot)); }
  moveItem(from, to) { return this.setInv(Inv.moveBag(this.inv, from, to)); }
  dropItem(index) {
    const r = Inv.dropFromBag(this.inv, index);
    if (!r.ok) return this.setInv(r);
    this.inv = r.inv; this.recomputeStats();
    const p = this.player;
    this.chamber.loot.push({ id: this.nextId('l'), kind: 'item', item: r.dropped, x: p.x + Math.sin(p.face) * 0.8, z: p.z + Math.cos(p.face) * 0.8, age: 0 });
    this.emit('inventory', {}); this.markDirty();
    return true;
  }
  collectLoot(id) {
    const ch = this.chamber;
    const i = ch.loot.findIndex((l) => l.id === id);
    if (i < 0) return false;
    const l = ch.loot[i];
    let res;
    if (l.kind === 'gold') res = Inv.addGold(this.inv, l.amount);
    else if (l.kind === 'potion') { if ((this.inv.potions[l.potion] ?? 0) >= 9) return false; res = Inv.addPotion(this.inv, l.potion); }
    else {
      // auto-equip when the slot is empty and the class can use it
      const slot = BASES[l.item.baseId].slot;
      if (!this.inv.equip[slot] && Inv.canEquip(l.item, this.classId).ok) {
        const add = Inv.addToBag(this.inv, l.item);
        if (add.ok) { const eq = Inv.equipFromBag(add.inv, add.index, this.classId); if (eq.ok) { res = eq; this.emit('toast', { text: `Equipped ${l.item.name}`, kind: 'info' }); } }
      }
      res ??= Inv.addToBag(this.inv, l.item);
      if (!res.ok) { this.emit('toast', { text: 'Your pack is full.', kind: 'warn' }); this.emit('denied', { reason: 'bag full' }); return false; }
      if (l.item.unique && !this.progress.uniques.includes(l.item.unique)) this.progress.uniques.push(l.item.unique);
    }
    ch.loot.splice(i, 1);
    this.inv = res.inv; this.recomputeStats(); this.markDirty();
    this.emit('pickup', { loot: l });
    this.emit('inventory', {});
    return true;
  }

  // ------------------------------------------------------------ waystones, death, respawn
  restAtWaystone(chamberId, prop) {
    const p = this.player;
    const first = this.progress.checkpoint.spawn !== `way:${prop.id}` || this.progress.checkpoint.chamber !== chamberId;
    this.progress.checkpoint = { chamber: chamberId, spawn: `way:${prop.id}` };
    p.hp = this.stats.maxHp; p.mana = this.stats.maxMana;
    if (this.inv.potions.hp < 2) this.inv = { ...this.inv, potions: { ...this.inv.potions, hp: 2 } };
    this.emit('rest', { prop, first });
    this.emit('toast', { text: first ? 'Waystone attuned. You will return here.' : 'You rest by the waystone.', kind: 'good' });
    this.save('waystone');
  }
  onPlayerDeath() {
    this.progress.stats.deaths++;
    this.deadT = 0;
    this.emit('playerDeath', {});
  }
  respawn() {
    const p = this.player;
    p.dead = false; p.hp = this.stats.maxHp; p.mana = this.stats.maxMana; p.state = 'idle'; p.status = {}; p.action = null; p.vx = p.vz = 0; p.deadT = 0; p.iframes = false;
    const cp = this.progress.checkpoint;
    this.enterChamber(cp.chamber, cp.spawn);
    this.emit('respawn', {});
  }

  // ------------------------------------------------------------ persistence
  serialize() {
    this.chamber.persist(this.chamberProgress());
    const p = this.player;
    return deepClone({ version: SAVE_VERSION, classId: this.classId, seed: this.seed, player: { level: p.level, xp: p.xp, hp: p.hp, mana: p.mana }, inv: this.inv, progress: this.progress, savedAt: Date.now() });
  }
  save(reason = 'manual') {
    this.dirty = false;
    if (!this.storage) return false;
    const ok = this.storage.save(this.serialize());
    this.emit('saved', { reason, ok });
    return ok;
  }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export { UNIQUES };
