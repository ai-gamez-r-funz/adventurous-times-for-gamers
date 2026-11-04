// Dev tool: print ASCII renderings of every chamber with entities overlaid.  node tools/dump-maps.mjs [chamberId]
import { CHAMBERS } from '../src/data/chambers.js';
import { buildGrid } from '../src/sim/grid.js';

const glyph = { pillar: 'O', waystone: 'W', pedestal: 'P', flame: 'F', altar: 'A', socket: 's', lore: 'L', brazier: 'B', chest: 'C', urn: 'u', enemy: 'e', block: '▣', plate: '□', glyph: 'g', cracked: 'x', gate: '=', spawn: '@', resetrune: 'R', torch: 't', door: 'D', mural: 'm', prop: 'p' };
const only = process.argv[2];
for (const [id, def] of Object.entries(CHAMBERS)) {
  if (only && only !== id) continue;
  const g = buildGrid(def);
  const rows = [];
  for (let z = 0; z < g.h; z++) {
    let r = '';
    for (let x = 0; x < g.w; x++) r += g.isFloor(x, z) ? '.' : g.isWall(x, z) ? '#' : ' ';
    rows.push([...r]);
  }
  const put = (x, z, ch) => { if (rows[z] && x >= 0 && x < g.w) rows[z][x] = ch; };
  for (const e of def.entities) {
    if (e.t === 'door') { for (let i = 0; i < e.w; i++) put(e.axis === 'x' ? e.x + i : e.x, e.axis === 'x' ? e.z : e.z + i, 'D'); continue; }
    if (e.t === 'gate') { for (const [x, z] of e.cells) put(x, z, '='); continue; }
    if (e.t === 'encounter') continue;
    if (e.t === 'puzzle') continue;
    put(e.x, e.z, glyph[e.t] ?? '?');
  }
  console.log(`\n== ${id} (${def.name}) ${g.w}x${g.h}`);
  console.log('   ' + [...Array(g.w).keys()].map((i) => (i % 10)).join(''));
  rows.forEach((r, z) => console.log(String(z).padStart(2) + ' ' + r.join('')));
}
