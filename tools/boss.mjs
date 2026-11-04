import { Game } from '../src/sim/game.js';
import { xpToNext } from '../src/data/classes.js';
const g = new Game({ classId: 'oathbound', seed: 4, fade: false });
while (g.player.level < 7) g.grantXp(xpToNext(g.player.level));
g.progress.sigils.push('ash', 'bone', 'mourning');
g.enterChamber('sanctum', 'from_nave');
g.player.x = 20.5; g.player.z = 21.5; g.player.invuln = true;
const ev = [];
g.on('windup', (e) => { if (e.actor.def?.boss) ev.push(`${g.time.toFixed(1)} windup ${e.move.id}`); });
g.on('boss', (e) => ev.push(`${g.time.toFixed(1)} boss ${e.kind} ${e.phase ?? ''}`));
for (let i = 0; i < 60 * 20; i++) {
  const b = g.chamber.enemies.find((e) => e.def.boss);
  const cmds = [];
  if (b && !b.dead && b.spawnT <= 0) cmds.push({ t: 'attack', id: b.id });
  g.step(1 / 60, cmds);
  if (i % 120 === 0) { const b2 = g.chamber.enemies.find((e) => e.def.boss); console.log(g.time.toFixed(1), b2 ? `boss ${b2.x.toFixed(1)},${b2.z.toFixed(1)} hp ${Math.round(b2.hp)} spawnT ${b2.spawnT.toFixed(2)} alerted ${b2.ai.alerted} state ${b2.state}` : 'no boss', 'player', g.player.x.toFixed(1), g.player.z.toFixed(1), 'enc', g.chamber.encounters[0].state); }
}
console.log(ev.slice(0, 30).join('\n'));
