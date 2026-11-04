// Deterministic review fixtures: ?autostart&fx=<name>  (e.g. boss, boss2, lowhp, nave, embers, ossuary, reliquary, sanctum, lvl8, inv)
import { resolveHit } from './sim/combat.js';
import * as Inv from './sim/inventory.js';
import { rollItem } from './sim/loot.js';
import { RNG } from './core/util.js';
import { xpToNext } from './data/classes.js';

export function apply(game, view, name) {
  const go = (id, spawn) => { game.enterChamber(id, spawn ?? Object.keys(game.chamber.spawns)[0]); };
  const lvl = (n) => { while (game.player.level < n) game.grantXp(xpToNext(game.player.level)); };
  const loot = () => { const rng = new RNG(5); for (let i = 0; i < 9; i++) { const r = Inv.addToBag(game.inv, rollItem(rng, { ilvl: 4 + (i % 3), classId: game.classId, min: i % 3 === 0 ? 'rare' : undefined })); if (r.ok) game.inv = r.inv; } game.recomputeStats(); game.emit('inventory', {}); };
  const sig = () => { game.progress.sigils.push('ash', 'bone', 'mourning'); };
  for (const part of name.split(',')) {
    switch (part) {
      case 'lvl8': lvl(8); break;
      case 'loot': loot(); break;
      case 'nave': go('nave', 'from_gate'); break;
      case 'embers': go('embers', 'from_nave'); break;
      case 'ossuary': go('ossuary', 'from_nave'); break;
      case 'reliquary': go('reliquary', 'from_nave'); break;
      case 'sanctum': sig(); go('sanctum', 'from_nave'); break;
      case 'boss': sig(); lvl(7); go('sanctum', 'from_nave'); game.player.x = 20.5; game.player.z = 25.5; break;
      case 'boss2': { const b = game.chamber.enemies.find((e) => e.def.boss); if (b) { b.hp = b.maxHp * 0.64; } break; }
      case 'lowhp': game.player.hp = game.stats.maxHp * 0.2; break;
      case 'god': game.player.invuln = true; break;
      case 'kill': for (const e of game.chamber.enemies) if (!e.dead) resolveHit(game, game.player, e, { move: { damage: 9999, poise: 0, knockback: 0 } }); break;
      case 'inv': loot(); window.__app?.hud.toggleInv(true); break;
      default: break;
    }
  }
  void view;
}
