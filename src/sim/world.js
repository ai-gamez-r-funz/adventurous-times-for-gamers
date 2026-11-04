// Chamber runtime: builds live state from authored chamber data + persisted progress.
// Owns enemies, projectiles, hazards, loot, props, gates, encounters, puzzles and interaction.
import { buildGrid } from './grid.js';
import { createEnemy } from './actors.js';
import { updateEnemy } from './ai.js';
import { updateProjectiles, updateHazards } from './combat.js';
import { PUZZLES } from './puzzles.js';
import { rollChest } from './loot.js';
import { ENEMIES, ELITE } from '../data/enemies.js';
import { RELICS } from '../data/lore.js';
import { dirOf } from '../core/util.js';

const INTERACT_RANGE = { chest: 1.9, lore: 1.9, waystone: 2.1, altar: 2.0, brazier: 2.1, pedestal: 2.0, resetrune: 1.9, loot: 1.4 };

export class Chamber {
  constructor(game, def) {
    this.game = game; this.def = def; this.id = def.id;
    this.grid = buildGrid(def);
    this.enemies = []; this.projectiles = []; this.hazards = []; this.loot = [];
    this.props = new Map(); this.gates = new Map(); this.doors = []; this.encounters = []; this.puzzles = []; this.spawns = {};
    this.tokens = new Set(); this.time = 0; this.exploreT = 0; this.doorToastT = 0;
    const prog = game.chamberProgress(def.id);
    this.explored = new Uint8Array(this.grid.w * this.grid.h);
    if (prog.explored && prog.explored.length === this.explored.length) for (let i = 0; i < prog.explored.length; i++) this.explored[i] = prog.explored[i] === '1' ? 1 : 0;
    this.build(prog);
  }

  get flags() { return this.game.progress.flags; }
  byId(id) {
    if (id === 'player') return this.game.player;
    return this.enemies.find((e) => e.id === id) ?? this.hurtPropById(id);
  }
  hurtPropById(id) { const p = this.props.get(id); return p && this.isHurtable(p) ? p : null; }
  isShown(e) {
    if (!e.hidden) return true;
    return !!(this.flags[`rev:${e.id}`] || (e.hiddenUntil && this.flags[e.hiddenUntil]) || (e.reqFlag && this.flags[e.reqFlag]));
  }

  // ------------------------------------------------------------ build
  build(prog) {
    const g = this.grid, def = this.def;
    for (const e of def.entities) {
      const base = { id: e.id, t: e.t, def: e, cx: e.x, cz: e.z, x: (e.x ?? 0) + 0.5, z: (e.z ?? 0) + 0.5, radius: 0.5, prop: true };
      switch (e.t) {
        case 'spawn': this.spawns[e.id] = { x: e.x + 0.5, z: e.z + 0.5, face: e.face ?? 0 }; break;
        case 'door': {
          const cells = [];
          for (let i = 0; i < e.w; i++) cells.push(e.axis === 'x' ? [e.x + i, e.z] : [e.x, e.z + i]);
          this.doors.push({ id: e.id, def: e, cells, x: cells[0][0] + (e.axis === 'x' ? e.w / 2 : 0.5), z: cells[0][1] + (e.axis === 'z' ? e.w / 2 : 0.5) });
          break;
        }
        case 'gate': {
          const gate = { id: e.id, t: 'gate', def: e, cells: e.cells, locks: new Set(e.closed ? ['base'] : []), anim: e.closed ? 1 : 0, style: e.style ?? 'portcullis' };
          this.gates.set(e.id, gate);
          if (gate.locks.size) for (const [x, z] of gate.cells) g.addDyn(x, z);
          break;
        }
        case 'enemy':
          if (!prog.killed.includes(e.id)) this.spawnEnemy(e.def, e.x, e.z, { persistId: e.id, id: `${this.id}:${e.id}`, sleep: true, elite: e.elite ? this.pickElite() : null, face: Math.random() * 6.28 });
          break;
        case 'chest': this.props.set(e.id, { ...base, opened: prog.opened.includes(e.id), hidden: !!e.hidden && !this.isShown(e), shownAnim: 0 }); g.solid[g.idx(e.x, e.z)] = 1; break;
        case 'lore': this.props.set(e.id, { ...base }); break;
        case 'waystone': this.props.set(e.id, { ...base }); break;
        case 'altar': this.props.set(e.id, { ...base, hidden: true }); break;
        case 'urn': { const broken = prog.broken.includes(e.id); this.props.set(e.id, { ...base, radius: 0.42, broken, hp: 1 }); if (!broken) g.addDyn(e.x, e.z); break; }
        case 'cracked': { const broken = prog.broken.includes(e.id); this.props.set(e.id, { ...base, broken, hp: e.hp ?? 3, maxHp: e.hp ?? 3, hitFlash: 0 }); if (!broken) g.addDyn(e.x, e.z); break; }
        case 'brazier': this.props.set(e.id, { ...base, lit: false, radius: 0.45, glyph: e.glyph, hitCd: 0 }); break;
        case 'glyph': this.props.set(e.id, { ...base, lit: 0, err: 0, idx: e.idx }); break;
        case 'block': this.props.set(e.id, { ...base, homeCx: e.x, homeCz: e.z, slideT: 0, slideDur: 0.24, fromX: base.x, fromZ: base.z }); g.addDyn(e.x, e.z); break;
        case 'plate': this.props.set(e.id, { ...base, pressed: false }); break;
        case 'pedestal': case 'resetrune': case 'socket': case 'flame': this.props.set(e.id, { ...base }); break;
        default: break;
      }
    }
    // puzzles after props exist
    for (const e of def.entities) {
      if (e.t !== 'puzzle') continue;
      const pz = new PUZZLES[e.kind](this, e);
      this.puzzles.push(pz);
      if (e.onSolved?.flag && this.flags[e.onSolved.flag]) { this.applySolved(pz, true); }
      if (pz.check) pz.check();
    }
    for (const e of def.entities) {
      if (e.t !== 'encounter') continue;
      const cleared = !!this.flags[`${e.id}:cleared`];
      this.encounters.push({ id: e.id, def: e, state: cleared ? 'cleared' : 'idle', wave: -1, waveT: 0, alive: [], boss: !!e.boss });
    }
    // restore persisted loot
    for (const l of prog.loot ?? []) this.loot.push({ ...l, age: 5 });
  }

  pickElite() { return this.game.rng.pick(ELITE.affixes); }

  spawnEnemy(defId, cx, cz, opts = {}) {
    const def = ENEMIES[defId];
    const e = createEnemy(this.game, def, cx + 0.5, cz + 0.5, { level: this.def.level, ...opts });
    this.enemies.push(e);
    return e;
  }

  // ------------------------------------------------------------ gates
  setGateLock(id, reason, on) {
    const gate = this.gates.get(id);
    if (!gate) return;
    const was = gate.locks.size > 0;
    if (on) gate.locks.add(reason); else gate.locks.delete(reason);
    const now = gate.locks.size > 0;
    if (was !== now) {
      for (const [x, z] of gate.cells) { if (now) this.grid.addDyn(x, z); else this.grid.removeDyn(x, z); }
      this.game.emit('gate', { id, closed: now, gate });
    }
  }
  gateClosed(id) { return (this.gates.get(id)?.locks.size ?? 0) > 0; }

  // ------------------------------------------------------------ puzzles
  applySolved(pz, restore) {
    const s = pz.def.onSolved ?? {};
    if (restore) pz.restoreSolved(); 
    for (const gid of s.open ?? []) this.setGateLock(gid, 'base', false);
    for (const r of s.reveal ?? []) this.flags[`rev:${r}`] = true;
    if (pz.check) pz.check();
  }
  solvePuzzle(pz) {
    if (pz.solved) return;
    pz.solved = true;
    const s = pz.def.onSolved ?? {};
    if (s.flag) this.flags[s.flag] = true;
    this.applySolved(pz, false);
    this.game.emit('puzzle', { id: pz.id, kind: pz.def.kind, event: 'solved' });
    if (s.toast) this.game.emit('toast', { text: s.toast, kind: 'good' });
    this.game.progress.stats.puzzles++;
    this.game.save('puzzle');
  }
  puzzleOf(id) { return this.puzzles.find((p) => p.id === id); }

  // ------------------------------------------------------------ props that can be hurt
  isHurtable(p) {
    if (p.t === 'urn' || p.t === 'cracked') return !p.broken;
    if (p.t === 'brazier') { const pz = this.puzzleOf(p.def.puzzle); return !!pz && !pz.solved && !p.lit; }
    return false;
  }
  hurtProps() {
    const out = [];
    for (const p of this.props.values()) if (this.isHurtable(p)) out.push(p);
    return out;
  }
  hurtProp(p, attacker) {
    if (attacker.team !== 'player') return;
    if (p.t === 'urn') {
      p.broken = true; this.grid.removeDyn(p.cx, p.cz);
      this.game.chamberProgress().broken.push(p.id);
      this.game.emit('break', { prop: p, kind: 'urn' });
      const r = this.game.rng;
      this.spawnDrops({ gold: r.chance(0.7) ? r.int(1, 5 + this.def.level * 2) : 0, potions: r.chance(0.07) ? ['hp'] : [], items: r.chance(0.04) ? [] : [] }, p.x, p.z);
    } else if (p.t === 'cracked') {
      p.hp--; p.hitFlash = 0.25;
      this.game.emit('break', { prop: p, kind: 'crack', hit: true });
      if (p.hp <= 0) {
        p.broken = true; this.grid.removeDyn(p.cx, p.cz);
        this.game.chamberProgress().broken.push(p.id);
        this.game.emit('break', { prop: p, kind: 'cracked' });
        this.game.emit('toast', { text: 'A hidden passage crumbles open.', kind: 'good' });
      }
    } else if (p.t === 'brazier') {
      if (p.hitCd > 0) return;
      p.hitCd = 0.5;
      this.puzzleOf(p.def.puzzle)?.light(p.id);
    }
  }

  // ------------------------------------------------------------ interaction
  interactables() {
    const out = [];
    for (const p of this.props.values()) if (this.canInteract(p)) out.push(p);
    for (const l of this.loot) if (l.kind === 'item') out.push(l);
    return out;
  }
  canInteract(p) {
    switch (p.t) {
      case 'chest': return !p.hidden && !p.opened;
      case 'lore': case 'waystone': return true;
      case 'altar': return this.isShown(p.def) && !this.game.progress.sigils.includes(p.def.sigil);
      case 'brazier': { const pz = this.puzzleOf(p.def.puzzle); return !!pz && !pz.solved && !p.lit; }
      case 'pedestal': { const pz = this.puzzleOf(p.def.puzzle); return !!pz && !pz.solved && pz.state !== 'showing'; }
      case 'resetrune': { const pz = this.puzzleOf(p.def.puzzle); return !!pz && !pz.solved; }
      default: return false;
    }
  }
  interactableById(id) {
    const p = this.props.get(id);
    if (p && this.canInteract(p)) return p;
    return this.loot.find((l) => l.id === id) ?? null;
  }
  nearestInteractable(from) {
    let best = null, bd = 1e9;
    for (const p of this.interactables()) {
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      const r = p.range ?? INTERACT_RANGE[p.t ?? 'loot'] ?? 1.9;
      if (d <= r + 0.4 && d < bd) { bd = d; best = p; }
    }
    return best;
  }
  rangeOf(p) { return INTERACT_RANGE[p.t ?? 'loot'] ?? 1.9; }
  interact(p) {
    const game = this.game, prog = game.progress;
    if (p.kind) { game.collectLoot(p.id); return; }
    switch (p.t) {
      case 'chest': {
        p.opened = true; prog.chambers[this.id].opened.push(p.id); prog.stats.chests++;
        const spec = p.def.loot;
        const drops = rollChest(game.rng, spec, game.classId);
        this.spawnDrops(drops, p.x, p.z + 0.2, { fan: true });
        if (p.def.relic && !prog.relics.includes(p.def.relic)) {
          prog.relics.push(p.def.relic);
          game.emit('relic', { id: p.def.relic, relic: RELICS[p.def.relic] });
          game.emit('toast', { text: `Relic found: ${RELICS[p.def.relic].name}`, kind: 'good' });
        }
        game.emit('chestOpen', { prop: p });
        game.save('chest');
        break;
      }
      case 'lore': {
        const id = p.def.lore;
        const first = !prog.lore.includes(id);
        if (first) { prog.lore.push(id); game.emit('toast', { text: 'Fragment added to the Codex.', kind: 'info' }); }
        game.emit('lore', { id, first });
        break;
      }
      case 'waystone': {
        game.restAtWaystone(this.id, p);
        break;
      }
      case 'altar': {
        const sg = p.def.sigil;
        if (!prog.sigils.includes(sg)) {
          prog.sigils.push(sg);
          game.emit('sigil', { id: sg });
          game.emit('toast', { text: `Sigil acquired. (${prog.sigils.length}/3)`, kind: 'good' });
          game.save('sigil');
        }
        break;
      }
      case 'brazier': this.puzzleOf(p.def.puzzle)?.light(p.id); break;
      case 'pedestal': this.puzzleOf(p.def.puzzle)?.start(); break;
      case 'resetrune': this.puzzleOf(p.def.puzzle)?.reset(); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ loot
  spawnDrops(drops, x, z, opts = {}) {
    const rng = this.game.rng;
    const place = () => {
      for (let i = 0; i < 12; i++) {
        const a = rng.range(0, Math.PI * 2), r = opts.fan ? rng.range(1.1, 1.8) : rng.range(0.3, 1.0);
        const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (!this.grid.circleBlocked(px, pz, 0.25)) return { x: px, z: pz };
      }
      return { x, z };
    };
    const add = (o) => { const pos = place(); const l = { id: this.game.nextId('l'), age: 0, ...pos, ...o }; this.loot.push(l); this.game.emit('loot', { loot: l }); };
    if (drops.gold > 0) add({ kind: 'gold', amount: drops.gold });
    for (const k of drops.potions) add({ kind: 'potion', potion: k });
    for (const it of drops.items) add({ kind: 'item', item: it });
  }

  // ------------------------------------------------------------ hazards
  spawnHazard(o) {
    const h = {
      id: this.game.nextId('hz'), ownerId: o.ownerId ?? o.owner?.id, pattern: o.pattern, x: o.x, z: o.z, r: o.r, inner: o.inner ?? 0,
      t: 0, telegraph: o.telegraph, activeDur: o.activeDur ?? 0.15, damage: o.damage, poise: o.poise ?? 20, knockback: o.knockback ?? 1.5,
      track: !!o.track, lockT: o.lockT ?? 0, state: 'telegraph', hitSet: new Set(), actionId: o.actionId ?? null, moveId: o.moveId, persistOnDeath: !!o.persistOnDeath, trap: !!o.trap,
    };
    this.hazards.push(h);
    this.game.emit('hazard', { hazard: h });
    return h;
  }
  spawnMoveHazards(a, move, act) {
    const sh = move.shape, p = this.game.player;
    const base = { owner: a, actionId: act.id, damage: move.damage, poise: move.poise, knockback: move.knockback, moveId: move.id };
    if (sh.pattern === 'target') this.spawnHazard({ ...base, pattern: 'circle', x: p.x, z: p.z, r: sh.radius, telegraph: act.startup, track: true, lockT: sh.lock * act.startup });
    else if (sh.pattern === 'triple') {
      for (let i = 0; i < 3; i++) {
        const tel = act.startup + i * (sh.stagger ?? 0.4);
        this.spawnHazard({ ...base, pattern: 'circle', x: p.x, z: p.z, r: sh.radius, telegraph: tel, track: true, lockT: sh.lock * tel });
      }
    } else if (sh.pattern === 'ring') this.spawnHazard({ ...base, pattern: 'ring', x: a.x, z: a.z, r: sh.radius, inner: sh.inner ?? 0, telegraph: act.startup, activeDur: 0.2 });
  }
  cancelHazardsOf(ownerId, actionId) {
    this.hazards = this.hazards.filter((h) => {
      if (h.ownerId !== ownerId) return true;
      if (actionId && h.actionId !== actionId) return true;
      if (!actionId && h.persistOnDeath) return true;
      this.game.emit('hazardEnd', { hazard: h, cancelled: true });
      return false;
    });
  }
  clearEnemyProjectiles() { for (const p of this.projectiles) if (p.team === 'enemy') { p.dead = true; this.game.emit('projectileEnd', { proj: p, x: p.x, z: p.z, expired: true }); } }

  // ------------------------------------------------------------ tokens & summons
  requestToken(e, cap, commit = false) {
    if (e.ai.token) return true;
    if (this.tokens.size >= cap) return false;
    if (commit) { this.tokens.add(e.id); e.ai.token = true; }
    return true;
  }
  releaseToken(e) { this.tokens.delete(e.id); if (e.ai) e.ai.token = false; }
  meleeCount() { return this.tokens.size; }
  addsAlive(owner) { return this.enemies.filter((e) => !e.dead && e.parentId === owner.id).length; }
  summon(owner, move) {
    const p = this.game.player, rng = this.game.rng;
    const { def, count } = move.adds;
    const room = (move.maxAdds ?? 2) - this.addsAlive(owner);
    for (let i = 0; i < Math.min(count, room); i++) {
      for (let tries = 0; tries < 30; tries++) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(4.5, 9);
        const x = owner.x + Math.sin(a) * r, z = owner.z + Math.cos(a) * r;
        if (this.grid.circleBlocked(x, z, 0.5) || Math.hypot(x - p.x, z - p.z) < 3) continue;
        const e = this.spawnEnemy(def, Math.floor(x), Math.floor(z), { spawnT: 1.1, group: owner.group });
        e.x = x; e.z = z; e.parentId = owner.id; e.ai.alerted = true;
        this.game.emit('spawn', { actor: e, summoned: true });
        break;
      }
    }
  }
  onEnemyDeath(a) {
    for (const enc of this.encounters) enc.alive = enc.alive.filter((id) => id !== a.id);
    if (a.def.boss) {
      this.game.emit('boss', { kind: 'dead', actor: a });
    }
  }

  // ------------------------------------------------------------ encounters
  updateEncounters(dt) {
    const p = this.game.player;
    for (const enc of this.encounters) {
      const d = enc.def;
      if (enc.state === 'idle') {
        const tr = d.trigger;
        if (!p.dead && p.x >= tr.x && p.x < tr.x + tr.w && p.z >= tr.z && p.z < tr.z + tr.h) this.startEncounter(enc);
      } else if (enc.state === 'active') {
        if (p.dead) continue;
        const aliveNow = this.enemies.filter((e) => !e.dead && e.group === `enc:${enc.id}`);
        if (enc.waveT > 0) {
          enc.waveT -= dt;
          if (enc.waveT <= 0) this.spawnWave(enc);
        } else if (aliveNow.length === 0) {
          if (enc.wave + 1 < d.waves.length) { enc.waveT = d.waves[enc.wave + 1].delay; this.game.emit('encounterWave', { id: enc.id, wave: enc.wave + 1, of: d.waves.length }); }
          else this.clearEncounter(enc);
        }
      }
    }
  }
  startEncounter(enc) {
    enc.state = 'active'; enc.wave = -1; enc.waveT = enc.def.waves[0].delay;
    for (const gid of enc.def.gates ?? []) this.setGateLock(gid, `enc:${enc.id}`, true);
    this.game.emit('encounterStart', { id: enc.id, boss: enc.boss });
  }
  spawnWave(enc) {
    enc.wave++;
    const w = enc.def.waves[enc.wave];
    for (const s of w.enemies) {
      const e = this.spawnEnemy(s.def, s.x, s.z, { group: `enc:${enc.id}`, spawnT: 0.9, elite: s.elite ? this.pickElite() : null });
      e.ai.alerted = true; enc.alive.push(e.id);
      this.game.emit('spawn', { actor: e, encounter: enc.id });
      if (e.def.boss) this.game.emit('boss', { kind: 'start', actor: e });
    }
  }
  clearEncounter(enc) {
    enc.state = 'cleared';
    const d = enc.def;
    this.flags[`${enc.id}:cleared`] = true;
    if (d.onClear?.flag) this.flags[d.onClear.flag] = true;
    for (const r of d.onClear?.reveal ?? []) this.flags[`rev:${r}`] = true;
    for (const gid of d.gates ?? []) this.setGateLock(gid, `enc:${enc.id}`, false);
    for (const p of this.props.values()) if (p.t === 'chest' && p.hidden && this.isShown(p.def)) { p.hidden = false; }
    if (d.onClear?.toast) this.game.emit('toast', { text: d.onClear.toast, kind: 'good' });
    this.game.emit('encounterClear', { id: enc.id, boss: enc.boss });
    this.game.progress.stats.encounters++;
    this.game.save('encounter');
  }

  // ------------------------------------------------------------ doors
  updateDoors(dt) {
    const p = this.game.player;
    this.doorToastT = Math.max(0, this.doorToastT - dt);
    if (p.dead || this.game.transition) return;
    const cx = Math.floor(p.x), cz = Math.floor(p.z);
    for (const d of this.doors) {
      if (!d.cells.some(([x, z]) => x === cx && z === cz)) continue;
      const lock = d.def.lock;
      if (lock?.sigils && !this.flags.sanctum_unsealed) {
        const n = this.game.progress.sigils.length;
        if (n >= lock.sigils) { this.flags.sanctum_unsealed = true; this.game.emit('unseal', { door: d }); this.game.emit('toast', { text: 'The seal remembers its own. The Sanctum opens.', kind: 'good' }); }
        else {
          if (this.doorToastT <= 0) { this.game.emit('toast', { text: `The Sanctum seal holds. Sigils: ${n}/${lock.sigils}`, kind: 'warn' }); this.doorToastT = 2.5; }
          const dd = dirOf(this.game.player.face);
          p.vx -= dd.x * 6; p.vz -= dd.z * 6;
          continue;
        }
      }
      this.game.beginTransition(d.def.to, d.def.spawn);
      return;
    }
  }

  // ------------------------------------------------------------ misc update
  update(dt) {
    this.time += dt;
    const g = this.game;
    for (const e of this.enemies) updateEnemy(g, e, dt);
    updateProjectiles(g, dt);
    updateHazards(g, dt);
    for (const pz of this.puzzles) pz.update(dt);
    for (const p of this.props.values()) { if (p.hitCd > 0) p.hitCd -= dt; if (p.hitFlash > 0) p.hitFlash -= dt; }
    // altar & chest reveal sync
    for (const p of this.props.values()) {
      if (p.t === 'altar') p.hidden = !this.isShown(p.def);
      if (p.t === 'chest' && p.hidden && this.isShown(p.def)) p.hidden = false;
    }
    this.updateEncounters(dt);
    this.updateDoors(dt);
    this.updateLoot(dt);
    this.separate();
    // cleanup
    const before = this.enemies.length;
    this.enemies = this.enemies.filter((e) => !(e.dead && e.deadT > 2.4));
    void before;
    // gate animation
    for (const gate of this.gates.values()) gate.anim += ((gate.locks.size ? 1 : 0) - gate.anim) * Math.min(1, dt * 5);
    // exploration
    this.exploreT -= dt;
    if (this.exploreT <= 0) { this.exploreT = 0.2; this.markExplored(); }
  }

  updateLoot(dt) {
    const g = this.game, p = g.player;
    for (const l of this.loot) l.age += dt;
    if (p.dead) return;
    for (const l of [...this.loot]) {
      if (l.kind === 'item') continue;
      if (l.age < 0.4) continue;
      const d = Math.hypot(l.x - p.x, l.z - p.z);
      if (d < 1.5) g.collectLoot(l.id);
    }
  }

  separate() {
    const p = this.game.player;
    const list = [p, ...this.enemies.filter((e) => !e.dead && !e.spawnT)];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.state === 'roll' || b.state === 'roll') continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = (a.radius + b.radius) * 0.92;
      if (d >= min || d === 0) continue;
      const push = (min - d);
      const wa = a.kind === 'player' ? 0.2 : (a.def?.boss ? 0.02 : 0.5), wb = b.kind === 'player' ? 0.2 : (b.def?.boss ? 0.02 : 0.5);
      const tot = wa + wb;
      const ra = this.grid.slide(a.x, a.z, -(dx / d) * push * (wa / tot), -(dz / d) * push * (wa / tot), a.radius);
      const rb = this.grid.slide(b.x, b.z, (dx / d) * push * (wb / tot), (dz / d) * push * (wb / tot), b.radius);
      a.x = ra.x; a.z = ra.z; b.x = rb.x; b.z = rb.z;
    }
  }

  markExplored() {
    const p = this.game.player, g = this.grid;
    const R = 8;
    for (let cz = Math.max(0, Math.floor(p.z - R)); cz <= Math.min(g.h - 1, Math.floor(p.z + R)); cz++) {
      for (let cx = Math.max(0, Math.floor(p.x - R)); cx <= Math.min(g.w - 1, Math.floor(p.x + R)); cx++) {
        const i = g.idx(cx, cz);
        if (this.explored[i]) continue;
        if (Math.hypot(cx + 0.5 - p.x, cz + 0.5 - p.z) > R) continue;
        if (g.floor[i] === 0 && !g.isWall(cx, cz)) continue;
        if (g.los(p.x, p.z, cx + 0.5, cz + 0.5)) this.explored[i] = 1;
      }
    }
  }

  /** Snapshot persisted bits into progress when leaving / saving. */
  persist(prog) {
    prog.visited = true;
    prog.explored = Array.from(this.explored, (v) => (v ? '1' : '0')).join('');
    prog.loot = this.loot.map((l) => ({ id: l.id, kind: l.kind, amount: l.amount, potion: l.potion, item: l.item, x: l.x, z: l.z }));
  }
}
