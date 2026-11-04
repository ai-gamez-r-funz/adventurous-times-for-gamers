// Player controller: command intents, skills (with input buffering), dodge roll, movement, potions.
// Cancellation rules: dodge cancels startup and recovery of any skill (not active frames); skills buffer for 0.35s.
import { dirOf, faceOf, lerpAngle, clamp } from '../core/util.js';
import { CLASSES, SKILLS, DODGE, POTION } from '../data/classes.js';
import { makeAction, updateAction } from './actors.js';
import { tickStatus, applyKnock, slowMult } from './ai.js';
import { cancelAction } from './combat.js';
import { usePotion } from './inventory.js';

export const BUFFER_TIME = 0.35;

export function skillOf(p, slot) {
  const id = CLASSES[p.classId].skills[slot];
  return id ? SKILLS[id] : null;
}
export const skillUnlocked = (p, skill) => p.level >= (skill.unlock ?? 1);
const aimOf = (p, x, z) => (x === undefined ? { x: p.x + dirOf(p.face).x, z: p.z + dirOf(p.face).z } : { x, z });

export function handleCommand(game, p, c) {
  if (p.dead) return;
  const it = p.intent;
  switch (c.t) {
    case 'moveTo': it.kind = 'path'; it.goal = { x: c.x, z: c.z }; it.path = null; it.pathT = 0; it.hold = !!c.hold; it.target = null; break;
    case 'moveDir': it.dir = { x: c.x, z: c.z }; if (c.x || c.z) { it.kind = 'dir'; it.target = null; } else if (it.kind === 'dir') it.kind = 'none'; break;
    case 'attack': it.kind = 'attack'; it.target = c.id; it.slot = c.slot ?? 0; break;
    case 'interact': it.kind = 'interact'; it.target = c.id ?? null; break;
    case 'stop': it.kind = 'none'; it.target = null; break;
    case 'skill': p.buffer = { slot: c.slot, x: c.x, z: c.z, t: BUFFER_TIME }; if (!c.keepIntent) it.kind = it.kind === 'dir' ? 'dir' : 'none'; break;
    case 'dodge': p.buffer = { dodge: true, x: c.x, z: c.z, t: BUFFER_TIME }; break;
    case 'potion': tryPotion(game, p, c.kind); break;
    default: break;
  }
}

export function tryPotion(game, p, kind) {
  if (p.potionCd[kind] > 0) { game.emit('denied', { reason: 'potion cooldown' }); return false; }
  const st = game.stats;
  if (kind === 'hp' && p.hp >= st.maxHp) return false;
  if (kind === 'mana' && p.mana >= st.maxMana) return false;
  const r = usePotion(game.inv, kind);
  if (!r.ok) { game.emit('denied', { reason: 'no potion' }); return false; }
  game.inv = r.inv;
  p.potionCd[kind] = POTION[kind].cooldown;
  if (kind === 'hp') p.hp = Math.min(st.maxHp, p.hp + st.maxHp * POTION.hp.heal);
  else p.mana = Math.min(st.maxMana, p.mana + st.maxMana * POTION.mana.restore);
  game.emit('potion', { kind });
  game.markDirty();
  return true;
}

export function tryUseSkill(game, p, slot, x, z) {
  const skill = skillOf(p, slot);
  if (!skill || !skillUnlocked(p, skill)) { game.emit('denied', { reason: 'locked', slot }); return false; }
  if ((p.cd[skill.id] ?? 0) > 0) { game.emit('denied', { reason: 'cooldown', slot }); return false; }
  if (p.mana < skill.cost) { game.emit('denied', { reason: 'resource', slot }); return false; }
  const aim = aimOf(p, x, z);
  const f = faceOf(aim.x - p.x, aim.z - p.z);
  p.mana -= skill.cost;
  p.combo = p.comboT > 0 ? (p.combo + 1) % 2 : 0;
  p.intent.stand = false;
  makeAction(game, p, skill, aim, { face: Math.hypot(aim.x - p.x, aim.z - p.z) < 0.05 ? p.face : f });
  p.action.combo = p.combo;
  const d = dirOf(p.action.face); p.aimDir = d;
  game.emit('skillUsed', { slot, skill });
  return true;
}

export function startRoll(game, p, dir) {
  if ((p.cd.dodge ?? 0) > 0) { game.emit('denied', { reason: 'cooldown', slot: 'dodge' }); return false; }
  const act = p.action;
  if (act && act.phase === 'active') return false;
  if (act) cancelAction(game, p);
  let d = dir && (dir.x || dir.z) ? dir : (p.moveVec.x || p.moveVec.z ? p.moveVec : dirOf(p.face));
  const l = Math.hypot(d.x, d.z) || 1; d = { x: d.x / l, z: d.z / l };
  p.state = 'roll'; p.rollT = 0; p.rollDir = d; p.face = faceOf(d.x, d.z);
  p.cd.dodge = DODGE.cooldown; p.intent.kind = p.intent.kind === 'dir' ? 'dir' : 'none';
  game.emit('roll', { actor: p, dir: d });
  return true;
}

function steerPlayer(game, p, tx, tz, dt, stop = 0.05) {
  const it = p.intent;
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
  if (d <= stop) return false;
  let gx = tx, gz = tz;
  if (!game.grid.clearLine(p.x, p.z, tx, tz, p.radius * 0.9)) {
    it.pathT = (it.pathT ?? 0) - dt;
    if (!it.path || it.pathT <= 0) { it.path = game.grid.findPath(p.x, p.z, tx, tz, p.radius); it.pathT = 0.3; }
    while (it.path && it.path.length > 1 && Math.hypot(it.path[0].x - p.x, it.path[0].z - p.z) < 0.3) it.path.shift();
    if (it.path?.length) { gx = it.path[0].x; gz = it.path[0].z; } else return false;
  } else it.path = null;
  const ddx = gx - p.x, ddz = gz - p.z, dd = Math.hypot(ddx, ddz) || 1;
  const sp = game.stats.speed * slowMult(p);
  const step = Math.min(sp * dt, d - stop);
  const r = game.grid.slide(p.x, p.z, (ddx / dd) * step, (ddz / dd) * step, p.radius);
  const moved = Math.hypot(r.x - p.x, r.z - p.z);
  p.x = r.x; p.z = r.z;
  p.moveVec = { x: ddx / dd, z: ddz / dd };
  p.speedNow = moved / dt;
  p.face = lerpAngle(p.face, faceOf(ddx, ddz), Math.min(1, dt * 16));
  return moved > 0.0005;
}

export function updatePlayer(game, p, dt) {
  const st = game.stats, it = p.intent;
  p.hurtT = Math.max(0, p.hurtT - dt);
  p.flinchImmune = Math.max(0, p.flinchImmune - dt);
  p.comboT = Math.max(0, p.comboT - dt);
  for (const k of Object.keys(p.cd)) p.cd[k] = Math.max(0, p.cd[k] - dt);
  p.potionCd.hp = Math.max(0, p.potionCd.hp - dt); p.potionCd.mana = Math.max(0, p.potionCd.mana - dt);
  if (p.dead) return;
  tickStatus(p, dt);
  p.mana = Math.min(st.maxMana, p.mana + st.manaRegen * dt);
  p.hp = Math.min(st.maxHp, p.hp + st.maxHp * 0.0015 * dt); // trickle regen out of combat is deliberately tiny
  applyKnock(game, p, dt);
  p.speedNow = 0; p.moveVec = { x: 0, z: 0 };
  if (p.buffer) { p.buffer.t -= dt; if (p.buffer.t <= 0) p.buffer = null; }

  // roll
  if (p.state === 'roll') {
    p.rollT += dt;
    p.iframes = p.rollT >= DODGE.iFrom && p.rollT <= DODGE.iTo;
    const k = p.rollT / DODGE.duration;
    const sp = (DODGE.distance / DODGE.duration) * (1.45 - 0.9 * k);
    const r = game.grid.slide(p.x, p.z, p.rollDir.x * sp * dt, p.rollDir.z * sp * dt, p.radius);
    p.x = r.x; p.z = r.z; p.moveVec = p.rollDir; p.speedNow = sp;
    if (p.rollT >= DODGE.duration) { p.state = 'idle'; p.iframes = false; }
    return;
  }
  p.iframes = false;

  if (p.state === 'stagger') {
    p.staggerT -= dt;
    if (p.staggerT <= 0) p.state = 'idle';
    return;
  }

  // buffered inputs
  const b = p.buffer;
  if (b?.dodge) {
    if (!p.action || p.action.phase !== 'active') {
      const dir = b.x !== undefined ? { x: b.x - p.x, z: b.z - p.z } : null;
      p.buffer = null; startRoll(game, p, dir);
      if (p.state === 'roll') return;
    }
  }

  if (p.action) {
    // keep updating aim for spin-style actions
    if (p.action.move.moveDuring && p.buffer && p.buffer.x !== undefined && p.buffer.slot === undefined) { /* dodge handled above */ }
    const done = updateAction(game, p, dt);
    if (done) { /* fallthrough: pick up buffered input this same frame */ } else return;
  }

  if (p.buffer && p.buffer.slot !== undefined) {
    const buf = p.buffer; p.buffer = null;
    if (tryUseSkill(game, p, buf.slot, buf.x, buf.z)) { updateAction(game, p, 0); return; }
  }

  // intents
  switch (it.kind) {
    case 'dir': {
      const d = it.dir; const l = Math.hypot(d.x, d.z);
      if (l > 0.01) {
        const sp = st.speed * slowMult(p);
        const nx = d.x / l, nz = d.z / l;
        const r = game.grid.slide(p.x, p.z, nx * sp * dt * Math.min(1, l), nz * sp * dt * Math.min(1, l), p.radius);
        const moved = Math.hypot(r.x - p.x, r.z - p.z);
        p.x = r.x; p.z = r.z; p.moveVec = { x: nx, z: nz }; p.speedNow = moved / dt;
        p.face = lerpAngle(p.face, faceOf(nx, nz), Math.min(1, dt * 16));
      }
      break;
    }
    case 'path': {
      if (it.hold && it.goal) { /* goal refreshed by input each frame */ }
      const moved = steerPlayer(game, p, it.goal.x, it.goal.z, dt);
      if (!moved && Math.hypot(it.goal.x - p.x, it.goal.z - p.z) < 0.4) it.kind = 'none';
      else if (!moved && !it.hold) it.kind = 'none';
      break;
    }
    case 'attack': {
      const t = game.chamber.byId(it.target);
      if (!t || t.dead || (t.prop && t.broken)) { it.kind = 'none'; break; }
      const skill = skillOf(p, it.slot ?? 0);
      const reach = (skill.range ?? skill.shape.range ?? 2.4) * 0.88;
      const d = Math.hypot(t.x - p.x, t.z - p.z) - t.radius;
      const ranged = skill.shape.type === 'projectile';
      const canSee = !ranged || game.grid.los(p.x, p.z, t.x, t.z);
      if (d <= reach && canSee) {
        p.face = lerpAngle(p.face, faceOf(t.x - p.x, t.z - p.z), 0.6);
        if (!tryUseSkill(game, p, it.slot ?? 0, t.x, t.z)) { /* on cooldown/resource: face target and wait */ }
        else updateAction(game, p, 0);
      } else steerPlayer(game, p, t.x, t.z, dt, canSee ? Math.max(0.4, reach * 0.8) : 0.5); // no line of sight: keep closing until a shot is clear
      break;
    }
    case 'interact': {
      const target = it.target ? game.chamber.interactableById(it.target) : game.chamber.nearestInteractable(p);
      if (!target) { it.kind = 'none'; break; }
      const d = Math.hypot(target.x - p.x, target.z - p.z);
      if (d <= (target.range ?? 1.9)) { game.chamber.interact(target); it.kind = 'none'; }
      else if (!steerPlayer(game, p, target.x, target.z, dt, (target.range ?? 1.9) * 0.8)) it.kind = 'none';
      break;
    }
    default: break;
  }
  if (p.state !== 'action') p.state = p.speedNow > 0.2 ? 'move' : 'idle';
}
export { dirOf };
