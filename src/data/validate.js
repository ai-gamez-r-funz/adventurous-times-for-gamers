// Content validation: reject duplicate ids, missing references, off-floor placements, unreachable objectives,
// and anything that violates the single-gameplay-plane contract. Used by tests and (in dev) at startup.
import { CHAMBERS } from './chambers.js';
import { ENEMIES } from './enemies.js';
import { UNIQUES, BASES } from './items.js';
import { LORE, RELICS } from './lore.js';
import { SKILLS, CLASSES } from './classes.js';
import { buildGrid, reachable } from '../sim/grid.js';

const POS_TYPES = new Set(['enemy', 'urn', 'chest', 'lore', 'brazier', 'glyph', 'block', 'plate', 'altar', 'waystone', 'pillar', 'socket', 'pedestal', 'flame', 'resetrune', 'cracked', 'prop', 'spawn']);
const OCCUPY = new Set(['urn', 'chest', 'lore', 'brazier', 'altar', 'waystone', 'pillar', 'socket', 'pedestal', 'flame', 'resetrune', 'cracked', 'block', 'enemy']);
const FACE = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const PLANE_KEYS = ['y', 'elevation', 'height', 'z2', 'ramp', 'stairs'];

export function validateContent() {
  const errs = [];
  const err = (m) => errs.push(m);

  for (const [id, e] of Object.entries(ENEMIES)) {
    if (e.id !== id) err(`enemy ${id}: id mismatch`);
    const moveIds = new Set(e.moves.map((m) => m.id));
    if (moveIds.size !== e.moves.length) err(`enemy ${id}: duplicate move ids`);
    for (const m of e.moves) {
      if (!(m.startup > 0 && m.active > 0 && m.recovery >= 0)) err(`enemy ${id}/${m.id}: bad timing`);
      if (m.chain && !moveIds.has(m.chain)) err(`enemy ${id}/${m.id}: chain ${m.chain} missing`);
      if (!m.shape?.type) err(`enemy ${id}/${m.id}: no shape`);
      if (m.maxR < m.minR) err(`enemy ${id}/${m.id}: range inverted`);
    }
    for (const ph of e.phases ?? []) for (const mid of ph.moves) if (!moveIds.has(mid)) err(`enemy ${id}: phase ${ph.id} references ${mid}`);
  }
  for (const c of Object.values(CLASSES)) {
    for (const s of c.skills) if (!SKILLS[s]) err(`class ${c.id}: skill ${s} missing`);
    for (const s of Object.values(c.start)) if (!BASES[s]) err(`class ${c.id}: start item ${s} missing`);
  }
  for (const u of Object.values(UNIQUES)) if (!BASES[u.baseId]) err(`unique ${u.id}: base ${u.baseId} missing`);

  for (const [cid, def] of Object.entries(CHAMBERS)) {
    const p = `chamber ${cid}`;
    if (def.id !== cid) err(`${p}: id mismatch`);
    const grid = buildGrid(def);
    const ids = new Map();
    for (const e of def.entities) {
      for (const k of PLANE_KEYS) if (k in e) err(`${p}: entity ${e.id ?? e.t} has plane-violating key '${k}'`);
      if (e.id) { if (ids.has(e.id)) err(`${p}: duplicate id ${e.id}`); ids.set(e.id, e); }
    }
    const need = (ref, kind, what) => { const o = ids.get(ref); if (!o) err(`${p}: ${what} references missing ${ref}`); else if (kind && o.t !== kind) err(`${p}: ${what} ${ref} is ${o.t}, expected ${kind}`); return o; };

    // placement
    const occ = new Map();
    for (const e of def.entities) {
      if (POS_TYPES.has(e.t) && !(e.t === 'prop' && e.kind === 'banner')) {
        if (!grid.isFloor(e.x, e.z)) err(`${p}: ${e.id ?? e.t} at (${e.x},${e.z}) is not on a floor cell`);
        if (OCCUPY.has(e.t)) {
          const k = `${e.x},${e.z}`;
          if (occ.has(k) && !(e.t === 'enemy' && false)) err(`${p}: ${e.id ?? e.t} overlaps ${occ.get(k)} at ${k}`);
          occ.set(k, e.id ?? e.t);
        }
      }
      if (e.t === 'torch') {
        if (!grid.isWall(e.x, e.z)) err(`${p}: torch (${e.x},${e.z}) is not on a wall cell`);
        const [dx, dz] = FACE[e.face] ?? [0, 0];
        if (!grid.isFloor(e.x + dx, e.z + dz)) err(`${p}: torch (${e.x},${e.z}) face ${e.face} does not face a floor cell`);
      }
      if (e.t === 'mural' || (e.t === 'prop' && e.kind === 'banner')) {
        if (!grid.isWall(e.x, e.z)) err(`${p}: ${e.t} (${e.x},${e.z}) is not on a wall cell`);
      }
      if (e.t === 'door') {
        for (let i = 0; i < e.w; i++) {
          const cx = e.axis === 'x' ? e.x + i : e.x, cz = e.axis === 'x' ? e.z : e.z + i;
          if (!grid.isFloor(cx, cz)) err(`${p}: door ${e.id} cell (${cx},${cz}) not floor`);
        }
        const tgt = CHAMBERS[e.to];
        if (!tgt) err(`${p}: door ${e.id} -> missing chamber ${e.to}`);
        else if (!tgt.entities.some((s) => s.t === 'spawn' && s.id === e.spawn)) err(`${p}: door ${e.id} -> missing spawn ${e.to}/${e.spawn}`);
        else if (!tgt.entities.some((d) => d.t === 'door' && d.to === cid)) err(`${p}: no return door in ${e.to}`);
      }
      if (e.t === 'gate') { for (const [x, z] of e.cells) if (!grid.isFloor(x, z)) err(`${p}: gate ${e.id} cell (${x},${z}) not floor`); }
      if (e.t === 'enemy' && !ENEMIES[e.def]) err(`${p}: enemy ${e.id} def ${e.def} missing`);
      if (e.t === 'lore' && !LORE[e.lore]) err(`${p}: lore ${e.id} -> ${e.lore} missing`);
      if (e.t === 'chest') {
        if (e.relic && !RELICS[e.relic]) err(`${p}: chest ${e.id} relic ${e.relic} missing`);
        if (e.loot?.unique && !UNIQUES[e.loot.unique]) err(`${p}: chest ${e.id} unique ${e.loot.unique} missing`);
      }
      if (e.t === 'encounter') {
        for (const gid of e.gates ?? []) need(gid, 'gate', `encounter ${e.id}`);
        for (const rid of e.onClear?.reveal ?? []) need(rid, null, `encounter ${e.id} reveal`);
        e.waves.forEach((w, wi) => w.enemies.forEach((s) => {
          if (!ENEMIES[s.def]) err(`${p}: encounter ${e.id} wave ${wi} def ${s.def} missing`);
          if (!grid.isFloor(s.x, s.z)) err(`${p}: encounter ${e.id} wave ${wi} spawn (${s.x},${s.z}) not floor`);
        }));
        const tr = e.trigger;
        let any = false;
        for (let z = tr.z; z < tr.z + tr.h && !any; z++) for (let x = tr.x; x < tr.x + tr.w; x++) if (grid.isFloor(x, z)) { any = true; break; }
        if (!any) err(`${p}: encounter ${e.id} trigger covers no floor`);
      }
      if (e.t === 'puzzle') {
        for (const gid of e.onSolved?.open ?? []) need(gid, 'gate', `puzzle ${e.id}`);
        if (e.kind === 'brazier_seq') for (const b of e.order) need(b, 'brazier', `puzzle ${e.id}`);
        if (e.kind === 'push_plates') { for (const b of e.blocks) need(b, 'block', `puzzle ${e.id}`); for (const b of e.plates) need(b, 'plate', `puzzle ${e.id}`); if (e.blocks.length !== e.plates.length) err(`${p}: puzzle ${e.id} blocks/plates mismatch`); }
        if (e.kind === 'glyph_seq') { for (const b of e.glyphs) need(b, 'glyph', `puzzle ${e.id}`); for (const s of e.sequence) if (s < 0 || s >= e.glyphs.length) err(`${p}: puzzle ${e.id} bad sequence`); }
      }
      if (e.t === 'altar' && e.reqFlag === undefined) err(`${p}: altar ${e.id} missing reqFlag`);
      if (e.t === 'resetrune') need(e.puzzle, 'puzzle', `resetrune ${e.id}`);
      if (e.t === 'pedestal') need(e.puzzle, 'puzzle', `pedestal ${e.id}`);
      if (e.t === 'brazier' && e.puzzle) need(e.puzzle, 'puzzle', `brazier ${e.id}`);
    }

    // enemy / wave spawn cells must be clear of solid objects, props, gates and wall-hugging (an enemy inside a tablet is unkillable)
    const blockedByEntity = new Map();
    for (const e of def.entities) {
      if (e.x === undefined || ['enemy', 'torch', 'spawn', 'door', 'mural', 'encounter', 'puzzle', 'plate', 'glyph'].includes(e.t) || (e.t === 'prop' && (e.kind === 'banner' || !e.solid))) continue;
      blockedByEntity.set(`${e.x},${e.z}`, `${e.t}${e.id ? ':' + e.id : ''}`);
    }
    for (const e of def.entities) if (e.t === 'gate') for (const [x, z] of e.cells) blockedByEntity.set(`${x},${z}`, `gate:${e.id}`);
    const spawnOk = (label, x, z) => {
      if (grid.solid[grid.idx(x, z)]) err(`${p}: ${label} spawns inside a solid object at (${x},${z})`);
      else if (blockedByEntity.has(`${x},${z}`)) err(`${p}: ${label} spawns on ${blockedByEntity.get(`${x},${z}`)} at (${x},${z})`);
      else if (grid.circleBlocked(x + 0.5, z + 0.5, 0.45)) err(`${p}: ${label} at (${x},${z}) overlaps a wall/solid`);
    };
    for (const e of def.entities) {
      if (e.t === 'enemy') spawnOk(`enemy ${e.id}`, e.x, e.z);
      if (e.t === 'encounter') e.waves.forEach((w, wi) => w.enemies.forEach((s) => spawnOk(`encounter ${e.id} wave ${wi} ${s.def}`, s.x, s.z)));
    }

    // reachability from every spawn (gates/urns/cracked walls treated as passable; static solids block)
    const spawns = def.entities.filter((e) => e.t === 'spawn');
    if (!spawns.length) err(`${p}: no spawn`);
    const cracked = new Set(def.entities.filter((e) => e.t === 'cracked').map((e) => `${e.x},${e.z}`));
    for (const sp of spawns.slice(0, 1)) {
      const seen = reachable(grid, sp.x, sp.z);
      const ok = (x, z) => grid.inB(x, z) && seen[grid.idx(x, z)] === 1;
      const near = (x, z) => ok(x, z) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => ok(x + dx, z + dz));
      for (const e of def.entities) {
        if (!POS_TYPES.has(e.t) || e.t === 'prop' || e.t === 'pillar') continue;
        if (!near(e.x, e.z)) err(`${p}: ${e.id ?? e.t} at (${e.x},${e.z}) unreachable from spawn ${sp.id}`);
      }
      for (const e of def.entities) if (e.t === 'door') { const cx = e.x, cz = e.z; if (!near(cx, cz)) err(`${p}: door ${e.id} unreachable`); }
    }
    for (const sp of spawns) if (grid.blocked(sp.x, sp.z)) err(`${p}: spawn ${sp.id} blocked`);
    void cracked;
  }
  return errs;
}
