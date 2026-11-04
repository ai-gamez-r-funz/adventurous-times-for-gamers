import { Game } from '../src/sim/game.js';
import { memoryStorage } from '../src/sim/save.js';
const g = new Game({ classId: process.argv[2] ?? 'oathbound', seed: 7, storage: memoryStorage(), fade: false });
const log = [];
g.on('*', (t, p) => { if (['hit', 'death', 'encounterStart', 'encounterClear', 'toast', 'levelup', 'pickup', 'chamber'].includes(t)) log.push(t + ' ' + (p?.text ?? p?.id ?? p?.amount ?? '')); });
// walk to the ambush trigger then fight whatever is near
const P = g.player;
let frames = 0;
const cmds = [{ t: 'moveTo', x: 13.5, z: 12.5 }];
for (let i = 0; i < 60 * 40; i++) {
  const en = g.chamber.enemies.filter((e) => !e.dead && !e.spawnT).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
  if (en && Math.hypot(en.x - P.x, en.z - P.z) < 8) cmds.push({ t: 'attack', id: en.id });
  g.step(1 / 60, cmds.splice(0));
  frames++;
  if (P.dead) { console.log('player died at', frames); break; }
}
console.log(log.slice(0, 40).join('\n'));
console.log('hp', Math.round(P.hp), '/', g.stats.maxHp, 'lvl', P.level, 'xp', P.xp, 'kills', g.progress.stats.kills, 'pos', P.x.toFixed(1), P.z.toFixed(1), 'enemies', g.chamber.enemies.filter((e) => !e.dead).length);
