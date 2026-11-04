# Emberhollow — *Relight the Vigil*

An isometric, real-time gothic action-RPG dungeon crawler built with **Three.js** (no external assets — all models,
textures and audio are procedural). Diablo-style click-to-move combat, loot and level-ups, broken into
Zelda/Tunic-style **chambers** with puzzles, secrets and a boss.

Play at [Github pages | https://ai-gamez-r-funz.github.io/adventurous-times-for-gamers/]

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 55+ deterministic sim/content/lighting tests (vitest)
npm run build      # production build -> dist/
```

## The game

Emberhollow's Vigil Flame has gone out and the dead are restless. Pick a champion, descend through the abbey, bring the
three sigils to the Ashen Nave, and face the **Hollow Bishop**.

| Champion | Style | Skills |
|---|---|---|
| **Oathbound** | Melee brawler — builds *Resolve* by cleaving | Cleave · Shield Bash · Whirlwind · Iron Charge |
| **Cinder Witch** | Caster — kites with ember & storm | Ember Bolt · Frost Nova · Arc Lightning · Ember Blink |

**Chambers** (hub-and-wings): Sunken Gate (tutorial) → Ashen Nave (hub) → three wings, each ending in a sigil →
Bishop's Sanctum.

* **Hall of Embers** — light four braziers in the order the mural shows (melee, spells and projectiles all light them).
* **The Ossuary** — push coffins onto pressure plates (solvability is proven by a BFS solver in the tests; a reset rune prevents soft-locks).
* **The Reliquary** — listen to the glyph song, repeat it, then beat an elite Gravebrute.
* **Collecting** — 11 lore fragments, 5 hidden relics behind cracked walls, 6 unique items, a bestiary; all in the Codex (`C`).
* **Loot** — four rarities, random affixes, class-restricted gear, atomic inventory with compare tooltips.

### Controls
| | |
|---|---|
| Left click / hold | Move · click enemy to attack · click loot/objects to use |
| Right click, `1–4` / `Q R` | Skills |
| `Space` | Dodge roll (i-frames — learn the red telegraphs!) |
| `WASD` | Screen-relative movement · `E` interact · `F`/`G` potions |
| `I` `C` `M` `Esc` | Inventory · Codex · Mute · Menu |
| Touch | Left thumb stick, right-hand buttons, tap to move/target |

## Architecture

```
src/data/     authored content: classes+skills, enemies+moves, items, chambers, lore, validate.js
src/sim/      headless deterministic simulation (no THREE/DOM): grid/nav, combat, AI, player, puzzles, world, game, saves
src/render/   Three.js: GameView, procedural rigs, chamber views, motivated light pool, pooled VFX, review gallery
src/ui/       DOM HUD, inventory, codex, menus      src/core/  input, audio (WebAudio synth), util
tests/        vitest (content, combat, AI, inventory, world/puzzles/saves, lights) + tests/e2e (real browser)
tools/        dump-maps, validate, solve-ossuary, boss/smoke bots, headless screenshot helper
```

Design rules taken from the repo's skills (`.claude/skills`):

* **Single gameplay plane** — no height anywhere in level data; walls are derived; near-camera walls are kept low and tall props fade so the hero is never hidden. Validated in tests.
* **Motivated lighting** — every local light belongs to a visible emitter (torch, brazier, waystone, glyph, projectile, lantern); a fixed `PointLight` pool follows the nearest enabled emitters, and `LightRig.verify()` flags any orphan.
* **Authoritative combat** — every move is `startup → active → recovery`; hits come from contact shapes resolved once per action/target; telegraphs, animation, VFX and audio all read the same clock. Enemies have tokens (max 2 simultaneous melee attackers), aim-tracking locks, poise, armor windows; the boss has three phases with a guarded transition.
* **Data-driven** — enemies/moves/skills/items/chambers are plain data validated at test time; rigs follow a shared `root → motion → body` contract with sockets (`?view=gallery` is the moveset/pose review route).
* **Atomic persistence** — inventory ops are pure transactions that conserve item identity; saves are versioned with a tested migration; encounters/rewards never duplicate.

### Review fixtures
`?autostart&nosave&fx=<list>` jumps straight to states: `nave embers ossuary reliquary sanctum boss boss2 lvl8 loot inv lowhp god kill`.
`?q=low` forces the low graphics tier; `?view=gallery` shows every rig and lets you freeze poses (`__gal.set('slash','active',0.5)`).

## Verification
Unit/sim tests: `npm test`. Browser playthrough with real mouse/keyboard/touch: start `npm run dev`, then
`node tests/e2e/playthrough.mjs` (needs Playwright + Chromium).
Built using Claude

Foundation is Three.js

Skills from https://github.com/MengTo/Skills/tree/main
