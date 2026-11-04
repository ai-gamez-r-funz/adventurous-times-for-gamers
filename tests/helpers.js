import { Game } from '../src/sim/game.js';
import { memoryStorage } from '../src/sim/save.js';

export const DT = 1 / 60;
export function newGame(opts = {}) {
  const g = new Game({ classId: 'oathbound', seed: 11, storage: memoryStorage(), fade: false, ...opts });
  g.events.on('*', () => {});
  return g;
}
export function run(g, seconds, cmdsAt = () => []) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) g.step(DT, cmdsAt(i) ?? []);
}
export function tp(g, x, z) { g.player.x = x; g.player.z = z; g.chamber.markExplored(); }
export function collect(g, types) {
  const out = [];
  g.events.on('*', (t, p) => { if (!types || types.includes(t)) out.push({ t, p }); });
  return out;
}
export function gotoChamber(g, id, spawn) { g.enterChamber(id, spawn ?? Object.keys(g.chamber.spawns)[0]); }
/** Place an enemy next to a position (no AI wake-up unless alerted) */
export function spawnAt(g, def, x, z, opts = {}) {
  const e = g.chamber.spawnEnemy(def, Math.floor(x), Math.floor(z), { sleep: false, ...opts });
  e.x = x; e.z = z; e.spawnT = 0;
  return e;
}
export function clearEnemies(g) { for (const e of g.chamber.enemies) { e.dead = true; e.state = 'dead'; e.deadT = 99; } g.chamber.enemies = []; }
export function godMode(g) { g.player.invuln = true; }
