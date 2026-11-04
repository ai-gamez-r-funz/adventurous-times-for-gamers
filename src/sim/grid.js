// Flat navigation / collision grid. One gameplay plane: there is no height anywhere in this file.
// Layers: floor (walkable geometry), solid (static solid entities), dyn (dynamic blockers: gates, blocks, urns...).
import { clamp } from '../core/util.js';

export class Grid {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.floor = new Uint8Array(w * h);
    this.solid = new Uint8Array(w * h);
    this.dyn = new Uint16Array(w * h);
  }
  idx(cx, cz) { return cz * this.w + cx; }
  inB(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h; }
  isFloor(cx, cz) { return this.inB(cx, cz) && this.floor[this.idx(cx, cz)] === 1; }
  blocked(cx, cz) {
    if (!this.inB(cx, cz)) return true;
    const i = this.idx(cx, cz);
    return this.floor[i] === 0 || this.solid[i] > 0 || this.dyn[i] > 0;
  }
  /** A wall cell is any non-floor cell touching a floor cell (8-neighbour). Used by render only. */
  isWall(cx, cz) {
    if (this.isFloor(cx, cz)) return false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && this.isFloor(cx + dx, cz + dz)) return true;
    return false;
  }
  addDyn(cx, cz, n = 1) { if (this.inB(cx, cz)) this.dyn[this.idx(cx, cz)] += n; }
  removeDyn(cx, cz, n = 1) { if (this.inB(cx, cz)) { const i = this.idx(cx, cz); this.dyn[i] = Math.max(0, this.dyn[i] - n); } }

  circleBlocked(x, z, r) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r), z0 = Math.floor(z - r), z1 = Math.floor(z + r);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!this.blocked(cx, cz)) continue;
        const nx = clamp(x, cx, cx + 1), nz = clamp(z, cz, cz + 1);
        const dx = x - nx, dz = z - nz;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
    return false;
  }
  pointBlocked(x, z) { return this.blocked(Math.floor(x), Math.floor(z)); }

  /** Move a circle by (dx,dz) with axis-separated sliding. Returns {x,z,hit}. */
  slide(x, z, dx, dz, r) {
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / 0.2));
    const sx = dx / steps, sz = dz / steps;
    let hit = false;
    for (let i = 0; i < steps; i++) {
      if (sx !== 0) { if (!this.circleBlocked(x + sx, z, r)) x += sx; else hit = true; }
      if (sz !== 0) { if (!this.circleBlocked(x, z + sz, r)) z += sz; else hit = true; }
    }
    return { x, z, hit };
  }

  /** Straight clear line for a circle of radius r (sampled sweep). */
  clearLine(ax, az, bx, bz, r = 0.3) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / 0.25));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (this.circleBlocked(ax + (bx - ax) * t, az + (bz - az) * t, r)) return false;
    }
    return true;
  }
  /** Line of sight for attacks/perception (points, ignores actors). */
  los(ax, az, bx, bz) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / 0.3));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.pointBlocked(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  nearestFree(cx, cz, maxR = 6) {
    if (!this.blocked(cx, cz)) return [cx, cz];
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = 1e9;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (this.blocked(cx + dx, cz + dz)) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = [cx + dx, cz + dz]; }
      }
      if (best) return best;
    }
    return null;
  }

  /** A* over cells (8-neighbour, no corner cutting), then string-pulled using agent radius r. Returns [{x,z}...] or null. */
  findPath(sx, sz, gx, gz, r = 0.4) {
    const s = this.nearestFree(Math.floor(sx), Math.floor(sz), 2);
    const g = this.nearestFree(Math.floor(gx), Math.floor(gz), 6);
    if (!s || !g) return null;
    const W = this.w;
    const start = s[1] * W + s[0], goal = g[1] * W + g[0];
    if (start === goal) return [{ x: g[0] === Math.floor(gx) ? gx : g[0] + 0.5, z: g[1] === Math.floor(gz) ? gz : g[1] + 0.5 }];
    const N = this.w * this.h;
    const gS = new Float32Array(N).fill(1e9), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap = []; // [f, idx]
    const push = (f, i) => { heap.push([f, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = c * 2 + 1, rr = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    const gcx = g[0], gcz = g[1];
    const h = (cx, cz) => { const dx = Math.abs(cx - gcx), dz = Math.abs(cz - gcz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    gS[start] = 0; push(h(s[0], s[1]), start);
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let found = false, guard = 0;
    while (heap.length && guard++ < 6000) {
      const [, cur] = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === goal) { found = true; break; }
      const cx = cur % W, cz = (cur / W) | 0;
      for (const [dx, dz, c] of D) {
        const nx = cx + dx, nz = cz + dz;
        if (this.blocked(nx, nz)) continue;
        if (dx && dz && (this.blocked(cx + dx, cz) || this.blocked(cx, cz + dz))) continue;
        const ni = nz * W + nx;
        if (closed[ni]) continue;
        const ng = gS[cur] + c;
        if (ng < gS[ni]) { gS[ni] = ng; from[ni] = cur; push(ng + h(nx, nz), ni); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = goal; i !== -1; i = from[i]) cells.push({ x: (i % W) + 0.5, z: ((i / W) | 0) + 0.5 });
    cells.reverse();
    // exact goal when the goal cell is where the user asked for
    if (g[0] === Math.floor(gx) && g[1] === Math.floor(gz)) cells[cells.length - 1] = { x: gx, z: gz };
    // string pulling
    const out = [];
    let ax = sx, az = sz, i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !this.clearLine(ax, az, cells[j].x, cells[j].z, r)) j--;
      out.push(cells[j]);
      ax = cells[j].x; az = cells[j].z; i = j + 1;
    }
    return out;
  }
}

/** Build the static grid layers from authored chamber data. Dynamic blockers are added by the world runtime. */
export function buildGrid(def) {
  const [W, H] = def.size;
  const g = new Grid(W, H);
  for (const f of def.floors) {
    if (f.disc) {
      for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
        if (Math.hypot(cx + 0.5 - f.cx, cz + 0.5 - f.cz) <= f.r) g.floor[g.idx(cx, cz)] = 1;
      }
    } else {
      for (let cz = f.z; cz < f.z + f.h; cz++) for (let cx = f.x; cx < f.x + f.w; cx++) if (g.inB(cx, cz)) g.floor[g.idx(cx, cz)] = 1;
    }
  }
  const solidKinds = new Set(['pillar', 'waystone', 'pedestal', 'flame', 'altar', 'socket', 'lore', 'brazier', 'chest', 'resetrune']);
  for (const e of def.entities) {
    if ((solidKinds.has(e.t) || (e.t === 'prop' && e.solid)) && g.inB(e.x, e.z)) g.solid[g.idx(e.x, e.z)] = 1;
  }
  return g;
}

/** Cells of the given set of entities that must remain connected (used by validation). */
export function reachable(grid, sx, sz, passable = (cx, cz) => !grid.blocked(cx, cz)) {
  const seen = new Uint8Array(grid.w * grid.h);
  const q = [[sx, sz]]; seen[grid.idx(sx, sz)] = 1;
  while (q.length) {
    const [cx, cz] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (!grid.inB(nx, nz) || seen[grid.idx(nx, nz)] || !passable(nx, nz)) continue;
      seen[grid.idx(nx, nz)] = 1; q.push([nx, nz]);
    }
  }
  return seen;
}
