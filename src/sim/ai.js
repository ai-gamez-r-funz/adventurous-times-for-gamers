// Enemy AI: small state machine (idle / pursue / reposition / action / stagger / return / dead).
// Perception -> intent -> motion. The combat system owns timing; AI only chooses legal move ids.
import { dirOf, faceOf, lerpAngle, angleDiff, clamp } from '../core/util.js';
import { makeAction, updateAction, turnToward } from './actors.js';
import { cancelAction } from './combat.js';

const MELEE_TOKENS = 2;

export const slowMult = (a) => (a.status.slow ? 1 - a.status.slow.mag : 1);

export function tickStatus(a, dt) {
  if (a.status.slow) { a.status.slow.t -= dt; if (a.status.slow.t <= 0) delete a.status.slow; }
  if (a.status.stun) { a.status.stun -= dt; if (a.status.stun <= 0) delete a.status.stun; }
}

export function applyKnock(game, a, dt) {
  if (a.vx === 0 && a.vz === 0) return;
  const r = game.grid.slide(a.x, a.z, a.vx * dt, a.vz * dt, a.radius);
  a.x = r.x; a.z = r.z;
  const k = Math.exp(-9 * dt);
  a.vx *= k; a.vz *= k;
  if (Math.abs(a.vx) < 0.05 && Math.abs(a.vz) < 0.05) { a.vx = 0; a.vz = 0; }
}

/** Walk toward a point: straight if the sweep is clear, else follow an A* path. Returns true if moved. */
export function steerTo(game, a, tx, tz, speed, dt, stop = 0) {
  const ai = a.ai;
  const dx = tx - a.x, dz = tz - a.z;
  const d = Math.hypot(dx, dz);
  if (d <= stop) return false;
  let gx = tx, gz = tz;
  if (!game.grid.clearLine(a.x, a.z, tx, tz, a.radius * 0.85)) {
    ai.pathT -= dt;
    if (!ai.path || ai.pathT <= 0 || !ai.pathGoal || Math.hypot(ai.pathGoal.x - tx, ai.pathGoal.z - tz) > 1.5) {
      ai.path = game.grid.findPath(a.x, a.z, tx, tz, a.radius * 0.9);
      ai.pathGoal = { x: tx, z: tz }; ai.pathT = 0.45 + Math.random() * 0.2;
    }
    while (ai.path && ai.path.length > 1 && Math.hypot(ai.path[0].x - a.x, ai.path[0].z - a.z) < 0.35) ai.path.shift();
    if (ai.path && ai.path.length) { gx = ai.path[0].x; gz = ai.path[0].z; }
  } else ai.path = null;
  const ddx = gx - a.x, ddz = gz - a.z, dd = Math.hypot(ddx, ddz) || 1;
  const sp = speed * slowMult(a);
  const step = Math.min(sp * dt, Math.max(0, d - stop));
  const r = game.grid.slide(a.x, a.z, (ddx / dd) * step, (ddz / dd) * step, a.radius);
  a.x = r.x; a.z = r.z;
  a.moveVec = { x: ddx / dd, z: ddz / dd };
  turnToward(a, faceOf(ddx, ddz), 9, dt);
  a.speedNow = sp;
  return true;
}

function tryMoveDir(game, a, dir, speed, dt) {
  const step = speed * slowMult(a) * dt;
  const r = game.grid.slide(a.x, a.z, dir.x * step, dir.z * step, a.radius);
  const moved = Math.hypot(r.x - a.x, r.z - a.z);
  a.x = r.x; a.z = r.z;
  a.moveVec = dir; a.speedNow = moved / dt;
  return moved > step * 0.4;
}

function legalMoves(game, e, dist, los) {
  const def = e.def, ai = e.ai, ch = game.chamber;
  const allowed = def.phases ? def.phases[ai.phase].moves : null;
  return def.moves.filter((m) => !m.chainOnly && (!allowed || allowed.includes(m.id)) && (e.cd[m.id] ?? 0) <= 0 && dist >= m.minR && dist <= m.maxR
    && (!m.needsLos || los) && (m.shape.type !== 'summon' || ch.addsAlive(e) < (m.maxAdds ?? 2)));
}

function alertGroup(game, e) {
  for (const o of game.chamber.enemies) {
    if (o === e || o.dead || o.ai.alerted) continue;
    if ((e.group && o.group === e.group) || Math.hypot(o.x - e.x, o.z - e.z) < 7) { o.ai.alerted = true; o.ai.sleep = false; }
  }
}

export function updateEnemy(game, e, dt) {
  const ch = game.chamber, p = game.player, ai = e.ai, def = e.def;
  if (e.dead) { e.deadT += dt; return; }
  e.hurtT = Math.max(0, e.hurtT - dt);
  if (e.spawnT > 0) { e.spawnT -= dt; if (e.spawnT <= 0) { e.spawnT = 0; ai.alerted = true; } return; }
  tickStatus(e, dt);
  for (const k of Object.keys(e.cd)) e.cd[k] = Math.max(0, e.cd[k] - dt);
  applyKnock(game, e, dt);
  e.speedNow = 0; e.moveVec = { x: 0, z: 0 };

  if (e.state === 'stagger') {
    e.staggerT -= dt; e.t += dt;
    if (e.staggerT <= 0) { e.state = 'idle'; ai.pause = Math.max(ai.pause, 0.3); }
    return;
  }

  // boss phase transition
  if (def.boss && ai.pendingPhase !== null && !(e.action?.moveId === 'phase_shift') && (!e.action || e.action.phase === 'recovery')) {
    if (e.action) cancelAction(game, e);
    startPhaseShift(game, e);
  }

  if (e.action) {
    const wasShift = e.action.moveId === 'phase_shift';
    const done = updateAction(game, e, dt);
    if (wasShift && e.action && e.action.phase !== 'startup') e.invuln = false;
    if (done) onActionDone(game, e, wasShift);
    return;
  }

  ai.t += dt; ai.pause -= dt;
  const dist = Math.hypot(p.x - e.x, p.z - e.z);
  const los = !p.dead && game.grid.los(e.x, e.z, p.x, p.z);
  const homeDist = Math.hypot(ai.home.x - e.x, ai.home.z - e.z);

  if (!ai.alerted) {
    const range = ai.sleep ? def.aggro * 0.5 : def.aggro;
    if (!p.dead && dist < range && los) { ai.alerted = true; ai.sleep = false; alertGroup(game, e); game.emit('aggro', { actor: e }); }
    else return;
  }
  if (p.dead) { ai.alerted = false; ai.state = 'return'; }
  if (ai.state === 'return') {
    steerTo(game, e, ai.home.x, ai.home.z, def.speed, dt, 0.3);
    if (homeDist < 0.5) { ai.state = 'idle'; ai.alerted = false; e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.5); }
    return;
  }
  if (!def.boss && !e.group?.startsWith('enc:') && homeDist > def.leash && dist > 5) { ai.state = 'return'; ai.alerted = false; return; }

  // boss chasing: no leash. Positioning by role.
  const keep = def.keepRange;
  const melee = def.moves.filter((m) => m.tags.includes('melee') && m.weight > 0);
  const reach = melee.length ? Math.min(...melee.map((m) => m.maxR)) * 0.8 : 0;
  const moves = legalMoves(game, e, dist, los);
  const speed = def.speed * (def.phases?.[ai.phase]?.speedMult ?? 1) * (e.elite === 'frenzied' ? 1.2 : 1);

  // choose an attack if the decision pause has elapsed
  if (ai.pause <= 0 && moves.length) {
    const wantsToken = (m) => m.tags.includes('melee') && !def.boss;
    const pool = moves.filter((m) => !wantsToken(m) || ch.requestToken(e, MELEE_TOKENS));
    if (pool.length) {
      const m = game.rng.weighted(pool, (x) => (x.weight || 0.01) * (ai.lastMove === x.id ? 0.4 : 1));
      ai.lastMove = m.id;
      if (wantsToken(m)) ch.requestToken(e, MELEE_TOKENS, true);
      makeAction(game, e, m, { x: p.x, z: p.z });
      ai.state = 'action';
      return;
    }
  }

  // positioning
  ai.state = 'pursue';
  if (keep) {
    if (dist < keep[0]) {
      const away = { x: (e.x - p.x) / (dist || 1), z: (e.z - p.z) / (dist || 1) };
      const tries = [away, { x: -away.z, z: away.x }, { x: away.z, z: -away.x }];
      let ok = false;
      for (const d of tries) { if (tryMoveDir(game, e, d, speed * 1.05, dt)) { ok = true; turnToward(e, faceOf(p.x - e.x, p.z - e.z), 8, dt); break; } }
      if (!ok) turnToward(e, faceOf(p.x - e.x, p.z - e.z), 8, dt);
    } else if (dist > keep[1] || !los) {
      steerTo(game, e, p.x, p.z, speed, dt, keep[1] * 0.9);
    } else {
      // strafe inside the band
      if (ai.t > 2.2 + Math.random()) { ai.strafe *= -1; ai.t = 0; }
      const side = { x: -(p.z - e.z) / dist * ai.strafe, z: (p.x - e.x) / dist * ai.strafe };
      if (!tryMoveDir(game, e, side, speed * 0.55, dt)) ai.strafe *= -1;
      turnToward(e, faceOf(p.x - e.x, p.z - e.z), 8, dt);
    }
    return;
  }
  // melee positioning
  if (dist > reach || !los) {
    const hasToken = ai.token;
    const hold = !def.boss && !hasToken && dist < 4.2 && ch.meleeCount() >= MELEE_TOKENS && los;
    if (hold) {
      // wait for a free attack slot by circling at range
      const side = { x: -(p.z - e.z) / dist * ai.strafe, z: (p.x - e.x) / dist * ai.strafe };
      if (!tryMoveDir(game, e, side, speed * 0.5, dt)) ai.strafe *= -1;
      turnToward(e, faceOf(p.x - e.x, p.z - e.z), 8, dt);
    } else steerTo(game, e, p.x, p.z, speed, dt, Math.max(0.6, reach * 0.9));
  } else {
    turnToward(e, faceOf(p.x - e.x, p.z - e.z), 9, dt);
    if (!moves.length && ai.pause <= 0) { // too close for chosen moves or on cooldown: shuffle
      const side = { x: -(p.z - e.z) / dist * ai.strafe, z: (p.x - e.x) / dist * ai.strafe };
      if (!tryMoveDir(game, e, side, speed * 0.5, dt)) ai.strafe *= -1;
    }
  }
}

function onActionDone(game, e, wasShift) {
  const ai = e.ai, def = e.def, act = e.ai.lastAction;
  if (wasShift) {
    ai.phase = ai.pendingPhase; ai.pendingPhase = null; e.invuln = false;
    game.emit('boss', { kind: 'phase', actor: e, phase: ai.phase });
    ai.pause = 0.6;
    return;
  }
  const m = act?.move;
  // authored chain (e.g. mace -> backswing)
  if (m?.chain && game.rng.chance(m.chainChance ?? 1) && !game.player.dead) {
    const next = def.moves.find((x) => x.id === m.chain);
    const d = Math.hypot(game.player.x - e.x, game.player.z - e.z);
    if (next && d <= next.maxR + 0.8) { makeAction(game, e, next, { x: game.player.x, z: game.player.z }, { chained: true }); return; }
  }
  const base = def.boss ? game.rng.range(0.25, 0.6) : def.role === 'ranged' || def.role === 'caster' ? game.rng.range(0.3, 0.8) : game.rng.range(0.35, 0.95);
  ai.pause = base / (e.elite === 'frenzied' ? 1.4 : 1);
  ai.t = 0;
}

function startPhaseShift(game, e) {
  const sh = e.def.phaseShift;
  const move = {
    id: 'phase_shift', name: 'Hollow Wrath', tags: ['boss'], startup: sh.duration * 0.62, active: 0.12, recovery: sh.duration * 0.38, cooldown: 0,
    shape: { type: 'hazard', pattern: 'ring', radius: sh.ring.radius, inner: 0, lock: 0 }, damage: sh.ring.damage, poise: 50, knockback: sh.ring.knockback,
    anim: 'summon', armor: 'all', track: 0, sfx: 'toll',
  };
  e.invuln = true;
  game.chamber.clearEnemyProjectiles();
  makeAction(game, e, move, null, { face: e.face });
  game.emit('boss', { kind: 'shift', actor: e, phase: e.ai.pendingPhase });
}

export { lerpAngle, dirOf, angleDiff, clamp };
