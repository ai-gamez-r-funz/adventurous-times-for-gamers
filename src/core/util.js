// Small math / RNG / event helpers shared by sim and render. No THREE imports here.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeIn = (t) => t * t;
export const dist = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);

export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export const lerpAngle = (a, b, t) => a + angleDiff(a, b) * t;
/** Facing angle -> unit direction. Forward is +Z at angle 0. */
export const dirOf = (f) => ({ x: Math.sin(f), z: Math.cos(f) });
export const faceOf = (dx, dz) => Math.atan2(dx, dz);

/** Seeded RNG (mulberry32) with convenience helpers. State is serialisable. */
export class RNG {
  constructor(seed = 1) {
    this.s = (seed >>> 0) || 1;
  }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  weighted(list, wf = (x) => x.weight ?? 1) {
    let total = 0;
    for (const x of list) total += wf(x);
    let r = this.next() * total;
    for (const x of list) {
      r -= wf(x);
      if (r <= 0) return x;
    }
    return list[list.length - 1];
  }
}

export class Emitter {
  constructor() { this.map = new Map(); }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.map.get(type)?.delete(fn);
  }
  emit(type, payload) {
    const set = this.map.get(type);
    if (set) for (const fn of [...set]) fn(payload);
    const all = this.map.get('*');
    if (all) for (const fn of [...all]) fn(type, payload);
  }
}

let uidCounter = 1;
const SALT = Math.random().toString(36).slice(2, 6); // keeps ids unique across sessions (saved item uids)
export const uid = (p = 'u') => `${p}${SALT}${(uidCounter++).toString(36)}`;
export const deepClone = (o) => JSON.parse(JSON.stringify(o));
