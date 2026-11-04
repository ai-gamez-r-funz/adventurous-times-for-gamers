// Motivated lighting. Every local light is driven by a registered emitter (a visible object that could plausibly
// produce it). A fixed pool of PointLights is assigned to the nearest enabled emitters each frame, so shader
// variants never change and there are no floating, unexplained lights.
import * as THREE from 'three';

export class LightRig {
  constructor(scene, { poolSize = 7 } = {}) {
    this.scene = scene;
    this.emitters = new Map();
    this.pool = [];
    for (let i = 0; i < poolSize; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      scene.add(l);
      this.pool.push({ light: l, emitterId: null, cur: 0, target: 0 });
    }
    this.quality = 1;
  }

  /**
   * @param {object} e { id, type, object (visible emitter Object3D), offset:[x,y,z], color, intensity, range, flicker, enabled:()=>bool, priority }
   */
  register(e) {
    if (!e.object) throw new Error(`emitter ${e.id} has no visible object`);
    this.emitters.set(e.id, { flicker: 0, priority: 0, enabled: () => true, offset: [0, 0, 0], seed: Math.random() * 100, ...e });
  }
  unregister(id) { this.emitters.delete(id); for (const s of this.pool) if (s.emitterId === id) { s.emitterId = null; s.target = 0; } }
  clear() { this.emitters.clear(); for (const s of this.pool) { s.emitterId = null; s.target = 0; s.cur = 0; s.light.intensity = 0; } }
  setPoolLimit(n) { this.limit = n; }

  update(dt, time, focus) {
    const limit = Math.min(this.pool.length, this.limit ?? this.pool.length);
    const wp = new THREE.Vector3();
    const live = [];
    for (const e of this.emitters.values()) {
      if (!e.enabled() || !e.object.visible) continue;
      e.object.getWorldPosition(wp);
      const d = Math.hypot(wp.x - focus.x, wp.z - focus.z);
      live.push({ e, d: d - e.priority * 100 });
    }
    live.sort((a, b) => a.d - b.d);
    const want = new Set(live.slice(0, limit).map((x) => x.e.id));
    // release lights whose emitter is no longer wanted
    for (const s of this.pool) if (s.emitterId && !want.has(s.emitterId)) { s.target = 0; if (s.cur < 0.02) s.emitterId = null; }
    // assign free lights to wanted emitters lacking one
    const assigned = new Set(this.pool.filter((s) => s.emitterId && want.has(s.emitterId)).map((s) => s.emitterId));
    for (const { e } of live.slice(0, limit)) {
      if (assigned.has(e.id)) continue;
      const free = this.pool.find((s) => !s.emitterId);
      if (!free) break;
      free.emitterId = e.id; free.cur = 0; assigned.add(e.id);
    }
    for (const s of this.pool) {
      const e = s.emitterId ? this.emitters.get(s.emitterId) : null;
      if (!e) { s.light.intensity = 0; continue; }
      e.object.getWorldPosition(wp);
      s.light.position.set(wp.x + e.offset[0], wp.y + e.offset[1], wp.z + e.offset[2]);
      const fl = e.flicker ? 1 + Math.sin(time * 9 + e.seed) * e.flicker * 0.5 + Math.sin(time * 23 + e.seed * 2) * e.flicker * 0.5 : 1;
      s.target = e.enabled() ? e.intensity * fl * this.quality : 0;
      s.cur += (s.target - s.cur) * Math.min(1, dt * 8);
      s.light.color.setHex(e.color); s.light.distance = e.range; s.light.intensity = s.cur;
    }
  }

  /** Source -> light inventory (emitter id, type, assigned light index, enabled, range, colour, intensity). */
  inventory() {
    return [...this.emitters.values()].map((e) => ({
      emitterId: e.id, type: e.type, enabled: e.enabled(), range: e.range, color: e.color, intensity: e.intensity,
      attached: e.object.parent !== null, light: this.pool.findIndex((s) => s.emitterId === e.id),
    }));
  }
  /** Every active pool light must trace to an enabled emitter that exists in the scene. */
  verify() {
    const problems = [];
    for (const [i, s] of this.pool.entries()) {
      if (s.light.intensity < 0.01) continue;
      const e = s.emitterId && this.emitters.get(s.emitterId);
      if (!e) problems.push(`light ${i} is lit with no emitter`);
      else if (!e.object.parent) problems.push(`light ${i} emitter ${e.id} is detached`);
    }
    for (const e of this.emitters.values()) if (!e.object.parent && e.enabled()) problems.push(`emitter ${e.id} enabled but not in scene`);
    return problems;
  }
}
