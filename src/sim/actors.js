// Actors (player + enemies) and the shared action state machine: startup -> active -> recovery.
// One authoritative clock per action. Animation, VFX, audio and AI read it; none of them own timing.
import { dirOf, faceOf, angleDiff, clamp, TAU } from '../core/util.js';
import { ELITE, enemyScale, ENEMIES } from '../data/enemies.js';
import { CLASSES } from '../data/classes.js';
import { shapeHits, targetsFor, resolveHit, spawnProjectile, cancelAction } from './combat.js';

function baseActor(game, o) {
  const a = {
    id: o.id, kind: o.kind, team: o.kind === 'player' ? 'player' : 'enemy', x: o.x, z: o.z, face: o.face ?? 0, radius: o.radius,
    vx: 0, vz: 0, hp: 1, maxHp: 1, poise: 0, maxPoise: 0, state: 'idle', t: 0, staggerT: 0, action: null, cd: {}, status: {},
    dead: false, deadT: 0, hurtT: 0, invuln: false, iframes: false, flinchImmune: 0, spawnT: 0, moveVec: { x: 0, z: 0 }, speedNow: 0,
  };
  Object.defineProperty(a, 'game', { value: game, enumerable: false });
  return a;
}

export function createPlayer(game, classId, x, z, face) {
  const a = baseActor(game, { id: 'player', kind: 'player', x, z, face, radius: 0.38 });
  Object.assign(a, { classId, level: 1, xp: 0, mana: 0, combo: 0, comboT: 0, rollT: 0, rollDir: { x: 0, z: 1 }, rigId: CLASSES[classId].rig, potionCd: { hp: 0, mana: 0 }, aimDir: { x: 0, z: 1 } });
  return a;
}

export function createEnemy(game, def, x, z, opts = {}) {
  const level = opts.level ?? 1;
  const a = baseActor(game, { id: opts.id ?? game.nextId('e'), kind: 'enemy', x, z, face: opts.face ?? 0, radius: def.radius * (opts.elite ? ELITE.scale : 1) });
  const sc = enemyScale(level) * (opts.elite ? ELITE.hp : 1);
  const bulwark = opts.elite === 'bulwark';
  Object.assign(a, {
    defId: def.id, def, level, elite: opts.elite || null, persistId: opts.persistId ?? null, group: opts.group ?? null, scale: opts.elite ? ELITE.scale : 1, rigId: def.rig,
    maxHp: Math.round(def.hp * sc), maxPoise: def.poise * (bulwark ? 2 : 1), spawnT: opts.spawnT ?? 0,
    ai: { state: 'idle', t: 0, home: { x, z }, alerted: false, sleep: !!opts.sleep, path: null, pathT: 0, strafe: Math.random() < 0.5 ? 1 : -1, pause: 0.4 + Math.random() * 0.5, phase: 0, pendingPhase: null, hurtAt: -99, cdAll: {}, token: false, shiftT: 0, lastDist: 0, pathGoal: null },
  });
  a.hp = a.maxHp; a.poise = a.maxPoise;
  if (def.boss) a.ai.phase = 0;
  return a;
}

// ---------------------------------------------------------------- actions
const speedMultOf = (a) => {
  if (a.kind === 'player') return 1 + a.game.stats.atkSpeed / 100;
  let m = 1;
  if (a.elite === 'frenzied') m *= 1.25;
  const ph = a.def.phases?.[a.ai.phase];
  if (ph) m *= ph.speedMult;
  return m;
};

export function makeAction(game, a, move, aim, opts = {}) {
  const sm = speedMultOf(a);
  const rm = a.kind === 'enemy' ? (a.def.phases?.[a.ai.phase]?.recoveryMult ?? 1) : 1;
  const startup = move.startup / sm, recovery = move.recovery * rm / (a.kind === 'player' ? sm : sm), active = move.active;
  const face = opts.face ?? (aim ? faceOf(aim.x - a.x, aim.z - a.z) : a.face);
  const act = {
    id: `${a.id}#${game.nextId('act')}`, moveId: move.id, move, t: 0, startup, active, recovery, total: startup + active + recovery, phase: 'startup',
    face, dir: dirOf(face), aim: aim ? { x: aim.x, z: aim.z } : null, origin: { x: a.x, z: a.z }, hitSet: new Set(), tickIdx: -1, fired: false,
    locked: move.track === 0 || a.kind === 'player', chained: !!opts.chained, lungeDone: 0,
  };
  a.action = act;
  a.state = 'action';
  a.t = 0;
  a.face = face;
  if (move.cooldown) a.cd[move.id] = move.cooldown;
  if (move.shape.type === 'hazard') game.chamber.spawnMoveHazards(a, move, act);
  game.emit('windup', { actor: a, move, action: act });
  return act;
}

const approach = (cur, target, maxStep) => { const d = angleDiff(cur, target); return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep; };
export const turnToward = (a, f, rate, dt) => { a.face = approach(a.face, f, rate * dt); };

function moveActor(game, a, dx, dz) {
  const r = game.grid.slide(a.x, a.z, dx, dz, a.radius);
  a.x = r.x; a.z = r.z;
  return r.hit;
}

/** Advance an action by dt. Returns true when it finished this step. */
export function updateAction(game, a, dt) {
  const act = a.action;
  const m = act.move;
  act.t += dt;

  // enemy aim tracking until the lock point (prevents instant turn-and-hit)
  if (a.kind === 'enemy' && !act.locked) {
    const lockAt = (m.track ?? 0.6) * act.startup;
    if (act.t < lockAt && !game.player.dead) {
      const f = faceOf(game.player.x - a.x, game.player.z - a.z);
      turnToward(a, f, 6.5, dt);
      act.face = a.face; act.dir = dirOf(a.face);
    } else act.locked = true;
  } else if (a.kind === 'player') { a.face = act.face; }
  else a.face = act.face;

  const prev = act.phase;
  act.phase = act.t < act.startup ? 'startup' : act.t < act.startup + act.active ? 'active' : act.t < act.total ? 'recovery' : 'done';
  if (act.phase === 'done') { finishAction(game, a); return true; }
  if (act.phase !== 'startup' && !act.fired) { act.fired = true; fireActive(game, a, act); }
  void prev;

  // movement tied to the action
  if (m.lunge && act.phase === 'startup' && a.kind === 'player') {
    const step = (m.lunge / act.startup) * dt;
    const room = clamp(m.lunge - act.lungeDone, 0, step); act.lungeDone += room;
    moveActor(game, a, act.dir.x * room, act.dir.z * room);
  }
  if (m.move && act.phase === 'active' && (m.move.type === 'dash' || m.move.type === 'lunge')) {
    const sp = m.move.dist / act.active;
    const hit = moveActor(game, a, act.dir.x * sp * dt, act.dir.z * sp * dt);
    if (hit && m.move.type === 'lunge' && a.kind === 'enemy') act.t = Math.max(act.t, act.startup + act.active); // stop lunging into a wall
  }
  if (m.moveDuring && act.phase === m.moveDuring.phase && a.kind === 'player') {
    const d = a.aimDir; const sp = m.moveDuring.speed * (a.status.slow ? 1 - a.status.slow.mag : 1);
    moveActor(game, a, d.x * sp * dt, d.z * sp * dt);
  }

  // contacts
  if (act.phase === 'active') contactStep(game, a, act);
  return false;
}

function fireActive(game, a, act) {
  const m = act.move, sh = m.shape;
  game.emit('swing', { actor: a, move: m, action: act });
  const gain = m.gain;
  if (sh.type === 'projectile') {
    const fan = sh.fan ?? 1, spread = sh.spread ?? 0;
    for (let i = 0; i < fan; i++) {
      const off = fan === 1 ? 0 : -spread / 2 + (spread * i) / (fan - 1);
      const d = dirOf(act.face + off);
      spawnProjectile(game, a, m, a.x + d.x * (a.radius + 0.35), a.z + d.z * (a.radius + 0.35), act.face + off, { actionId: act.id, gain, kind: a.kind === 'player' ? 'bolt' : undefined });
    }
  } else if (sh.type === 'chain') {
    chainLightning(game, a, act);
  } else if (sh.type === 'summon') {
    game.chamber.summon(a, m);
  }
  if (m.move?.type === 'blink') {
    act.origin = { x: a.x, z: a.z };
    const d = act.dir; let best = 0;
    for (let s = 0.25; s <= m.move.dist + 1e-6; s += 0.25) { if (game.grid.circleBlocked(a.x + d.x * s, a.z + d.z * s, a.radius)) break; best = s; }
    const from = { x: a.x, z: a.z };
    a.x += d.x * best; a.z += d.z * best;
    game.emit('blink', { actor: a, from, to: { x: a.x, z: a.z } });
  }
}

function chainLightning(game, a, act) {
  const sh = act.move.shape;
  const enemies = targetsFor(game, a);
  const inCone = enemies.filter((t) => Math.hypot(t.x - a.x, t.z - a.z) <= sh.range + t.radius && Math.abs(angleDiff(act.face, faceOf(t.x - a.x, t.z - a.z))) <= sh.cone && (t.prop ? true : game.grid.los(a.x, a.z, t.x, t.z)));
  inCone.sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z));
  const pts = [{ x: a.x + act.dir.x * 0.6, z: a.z + act.dir.z * 0.6 }];
  let cur = inCone.find((t) => !t.prop) ?? inCone[0];
  const hit = new Set();
  let hops = sh.hops + 1;
  while (cur && hops-- > 0) {
    hit.add(cur.id);
    pts.push({ x: cur.x, z: cur.z });
    resolveHit(game, a, cur, { move: act.move, mult: 1, gain: act.move.gain });
    const from = cur;
    cur = enemies.filter((t) => !t.prop && !t.dead && !hit.has(t.id) && Math.hypot(t.x - from.x, t.z - from.z) <= sh.hopRange && game.grid.los(from.x, from.z, t.x, t.z))
      .sort((p, q) => Math.hypot(p.x - from.x, p.z - from.z) - Math.hypot(q.x - from.x, q.z - from.z))[0];
  }
  if (pts.length === 1) pts.push({ x: a.x + act.dir.x * 5, z: a.z + act.dir.z * 5 });
  game.emit('chain', { actor: a, points: pts });
}

function contactStep(game, a, act) {
  const m = act.move, sh = m.shape;
  if (!['arc', 'circle', 'line', 'ring'].includes(sh.type)) return;
  if (m.tick) {
    const idx = Math.floor((act.t - act.startup) / m.tick);
    if (idx !== act.tickIdx) { act.tickIdx = idx; act.hitSet.clear(); game.emit('tick', { actor: a, move: m, action: act }); }
  }
  const o = sh.atOrigin ? { x: act.origin.x, z: act.origin.z, face: act.face } : { x: a.x, z: a.z, face: act.face };
  for (const t of targetsFor(game, a)) {
    if (act.hitSet.has(t.id)) continue;
    if (!shapeHits(sh, o, t.x, t.z, t.radius)) continue;
    if (!t.prop && !game.grid.los(o.x, o.z, t.x, t.z)) continue;
    act.hitSet.add(t.id);
    if (t.kind === 'player' && t.iframes) { game.emit('dodged', { actor: t, move: m }); continue; }
    resolveHit(game, a, t, { move: m, actionId: act.id, mult: 1, gain: m.gain, kx: t.x - (sh.atOrigin ? o.x : a.x), kz: t.z - (sh.atOrigin ? o.z : a.z) });
  }
}

export function finishAction(game, a) {
  const act = a.action;
  a.action = null;
  if (a.state === 'action') a.state = 'idle';
  a.t = 0;
  if (a.kind === 'enemy') { game.chamber.releaseToken(a); a.ai.lastAction = act; }
  else { a.comboT = 0.9; }
}

export { cancelAction };
export const allDefs = ENEMIES;
void TAU;
