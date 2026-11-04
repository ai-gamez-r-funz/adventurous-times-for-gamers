// Authoritative combat: contact shapes, damage pipeline, projectiles, hazards, statuses.
// Visuals/audio consume the events this emits; nothing here reads render state.
import { angleDiff, dirOf, faceOf, clamp } from '../core/util.js';
import { ELITE, enemyScale } from '../data/enemies.js';
import { rollEnemyDrops } from './loot.js';

// ---------------------------------------------------------------- shape tests
export function inArc(ox, oz, face, range, arc, tx, tz, tr) {
  const dx = tx - ox, dz = tz - oz;
  const d = Math.hypot(dx, dz);
  if (d > range + tr) return false;
  if (d < tr + 0.05) return true;
  const ang = Math.abs(angleDiff(face, faceOf(dx, dz)));
  const allow = Math.asin(Math.min(1, tr / d));
  return ang <= arc / 2 + allow;
}
export function inCircle(cx, cz, r, tx, tz, tr) { return Math.hypot(tx - cx, tz - cz) <= r + tr; }
export function inRing(cx, cz, inner, outer, tx, tz, tr) { const d = Math.hypot(tx - cx, tz - cz); return d + tr >= inner && d - tr <= outer; }
export function inLine(ox, oz, face, length, width, tx, tz, tr) {
  const d = dirOf(face);
  const rx = tx - ox, rz = tz - oz;
  const t = clamp(rx * d.x + rz * d.z, 0, length);
  const px = ox + d.x * t, pz = oz + d.z * t;
  return Math.hypot(tx - px, tz - pz) <= width / 2 + tr;
}

export function shapeHits(shape, o, tx, tz, tr) {
  switch (shape.type) {
    case 'arc': return inArc(o.x, o.z, o.face, shape.range, shape.arc, tx, tz, tr);
    case 'circle': {
      const d = dirOf(o.face), off = shape.offset ?? 0;
      return inCircle(o.x + d.x * off, o.z + d.z * off, shape.radius, tx, tz, tr);
    }
    case 'line': return inLine(o.x, o.z, o.face, shape.length, shape.width, tx, tz, tr);
    case 'ring': return inRing(o.x, o.z, shape.inner, shape.radius, tx, tz, tr);
    default: return false;
  }
}

// ---------------------------------------------------------------- targets
export function targetsFor(game, attacker) {
  const ch = game.chamber;
  if (attacker.team === 'player') {
    const out = [];
    for (const e of ch.enemies) if (!e.dead && !e.spawnT) out.push(e);
    for (const p of ch.hurtProps()) out.push(p);
    return out;
  }
  return game.player.dead ? [] : [game.player];
}

export const isArmored = (a) => {
  const m = a.action?.move;
  if (!m?.armor) return false;
  return (m.armor === 'startup' && a.action.phase !== 'recovery') || (m.armor === 'active' && a.action.phase === 'active') || m.armor === 'all';
};

// ---------------------------------------------------------------- damage
function mitigate(amount, armor, level) { return Math.max(1, amount * (1 - armor / (armor + 60 + 8 * level))); }

export function computeDamage(game, attacker, move, target, mult = 1) {
  const rng = game.rng;
  let amount, crit = false;
  if (attacker.kind === 'player') {
    const st = game.stats;
    amount = rng.range(st.dmgMin, st.dmgMax) * move.damage * mult;
    if (rng.chance(st.crit / 100)) { amount *= st.critMult; crit = true; }
    const armor = (target.def?.armor ?? 0) * (target.elite === 'bulwark' ? 2 : 1);
    amount = mitigate(amount, armor, game.player.level);
  } else {
    const lv = attacker.level;
    amount = attacker.def.damage * move.damage * enemyScale(lv) * (attacker.elite ? ELITE.damage : 1) * rng.range(0.92, 1.08) * mult;
    amount = mitigate(amount, game.stats.armor, lv);
  }
  return { amount: Math.max(1, Math.round(amount)), crit };
}

export function applyStatus(t, status) {
  if (!status) return;
  if (status.slow) t.status.slow = { t: status.slow.t, mag: status.slow.mag };
  if (status.stun) { t.status.stun = Math.max(t.status.stun ?? 0, status.stun); if (!t.dead) { beginStagger(t, status.stun); } }
}

export function beginStagger(t, dur) {
  if (t.dead) return;
  cancelAction(t.game, t);
  t.state = 'stagger'; t.staggerT = dur; t.t = 0;
}

/** Cancel an in-flight action (interrupt/stagger/death): cleans up owned hazards and tokens. */
export function cancelAction(game, a) {
  if (!a.action) return;
  game.chamber?.cancelHazardsOf(a.id, a.action.id);
  if (a.ai) game.chamber?.releaseToken(a);
  a.action = null;
  if (a.state === 'action') a.state = 'idle';
}

/**
 * Resolve one contact. `hit` = { move, actionId, mult, knock, kx, kz }.
 * Applies each (actionId,target) once; callers pass the dedupe set.
 */
export function resolveHit(game, attacker, target, hit) {
  const move = hit.move;
  if (target.prop) { game.chamber.hurtProp(target, attacker, hit); return true; }
  if (target.dead || target.spawnT > 0) return false;
  if (target.invuln) return false;
  if (target.kind === 'player' && target.iframes) return false;
  const { amount, crit } = computeDamage(game, attacker, move, target, hit.mult ?? 1);
  let dmg = amount;
  // boss phase clamp: cannot cross a phase boundary until the transition plays
  let phaseHold = false;
  if (target.def?.phases && !target.ai.pendingPhase) {
    const next = target.def.phases[target.ai.phase + 1];
    if (next) {
      const floorHp = next.from * target.maxHp;
      if (target.hp - dmg <= floorHp) { dmg = Math.max(0, target.hp - floorHp); phaseHold = true; target.ai.pendingPhase = target.ai.phase + 1; }
    }
  }
  target.hp = Math.max(0, target.hp - dmg);
  target.hurtT = 0.2;
  const armored = isArmored(target);
  let poiseBreak = false;
  const kx = hit.kx ?? (target.x - attacker.x), kz = hit.kz ?? (target.z - attacker.z);
  const kl = Math.hypot(kx, kz) || 1;
  if (target.kind === 'enemy') {
    target.ai.alerted = true;
    target.ai.hurtAt = game.time;
    target.lastHitBy = attacker.id;
    if (!target.def.boss && !armored) {
      target.poise -= (move.poise ?? 0) * (target.elite === 'bulwark' ? 0.5 : 1);
      if (target.poise <= 0) { poiseBreak = true; target.poise = target.maxPoise; if (target.hp > 0) beginStagger(target, 0.55); }
    }
    if (!armored && move.knockback) { const w = target.def.boss ? 0.15 : target.def.tags.includes('heavy') ? 0.45 : 1; target.vx += (kx / kl) * move.knockback * 4.2 * w; target.vz += (kz / kl) * move.knockback * 4.2 * w; }
    if (target.def.boss && target.ai.pendingPhase !== null && target.hp > 0) game.chamber.noteBossHit?.(target);
  } else {
    // player: knockback pushes, only heavy hits flinch
    target.vx += (kx / kl) * (move.knockback ?? 0) * 2.8; target.vz += (kz / kl) * (move.knockback ?? 0) * 2.8;
    if ((move.knockback ?? 0) >= 2.4 && target.flinchImmune <= 0 && target.state !== 'roll') { beginStagger(target, 0.32); target.flinchImmune = 1.2; poiseBreak = true; }
  }
  applyStatus(target, hit.status ?? move.status);
  // attacker bonuses
  if (attacker.kind === 'player') {
    const st = game.stats;
    if (st.leech) attacker.hp = Math.min(game.stats.maxHp, attacker.hp + st.leech);
    if (hit.gain) attacker.mana = Math.min(st.maxMana, attacker.mana + hit.gain);
  }
  const killed = target.hp <= 0;
  game.emit('hit', { attacker, target, amount: dmg, crit, x: target.x, z: target.z, move, killed, poiseBreak, phaseHold, armored });
  if (killed) kill(game, target, attacker);
  return true;
}

export function kill(game, a, killer) {
  if (a.dead) return;
  a.dead = true; a.hp = 0; a.state = 'dead'; a.deadT = 0;
  cancelAction(game, a);
  game.emit('death', { actor: a, killer });
  if (a.kind === 'player') { game.onPlayerDeath(); return; }
  game.chamber.cancelHazardsOf(a.id, null);
  game.chamber.releaseToken(a);
  game.progress.stats.kills++;
  game.progress.bestiary[a.defId] = (game.progress.bestiary[a.defId] ?? 0) + 1;
  game.grantXp(Math.round(a.def.xp * (a.elite ? ELITE.xp : 1) * (1 + 0.1 * (a.level - 1))));
  const drops = rollEnemyDrops(game.rng, a.def, { elite: !!a.elite, level: a.level, classId: game.classId });
  game.chamber.spawnDrops(drops, a.x, a.z);
  if (a.persistId) game.chamberProgress().killed.push(a.persistId);
  if (a.elite === 'vengeful') game.chamber.spawnHazard({ owner: a, pattern: 'circle', x: a.x, z: a.z, r: 2.4, telegraph: 0.9, damage: 1.2, poise: 30, knockback: 2.2, actionId: `${a.id}:death` , persistOnDeath: true });
  game.chamber.onEnemyDeath(a);
}

// ---------------------------------------------------------------- projectiles
export function spawnProjectile(game, owner, move, x, z, face, extra = {}) {
  const sh = move.shape;
  const d = dirOf(face);
  const speed = sh.speed;
  const p = {
    id: game.nextId('pr'), owner: owner.id, team: owner.team, x, z, vx: d.x * speed, vz: d.z * speed, face,
    r: sh.radius, life: sh.life, move, hitSet: new Set(), pierce: sh.pierce ?? 0, color: sh.color ?? (owner.team === 'player' ? 0xffa040 : 0xd84a2a), light: !!sh.light,
    kind: extra.kind ?? (owner.kind === 'player' ? 'bolt' : owner.def?.id === 'archer' ? 'arrow' : 'orb'), dead: false, actionId: extra.actionId, mult: extra.mult ?? 1, gain: extra.gain,
  };
  game.chamber.projectiles.push(p);
  game.emit('projectile', { proj: p });
  return p;
}

export function updateProjectiles(game, dt) {
  const ch = game.chamber;
  for (const p of ch.projectiles) {
    if (p.dead) continue;
    const owner = p.owner === game.player.id ? game.player : ch.byId(p.owner);
    const steps = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vz) * dt) / 0.25));
    const sdt = dt / steps;
    for (let s = 0; s < steps && !p.dead; s++) {
      p.x += p.vx * sdt; p.z += p.vz * sdt;
      p.life -= sdt;
      if (game.grid.pointBlocked(p.x, p.z)) { p.dead = true; game.emit('projectileEnd', { proj: p, x: p.x, z: p.z, wall: true }); ch.onProjectileWall?.(p); break; }
      // hit targets
      const attackerLike = owner ?? { kind: p.team === 'player' ? 'player' : 'enemy', team: p.team, id: p.owner, x: p.x, z: p.z, level: ch.def.level, def: { damage: 10 }, status: {} };
      const targets = p.team === 'player' ? [...ch.enemies.filter((e) => !e.dead && !e.spawnT), ...ch.hurtProps()] : (game.player.dead ? [] : [game.player]);
      for (const t of targets) {
        if (p.hitSet.has(t.id)) continue;
        if (Math.hypot(t.x - p.x, t.z - p.z) > p.r + t.radius) continue;
        if (t.kind === 'player' && (t.iframes || t.invuln)) continue; // dodged
        p.hitSet.add(t.id);
        resolveHit(game, attackerLike, t, { move: p.move, mult: p.mult, kx: p.vx, kz: p.vz, gain: p.gain });
        if (p.pierce-- <= 0) { p.dead = true; game.emit('projectileEnd', { proj: p, x: p.x, z: p.z, wall: false, hit: t }); break; }
      }
      if (p.life <= 0 && !p.dead) { p.dead = true; game.emit('projectileEnd', { proj: p, x: p.x, z: p.z, expired: true }); }
    }
  }
  ch.projectiles = ch.projectiles.filter((p) => !p.dead);
}

// ---------------------------------------------------------------- hazards (telegraphed ground contact volumes)
export function updateHazards(game, dt) {
  const ch = game.chamber;
  for (const h of ch.hazards) {
    h.t += dt;
    const owner = h.ownerId === game.player.id ? game.player : ch.byId(h.ownerId);
    if (h.track && h.t < h.lockT && !game.player.dead) { h.x += (game.player.x - h.x) * Math.min(1, dt * 9); h.z += (game.player.z - h.z) * Math.min(1, dt * 9); }
    if (h.state === 'telegraph' && h.t >= h.telegraph) { h.state = 'active'; game.emit('hazardActive', { hazard: h }); }
    if (h.state === 'active') {
      if (!game.player.dead && !h.hitSet.has('player')) {
        const hit = h.pattern === 'ring' ? inRing(h.x, h.z, h.inner, h.r, game.player.x, game.player.z, game.player.radius) : inCircle(h.x, h.z, h.r, game.player.x, game.player.z, game.player.radius);
        if (hit && !game.player.iframes) {
          h.hitSet.add('player');
          const attacker = owner ?? { kind: 'enemy', team: 'enemy', id: h.ownerId, level: ch.def.level, def: { damage: 12 }, x: h.x, z: h.z };
          resolveHit(game, attacker, game.player, { move: { damage: h.damage, poise: h.poise, knockback: h.knockback, id: h.moveId ?? 'hazard' }, kx: game.player.x - h.x, kz: game.player.z - h.z });
        }
      }
      if (h.t >= h.telegraph + h.activeDur) h.state = 'done';
    }
  }
  const done = ch.hazards.filter((h) => h.state === 'done');
  for (const h of done) game.emit('hazardEnd', { hazard: h });
  ch.hazards = ch.hazards.filter((h) => h.state !== 'done');
}

export const hasStatus = (a, k) => (a.status[k] ?? 0) > 0 || !!a.status[k]?.t;
