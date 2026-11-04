// Pooled, capped visual effects. Everything here is downstream of resolved simulation events.
// Rules: no per-frame allocation in hot paths, fixed pools, idempotent cleanup, reduced-motion aware.
import * as THREE from 'three';
import { RNG } from '../core/util.js';

const MAX_P = 900;
const rng = new RNG(4242);

export class Particles {
  constructor(scene) {
    this.n = 0; this.head = 0;
    this.pos = new Float32Array(MAX_P * 3); this.col = new Float32Array(MAX_P * 3); this.size = new Float32Array(MAX_P); this.alpha = new Float32Array(MAX_P);
    this.vel = new Float32Array(MAX_P * 3); this.life = new Float32Array(MAX_P); this.max = new Float32Array(MAX_P); this.grav = new Float32Array(MAX_P); this.s0 = new Float32Array(MAX_P); this.shrink = new Uint8Array(MAX_P);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1)); g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: 40 } },
      vertexShader: 'attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale; void main(){ vC=color; vA=alpha; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = max(1.0, size*uScale); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); if(d>0.5) discard; float a = smoothstep(0.5,0.05,d); gl_FragColor = vec4(vC, a*vA); }',
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
    this.geom = g;
    this.tmpC = new THREE.Color();
    this.cap = MAX_P;
  }
  setCap(c) { this.cap = Math.min(MAX_P, c); }
  emit(x, y, z, vx, vy, vz, life, size, color, grav = 0, shrink = true) {
    const i = this.head; this.head = (this.head + 1) % this.cap;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z; this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.tmpC.setHex(color); this.col[k] = this.tmpC.r; this.col[k + 1] = this.tmpC.g; this.col[k + 2] = this.tmpC.b;
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.s0[i] = size; this.grav[i] = grav; this.alpha[i] = 1; this.shrink[i] = shrink ? 1 : 0;
  }
  burst(x, y, z, { count = 12, color = 0xffaa50, speed = 3, life = 0.5, size = 0.12, grav = -4, spread = 1, up = 1 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, 6.283), e = rng.range(0.1, 1) * spread, s = speed * rng.range(0.4, 1);
      this.emit(x, y, z, Math.cos(a) * s * e, rng.range(0.2, 1) * s * up, Math.sin(a) * s * e, life * rng.range(0.6, 1.2), size * rng.range(0.6, 1.3), color, grav);
    }
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      any = true;
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] += this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] = Math.max(0.02, this.pos[k + 1] + this.vel[k + 1] * dt); this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      this.alpha[i] = Math.min(1, f * 1.6);
      if (this.shrink[i]) this.size[i] = this.s0[i] * (0.4 + 0.6 * f);
    }
    if (any || this.dirty) { this.geom.attributes.position.needsUpdate = true; this.geom.attributes.alpha.needsUpdate = true; this.geom.attributes.size.needsUpdate = true; this.geom.attributes.color.needsUpdate = true; }
    this.dirty = any;
  }
  setScale(px) { this.mat.uniforms.uScale.value = px; }
}

// ---------------------------------------------------------------- flat ground geometry
const geoCache = new Map();
function sectorGeo(arc) {
  const key = `sec${arc.toFixed(2)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const seg = Math.max(6, Math.ceil(arc * 10)), v = [0, 0, 0], idx = [];
  for (let i = 0; i <= seg; i++) { const a = -arc / 2 + (arc * i) / seg; v.push(Math.sin(a), 0, Math.cos(a)); if (i > 0) idx.push(0, i, i + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx);
  // wind so the face points up
  const ia = g.index.array; for (let i = 0; i < ia.length; i += 3) { const t = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = t; }
  geoCache.set(key, g); return g;
}
function circleGeo() { if (!geoCache.has('circ')) { const g = new THREE.CircleGeometry(1, 40); g.rotateX(-Math.PI / 2); geoCache.set('circ', g); } return geoCache.get('circ'); }
function ringGeo(ratio) {
  const key = `ring${ratio.toFixed(2)}`;
  if (!geoCache.has(key)) { const g = new THREE.RingGeometry(ratio, 1, 48); g.rotateX(-Math.PI / 2); geoCache.set(key, g); }
  return geoCache.get(key);
}
function lineGeo() { if (!geoCache.has('line')) { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); g.translate(0, 0, 0.5); geoCache.set('line', g); } return geoCache.get('line'); }

const flatMat = (color, opacity, additive) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

export class Decals {
  constructor(scene) {
    this.scene = scene; this.free = []; this.live = [];
    for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(circleGeo(), flatMat(0xffffff, 0, true)); m.visible = false; m.renderOrder = 3; scene.add(m); this.free.push(m); }
  }
  spawn(geometry, { x, z, y = 0.05, rot = 0, color = 0xffffff, a0 = 0.8, a1 = 0, s0 = 1, s1 = 1, sy0, sy1, dur = 0.25, additive = true, spin = 0, ease = 1 }) {
    const m = this.free.pop() ?? this.live.shift()?.m;
    if (!m) return;
    m.geometry = geometry; m.material.color.setHex(color); m.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending; m.material.needsUpdate = true;
    m.position.set(x, y, z); m.rotation.set(0, rot, 0); m.visible = true;
    this.live.push({ m, t: 0, dur, a0, a1, s0, s1, sy0: sy0 ?? s0, sy1: sy1 ?? s1, spin, rot, ease });
  }
  slash(x, z, face, range, arc, color = 0xfff0d0) { this.spawn(sectorGeo(arc), { x, z, rot: face, color, a0: 0.85, a1: 0, s0: range * 0.6, s1: range * 1.05, dur: 0.22 }); }
  circle(x, z, r, color, dur = 0.3, a0 = 0.7) { this.spawn(circleGeo(), { x, z, color, a0, a1: 0, s0: r * 0.3, s1: r, dur }); }
  ring(x, z, r, color, dur = 0.45, thick = 0.82) { this.spawn(ringGeo(thick), { x, z, color, a0: 0.9, a1: 0, s0: r * 0.2, s1: r, dur }); }
  line(x, z, face, len, width, color, dur = 0.25) { this.spawn(lineGeo(), { x, z, rot: face, color, a0: 0.8, a1: 0, s0: width, s1: width, sy0: len, sy1: len, dur }); }
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const d = this.live[i]; d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      const e = 1 - Math.pow(1 - k, 2);
      d.m.material.opacity = d.a0 + (d.a1 - d.a0) * k;
      const sx = d.s0 + (d.s1 - d.s0) * e, sy = d.sy0 + (d.sy1 - d.sy0) * e;
      d.m.scale.set(sx, 1, sy);
      if (d.spin) d.m.rotation.y = d.rot + d.spin * d.t;
      if (k >= 1) { d.m.visible = false; this.free.push(d.m); this.live.splice(i, 1); }
    }
  }
  clear() { for (const d of this.live) { d.m.visible = false; this.free.push(d.m); } this.live.length = 0; }
}

export class Beams {
  constructor(scene) {
    this.scene = scene; this.pool = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 48), 3));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
      l.visible = false; l.frustumCulled = false; l.renderOrder = 6; scene.add(l); this.pool.push({ l, t: 0, pts: null, on: false, color: 0xbfe8ff });
    }
  }
  fire(points, color = 0xbfe8ff) { const b = this.pool.find((x) => !x.on) ?? this.pool[0]; b.on = true; b.t = 0.3; b.pts = points.map((p) => ({ x: p.x, z: p.z })); b.l.material.color.setHex(color); b.l.visible = true; }
  update(dt) {
    for (const b of this.pool) {
      if (!b.on) continue;
      b.t -= dt; if (b.t <= 0) { b.on = false; b.l.visible = false; continue; }
      const a = b.l.geometry.attributes.position; let n = 0;
      for (let i = 0; i < b.pts.length - 1 && n < 44; i++) {
        const p = b.pts[i], q = b.pts[i + 1], segs = 6;
        for (let s = 0; s <= segs && n < 47; s++) {
          const k = s / segs, j = s === 0 || s === segs ? 0 : 0.28;
          a.setXYZ(n++, p.x + (q.x - p.x) * k + (Math.random() - 0.5) * j, 1.0 + Math.sin(k * 3.14) * 0.25 + (Math.random() - 0.5) * j * 0.6, p.z + (q.z - p.z) * k + (Math.random() - 0.5) * j);
        }
      }
      b.l.geometry.setDrawRange(0, n); a.needsUpdate = true; b.l.material.opacity = Math.min(1, b.t * 5);
    }
  }
}

// ---------------------------------------------------------------- enemy telegraphs (read from sim state each frame)
export class Telegraphs {
  constructor(scene) { this.scene = scene; this.items = new Map(); this.frame = 0; }
  _make(kind, arc, ratio) {
    const g = kind === 'arc' ? sectorGeo(arc) : kind === 'circle' ? circleGeo() : kind === 'ring' ? ringGeo(ratio) : lineGeo();
    const base = new THREE.Mesh(g, flatMat(0xff2a1a, 0.18, false)), fill = new THREE.Mesh(g, flatMat(0xff4a2a, 0.42, false));
    base.renderOrder = 2; fill.renderOrder = 2;
    const grp = new THREE.Group(); grp.add(base); grp.add(fill); this.scene.add(grp);
    return { grp, base, fill, kind, key: `${kind}${arc}${ratio}` };
  }
  _get(id, kind, arc = 0, ratio = 0) {
    let it = this.items.get(id);
    const key = `${kind}${arc}${ratio}`;
    if (it && it.key !== key) { this.scene.remove(it.grp); this.items.delete(id); it = null; }
    if (!it) { it = this._make(kind, arc, ratio); this.items.set(id, it); }
    it.seen = this.frame;
    return it;
  }
  update(game) {
    this.frame++;
    const ch = game.chamber;
    for (const e of ch.enemies) {
      const act = e.action;
      if (!act || e.dead) continue;
      const m = act.move, sh = m.shape;
      if (act.phase === 'recovery' || act.phase === 'done') continue;
      const k = act.phase === 'startup' ? Math.min(1, act.t / act.startup) : 1;
      const flash = act.phase === 'active';
      const fx = (it, kx, ky) => { it.fill.scale.set(kx, 1, ky); it.fill.material.opacity = flash ? 0.85 : 0.35 + 0.25 * k; it.fill.material.color.setHex(flash ? 0xffe0c0 : 0xff4a2a); it.base.material.opacity = flash ? 0.5 : 0.18 + 0.12 * k; };
      if (sh.type === 'arc') {
        const it = this._get(`${e.id}`, 'arc', sh.arc);
        it.grp.position.set(e.x, 0.04, e.z); it.grp.rotation.y = act.face; it.base.scale.set(sh.range, 1, sh.range); fx(it, sh.range * k, sh.range * k);
      } else if (sh.type === 'circle') {
        const it = this._get(`${e.id}`, 'circle'); const off = sh.offset ?? 0;
        it.grp.position.set(e.x + Math.sin(act.face) * off, 0.04, e.z + Math.cos(act.face) * off); it.grp.rotation.y = 0; it.base.scale.set(sh.radius, 1, sh.radius); fx(it, sh.radius * k, sh.radius * k);
      } else if (sh.type === 'line' || m.telegraph === 'line') {
        const len = m.move?.dist ? m.move.dist + (sh.length ?? 2) * 0.5 : sh.length ?? 3, w = sh.width ?? 1.4;
        const it = this._get(`${e.id}`, 'line');
        it.grp.position.set(e.x, 0.04, e.z); it.grp.rotation.y = act.face; it.base.scale.set(w, 1, len); fx(it, w, len * k);
      } else if (m.telegraph === 'aim' && sh.type === 'projectile') {
        const fan = sh.fan ?? 1;
        for (let i = 0; i < fan; i++) {
          const off = fan === 1 ? 0 : -(sh.spread ?? 0) / 2 + ((sh.spread ?? 0) * i) / (fan - 1);
          const it = this._get(`${e.id}:aim${i}`, 'line');
          it.grp.position.set(e.x, 0.04, e.z); it.grp.rotation.y = act.face + off; it.base.scale.set(0.09, 1, 9); fx(it, 0.09 + 0.1 * k, 9 * Math.min(1, k * 1.4));
        }
      }
    }
    for (const h of ch.hazards) {
      if (h.state === 'done') continue;
      const kind = h.pattern === 'ring' ? 'ring' : 'circle';
      const it = this._get(`hz:${h.id}`, kind, 0, kind === 'ring' ? Math.min(0.95, h.inner / h.r) : 0);
      const k = Math.min(1, h.t / h.telegraph), flash = h.state === 'active';
      it.grp.position.set(h.x, 0.04, h.z); it.grp.rotation.y = 0; it.base.scale.set(h.r, 1, h.r);
      const fk = kind === 'ring' ? 1 : k;
      it.fill.scale.set(h.r * fk, 1, h.r * fk);
      it.fill.material.opacity = flash ? 0.9 : h.trap ? 0.3 + 0.2 * k : 0.3 + 0.25 * k;
      it.fill.material.color.setHex(flash ? 0xfff0d0 : h.trap ? 0xff8030 : 0xff4a2a);
      it.base.material.opacity = flash ? 0.5 : 0.2 + 0.15 * k;
      if (kind === 'ring') it.fill.material.opacity *= 0.35 + 0.65 * k;
    }
    for (const [id, it] of this.items) if (it.seen !== this.frame) { this.scene.remove(it.grp); this.items.delete(id); }
  }
  clear() { for (const it of this.items.values()) this.scene.remove(it.grp); this.items.clear(); }
}
