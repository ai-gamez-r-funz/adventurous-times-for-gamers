// Builds and animates the visual layer of a chamber. Visual geometry is separate from collision (sim/grid.js):
// nothing here decides gameplay. Near walls are kept low so they never hide the player; tall props fade instead.
import * as THREE from 'three';
import { stoneTexture, glyphTexture, radialTexture, flameTexture, crackTexture, bannerTexture } from './textures.js';
import { RNG, dirOf } from '../core/util.js';

const FACE = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const SIGIL_COLOR = { ash: 0xff7a30, bone: 0xe8e0c8, mourning: 0x7ab6ff };
const GLYPH_COLOR = [0xffc060, 0xff7040, 0x7ad0ff, 0xb08aff];
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.9, metalness: o.m ?? 0.05, flatShading: true, emissive: o.e ?? 0, emissiveIntensity: o.ei ?? 1, transparent: !!o.t, opacity: o.o ?? 1, map: o.map ?? null, side: o.side ?? THREE.FrontSide });
const B = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const C = (rt, rb, h, m, seg = 8) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
const put = (o, x, y, z) => { o.position.set(x, y, z); return o; };
const glow = (color, size, opacity = 0.9) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,255,255,1)'), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(size, size, 1); return s;
};
function flameSprite(size = 0.6) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95 }));
  s.scale.set(size, size * 1.45, 1); s.center.set(0.5, 0.1); return s;
}

export class ChamberView {
  constructor(game, chamber, scene, lights) {
    this.game = game; this.ch = chamber; this.scene = scene; this.lights = lights;
    this.group = new THREE.Group(); this.group.name = `chamber:${chamber.id}`;
    scene.add(this.group);
    this.anims = []; this.occluders = []; this.props = new Map(); this.emitterIds = []; this.flames = [];
    this.mood = chamber.def.mood;
    this.rng = new RNG(chamber.id.length * 131 + 7);
    this.buildStatic();
    this.buildEntities();
  }

  // ------------------------------------------------------------ floors & walls
  buildStatic() {
    const g = this.ch.grid, mood = this.mood;
    const tint = new THREE.Color(mood.accent).multiplyScalar(0.18).add(new THREE.Color(0.8, 0.8, 0.82));
    const floorMat = M(0xffffff, { map: stoneTexture('floor', [96, 94, 108], this.ch.id.length), r: 0.95 });
    const wallMat = M(0xffffff, { map: stoneTexture('wall', [78, 74, 90], 5 + this.ch.id.length), r: 0.95 });
    const capMat = M(0x3a3644, { r: 1 });
    const floors = [], nearW = [], farW = [];
    for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w; x++) {
      if (g.isFloor(x, z)) floors.push([x, z]);
      else if (g.isWall(x, z)) {
        // camera sits to the SE; a wall with floor to its N/W lies between camera and that floor -> keep it low.
        const nearSide = g.isFloor(x, z - 1) || g.isFloor(x - 1, z) || g.isFloor(x - 1, z - 1) || g.isFloor(x + 1, z - 1) || g.isFloor(x - 1, z + 1);
        (nearSide ? nearW : farW).push([x, z]);
      }
    }
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    const fl = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.3, 1), floorMat, floors.length);
    floors.forEach(([x, z], i) => {
      dummy.position.set(x + 0.5, -0.15, z + 0.5); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); fl.setMatrixAt(i, dummy.matrix);
      let ao = 1; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!g.isFloor(x + dx, z + dz)) ao -= 0.09;
      const v = (0.86 + this.rng.next() * 0.16) * ao;
      col.copy(tint).multiplyScalar(v); fl.setColorAt(i, col);
    });
    fl.receiveShadow = false; this.group.add(fl); this.floorMesh = fl;
    const mkWalls = (list, h, name) => {
      const geom = new THREE.BoxGeometry(1, h, 1);
      const uv = geom.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * h);
      const mesh = new THREE.InstancedMesh(geom, [wallMat, wallMat, capMat, wallMat, wallMat, wallMat], list.length);
      list.forEach(([x, z], i) => {
        dummy.position.set(x + 0.5, h / 2 - 0.3, z + 0.5); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        col.copy(tint).multiplyScalar(0.62 + this.rng.next() * 0.28); mesh.setColorAt(i, col);
      });
      mesh.name = name; this.group.add(mesh); return mesh;
    };
    if (nearW.length) this.nearWalls = mkWalls(nearW, 1.15, 'wall-near');
    if (farW.length) this.farWalls = mkWalls(farW, 3.7, 'wall-far');
    this.disposables = [fl, this.nearWalls, this.farWalls].filter(Boolean);
  }

  // ------------------------------------------------------------ entities
  buildEntities() {
    const ch = this.ch, def = ch.def;
    for (const e of def.entities) {
      switch (e.t) {
        case 'torch': this.torch(e); break;
        case 'pillar': this.pillar(e); break;
        case 'banner': break;
        case 'mural': this.mural(e); break;
        case 'prop': this.decor(e); break;
        default: break;
      }
    }
    for (const e of def.entities) if (e.t === 'prop' && e.kind === 'banner') this.banner(e);
    for (const d of ch.doors) this.door(d);
    for (const gate of ch.gates.values()) this.gate(gate);
    for (const p of ch.props.values()) this.prop(p);
    if (def.autoTorches) this.autoTorches(def.autoTorches);
  }

  addEmitter(id, spec, object) {
    this.lights.register({ id: `${this.ch.id}:${id}`, object, ...spec });
    this.emitterIds.push(`${this.ch.id}:${id}`);
  }

  torch(e) {
    const [nx, nz] = FACE[e.face];
    const g = new THREE.Group();
    const iron = M(0x24222a, { m: 0.6 });
    g.add(put(B(0.1, 0.5, 0.1, iron), 0, 0, 0)); g.add(put(C(0.12, 0.07, 0.14, iron, 6), 0, 0.3, 0));
    const f = flameSprite(0.5); f.position.y = 0.38; g.add(f); this.flames.push({ s: f, base: 0.5, seed: Math.random() * 9 });
    const halo = glow(0xff8a30, 1.3, 0.35); halo.position.y = 0.4; g.add(halo);
    g.position.set(e.x + 0.5 + nx * 0.42, 1.9, e.z + 0.5 + nz * 0.42);
    this.group.add(g);
    this.addEmitter(`torch:${e.x},${e.z}`, { type: 'torch', color: 0xff9440, intensity: 30, range: 13, flicker: 0.28, offset: [nx * 0.3, 0.15, nz * 0.3], enabled: () => true }, g);
  }
  autoTorches(n) {
    const g = this.ch.grid, cand = [];
    for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w; x++) {
      if (!g.isWall(x, z)) continue;
      for (const [f, [dx, dz]] of Object.entries(FACE)) if (g.isFloor(x + dx, z + dz) && !g.isFloor(x - dx, z - dz)) { cand.push({ x, z, face: f, a: Math.atan2(z - 17, x - 20) }); break; }
    }
    cand.sort((p, q) => p.a - q.a);
    const used = [];
    for (let i = 0; i < n; i++) { const c = cand[Math.floor((i / n) * cand.length)]; if (c) { used.push(c); this.torch({ ...c }); } }
  }

  pillar(e) {
    const stone = M(0x6a6676, { map: stoneTexture('wall', [92, 88, 104], 3) });
    const g = new THREE.Group();
    g.add(put(B(0.92, 0.35, 0.92, stone), 0, 0.17, 0)); g.add(put(C(0.34, 0.4, 3.4, stone, 8), 0, 2.0, 0)); g.add(put(B(0.98, 0.3, 0.98, stone), 0, 3.85, 0));
    g.add(put(B(0.7, 0.18, 0.7, stone), 0, 3.6, 0));
    g.position.set(e.x + 0.5, 0, e.z + 0.5);
    this.group.add(g);
    this.occluders.push({ obj: g, x: e.x + 0.5, z: e.z + 0.5, mats: g.children.map((c) => c.material), a: 1 });
  }

  banner(e) {
    const [nx, nz] = FACE[e.face];
    const m = new THREE.MeshStandardMaterial({ map: bannerTexture(), side: THREE.DoubleSide, roughness: 1, transparent: true });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.7), m);
    p.position.set(e.x + 0.5 + nx * 0.5, 2.0, e.z + 0.5 + nz * 0.5);
    p.rotation.y = Math.atan2(nx, nz);
    this.group.add(p);
    this.anims.push((dt, t) => { p.rotation.z = Math.sin(t * 1.3 + e.x) * 0.03; });
  }
  mural(e) {
    const [nx, nz] = FACE[e.face];
    const g = new THREE.Group();
    g.add(B(2.5, 0.9, 0.08, M(0x2c2833)));
    e.glyphs.forEach((gi, i) => {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: glyphTexture(gi, '#ffd08a'), transparent: true, depthWrite: false }));
      pl.position.set(-0.9 + i * 0.6, 0, 0.05); g.add(pl);
      if (i < e.glyphs.length - 1) { const dot = new THREE.Mesh(new THREE.CircleGeometry(0.04, 6), new THREE.MeshBasicMaterial({ color: 0xffb060 })); dot.position.set(-0.6 + i * 0.6, 0, 0.05); g.add(dot); }
    });
    g.position.set(e.x + 0.5 + nx * 0.5, 1.9, e.z + 0.5 + nz * 0.5); g.rotation.y = Math.atan2(nx, nz);
    this.group.add(g);
  }

  decor(e) {
    const stone = M(0x4a4756), bone = M(0xcfc8b2), cloth = M(0x2c2a34, { side: THREE.DoubleSide });
    const g = new THREE.Group();
    const cx = e.x + 0.5, cz = e.z + 0.5;
    if (e.kind === 'bones') {
      const r = new RNG(e.x * 17 + e.z);
      for (let i = 0; i < 7; i++) { const b = B(0.05 + r.next() * 0.04, 0.04, 0.3 + r.next() * 0.2, bone); b.position.set(r.range(-0.35, 0.35), 0.03, r.range(-0.35, 0.35)); b.rotation.y = r.range(0, 6.28); g.add(b); }
      const sk = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), bone); sk.position.set(r.range(-0.2, 0.2), 0.08, r.range(-0.2, 0.2)); g.add(sk);
    } else if (e.kind === 'sarcophagus') {
      g.add(put(B(0.8, 0.5, 1.5, stone), 0, 0.25, 0)); g.add(put(B(0.9, 0.12, 1.6, M(0x5a5766)), 0, 0.56, 0)); g.add(put(B(0.3, 0.1, 0.9, M(0x6a6676)), 0, 0.68, 0));
      if (e.rot) g.rotation.y = Math.PI / 2;
    } else if (e.kind === 'statue') {
      const st = M(0x5a5868, { m: 0.2 });
      g.add(put(B(0.8, 0.4, 0.8, stone), 0, 0.2, 0)); g.add(put(new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.5, 6), st), 0, 1.15, 0)); g.add(put(new THREE.Mesh(new THREE.SphereGeometry(0.17, 6, 5), st), 0, 2.0, 0.03));
      g.add(put(B(0.18, 0.6, 0.18, st), -0.34, 1.3, 0.2)); g.add(put(B(0.18, 0.6, 0.18, st), 0.34, 1.3, 0.2)); g.children[3].rotation.x = -0.6; g.children[4].rotation.x = -0.6;
      g.add(put(B(0.07, 0.07, 0.07, M(0x88ffff, { e: 0x66ffff, ei: 2 })), 0.0, 2.02, 0.19));
    } else if (e.kind === 'brazier') {
      return this.brazierMesh(e.x, e.z, { id: `decor:${e.x},${e.z}`, always: true });
    } else if (e.kind === 'banner') return;
    g.position.set(cx, 0, cz); this.group.add(g);
    void cloth;
  }

  brazierMesh(cx, cz, { id, always = false, getLit }) {
    const iron = M(0x2a2830, { m: 0.6 });
    const g = new THREE.Group();
    g.add(put(C(0.07, 0.1, 0.9, iron, 6), 0, 0.45, 0)); g.add(put(C(0.38, 0.2, 0.28, iron, 8), 0, 1.0, 0)); g.add(put(C(0.3, 0.3, 0.05, M(0x1a1010, { e: 0x401008, ei: 1 }), 8), 0, 1.13, 0));
    for (let i = 0; i < 3; i++) g.add(put(B(0.05, 0.4, 0.05, iron), Math.cos(i * 2.1) * 0.15, 0.2, Math.sin(i * 2.1) * 0.15));
    const f = flameSprite(0.95); f.position.y = 1.15; g.add(f);
    const halo = glow(0xff8030, 2.0, 0.4); halo.position.y = 1.35; g.add(halo);
    g.position.set(cx + 0.5, 0, cz + 0.5);
    this.group.add(g);
    const lit = () => (always ? true : getLit());
    this.anims.push((dt, t) => {
      const on = lit();
      f.visible = on; halo.visible = on;
      if (on) { f.scale.set(0.95 * (1 + Math.sin(t * 11 + cx) * 0.08), 1.38 * (1 + Math.sin(t * 8 + cz) * 0.12), 1); }
    });
    this.addEmitter(`brazier:${id}`, { type: 'brazier', color: 0xff8a38, intensity: 36, range: 14, flicker: 0.25, offset: [0, 0.2, 0], enabled: lit }, f);
    return { obj: g, f };
  }

  // ------------------------------------------------------------ doors & gates
  door(d) {
    const e = d.def, [nx, nz] = FACE[e.face];
    const accent = this.mood.accent;
    const stone = M(0x5a5668, { map: stoneTexture('wall', [86, 82, 98], 9) });
    const g = new THREE.Group();
    const low = e.face === 's' || e.face === 'e'; // camera-facing sides stay low so they never hide the player
    const w = e.w, H = low ? 1.25 : 3.3;
    // cells beyond the trigger row: centre of the opening on the wall line
    const last = e.axis === 'x' ? { x: e.x + w / 2, z: e.z + 0.5 } : { x: e.x + 0.5, z: e.z + w / 2 };
    const cx = last.x + nx, cz = last.z + nz;
    const post = (s) => { const p = B(0.5, H, 1.15, stone); p.position.set(s * (w / 2 + 0.05), H / 2 - 0.3, 0); return p; };
    const inner = new THREE.Group();
    inner.add(post(-1)); inner.add(post(1));
    const lintel = B(w + 0.9, 0.6, 1.15, stone); lintel.position.y = H - 0.3 + 0.3; inner.add(lintel);
    if (!low) { for (const s of [-1, 1]) { const ang = new THREE.Mesh(new THREE.BoxGeometry(w * 0.34, 0.5, 1.1), stone); ang.position.set(s * w * 0.22, H + 0.1, 0); ang.rotation.z = -s * 0.5; inner.add(ang); }
    inner.add(put(B(0.4, 0.7, 1.05, M(0x7a7688)), 0, H + 0.62, 0)); }
    // dark portal with accent glow
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(w, H - 0.2), new THREE.MeshBasicMaterial({ color: 0x050408 }));
    portal.position.set(0, (H - 0.2) / 2 - 0.2, 0.1); inner.add(portal);
    const aura = new THREE.Mesh(new THREE.PlaneGeometry(w, H - 0.4), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    aura.position.set(0, (H - 0.4) / 2 - 0.1, 0.13); inner.add(aura);
    // inner is built in a local frame where +z points out of the wall into the room; rotate to face the room
    inner.rotation.y = Math.atan2(-nx, -nz);
    g.add(inner);
    if (e.lock) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 6, 24), new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.85 }));
      ring.position.set(0, 1.5, 0.35); inner.add(ring);
      const seal = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.2, H - 0.5), new THREE.MeshStandardMaterial({ color: 0x2a1418, emissive: 0x501018, emissiveIntensity: 0.8, side: THREE.DoubleSide }));
      seal.position.set(0, (H - 0.5) / 2, 0.3); inner.add(seal);
      const runes = []; for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), new THREE.MeshBasicMaterial({ color: 0xff3030 })); r.position.set((i - 1) * 0.8, 1.5, 0.33); inner.add(r); runes.push(r); }
      d.seal = { seal, ring, runes };
      this.anims.push((dt, t) => {
        const open = !!this.ch.flags.sanctum_unsealed;
        seal.visible = !open; ring.material.color.setHex(open ? 0xffd070 : 0xff4040);
        const n = this.game.progress.sigils.length;
        runes.forEach((r, i) => r.material.color.setHex(i < n ? 0xffd070 : 0x502020));
        ring.rotation.z = t * 0.4;
      });
    }
    g.position.set(cx, 0, cz);
    this.group.add(g);
    // soft light spill from the doorway so exits read as exits (emitter = the glowing portal)
    this.addEmitter(`door:${e.id}`, { type: 'portal', color: accent, intensity: 4.5, range: 6, flicker: 0.1, offset: [-nx * 1.5, 1.2, -nz * 1.5], enabled: () => !e.lock || !!this.ch.flags.sanctum_unsealed }, portal);
  }

  gate(gate) {
    const g = new THREE.Group();
    const iron = M(0x2c2a34, { m: 0.7, r: 0.5 });
    const stone = M(0x56526a, { map: stoneTexture('wall', [86, 82, 98], 4) });
    const bars = [];
    const xs = gate.cells.map((c) => c[0]), zs = gate.cells.map((c) => c[1]);
    const axisX = new Set(zs).size === 1; // cells run along x
    for (const [x, z] of gate.cells) {
      const cell = new THREE.Group();
      if (gate.style === 'seal') {
        const slab = B(1, 3.2, 0.5, M(0x3e3a4c, { map: stoneTexture('wall', [70, 64, 84], 8), e: 0x201020, ei: 0.5 }));
        slab.position.y = 1.3;
        const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: glyphTexture(1, '#ff7a50'), transparent: true, depthWrite: false })); rune.position.set(0, 1.6, axisX ? 0.26 : 0); if (!axisX) { rune.rotation.y = Math.PI / 2; rune.position.set(0.26, 1.6, 0); }
        cell.add(slab); cell.add(rune); if (!axisX) slab.rotation.y = Math.PI / 2;
        bars.push({ obj: cell, kind: 'slab' });
      } else {
        for (let i = 0; i < 5; i++) {
          const bar = C(0.04, 0.04, 3.0, iron, 5); bar.geometry = bar.geometry.clone(); bar.geometry.translate(0, -1.5, 0);
          bar.position.set(axisX ? -0.4 + i * 0.2 : 0, 3.0, axisX ? 0 : -0.4 + i * 0.2);
          cell.add(bar); bars.push({ obj: bar, kind: 'bar' });
        }
        const rail = B(axisX ? 1 : 0.06, 0.06, axisX ? 0.06 : 1, iron); rail.position.y = 1.2; cell.add(rail); bars.push({ obj: rail, kind: 'rail' });
        const rail2 = rail.clone(); rail2.position.y = 2.2; cell.add(rail2); bars.push({ obj: rail2, kind: 'rail' });
      }
      cell.position.set(x + 0.5, 0, z + 0.5);
      g.add(cell);
    }
    // lintel + posts so a raised portcullis has somewhere to live
    if (gate.style !== 'seal') {
      const minx = Math.min(...xs), maxx = Math.max(...xs), minz = Math.min(...zs), maxz = Math.max(...zs);
      const lw = axisX ? maxx - minx + 1.2 : 0.5, ld = axisX ? 0.5 : maxz - minz + 1.2;
      const lintel = B(lw, 0.5, ld, stone); lintel.position.set((minx + maxx) / 2 + 0.5, 3.3, (minz + maxz) / 2 + 0.5); g.add(lintel);
    }
    this.group.add(g);
    this.anims.push((dt, t) => {
      const a = gate.anim;
      for (const b of bars) {
        if (b.kind === 'bar') b.obj.scale.y = Math.max(0.03, a);
        else if (b.kind === 'rail') b.obj.visible = a > 0.5;
        else if (b.kind === 'slab') b.obj.position.y = (a - 1) * 3.4;
      }
    });
  }

  // ------------------------------------------------------------ interactive props
  prop(p) {
    const fn = this[`p_${p.t}`];
    if (fn) { const r = fn.call(this, p); if (r) this.props.set(p.id, r); }
  }

  p_chest(p) {
    const wood = M(0x4a2f1c, { map: stoneTexture('wall', [74, 46, 28], 12) }), iron = M(0x2a2830, { m: 0.7 }), gold = M(0xc9a24a, { m: 0.8, r: 0.35, e: 0x403010, ei: 0.5 });
    const g = new THREE.Group();
    g.add(put(B(0.92, 0.46, 0.6, wood), 0, 0.23, 0));
    const lidPivot = new THREE.Group(); lidPivot.position.set(0, 0.46, -0.28); g.add(lidPivot);
    const lid = B(0.94, 0.2, 0.62, wood); lid.position.set(0, 0.1, 0.28); lidPivot.add(lid);
    lidPivot.add(put(B(0.98, 0.05, 0.1, iron), 0, 0.12, 0.28)); g.add(put(B(0.1, 0.5, 0.64, iron), -0.3, 0.25, 0)); g.add(put(B(0.1, 0.5, 0.64, iron), 0.3, 0.25, 0));
    g.add(put(B(0.14, 0.14, 0.05, gold), 0, 0.44, 0.31));
    const hl = glow(0xffd070, 1.6, 0.5); hl.position.y = 0.5; g.add(hl);
    g.position.set(p.x, 0, p.z); if (p.def.relic) g.rotation.y = 0.3;
    this.group.add(g);
    return { obj: g, update: (dt, t) => {
      const show = !p.hidden; g.visible = show;
      const target = p.opened ? -1.25 : 0; lidPivot.rotation.x += (target - lidPivot.rotation.x) * Math.min(1, dt * 7);
      hl.visible = !p.opened; hl.material.opacity = 0.35 + Math.sin(t * 3) * 0.15;
      if (p.hidden) { g.scale.setScalar(0.01); } else g.scale.setScalar(Math.min(1, g.scale.x + dt * 3 + 0.001));
    } };
  }

  p_lore(p) {
    const stone = M(0x4e4a5c);
    const g = new THREE.Group();
    g.add(put(B(0.8, 0.14, 0.4, stone), 0, 0.07, 0)); const slab = B(0.6, 1.0, 0.14, stone); slab.position.set(0, 0.62, 0); slab.rotation.x = -0.1; g.add(slab);
    const runeMat = new THREE.MeshBasicMaterial({ color: 0x7ad0ff });
    for (let i = 0; i < 4; i++) g.add(put(B(0.4 - (i % 2) * 0.12, 0.025, 0.02, runeMat), 0, 0.9 - i * 0.14, 0.085));
    g.position.set(p.x, 0, p.z); g.rotation.y = this.rng.range(-0.3, 0.3);
    this.group.add(g);
    return { obj: g, update: (dt, t) => { const read = this.game.progress.lore.includes(p.def.lore); runeMat.color.setHex(read ? 0x4a6070 : 0x7ad0ff); runeMat.opacity = 1; } };
  }

  p_waystone(p) {
    const stone = M(0x3e3c4c, { map: stoneTexture('wall', [60, 60, 78], 21) });
    const rune = new THREE.MeshBasicMaterial({ color: 0x78c8ff });
    const g = new THREE.Group();
    g.add(put(C(0.7, 0.8, 0.2, stone, 8), 0, 0.1, 0));
    const ob = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 1.9, 5), stone); ob.position.y = 1.15; g.add(ob);
    for (let i = 0; i < 3; i++) g.add(put(B(0.08, 0.22, 0.02, rune), 0, 0.7 + i * 0.4, 0.34 - i * 0.05));
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), new THREE.MeshBasicMaterial({ color: 0x9ae0ff })); g.add(shard);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.1, 32), new THREE.MeshBasicMaterial({ color: 0x78c8ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
    g.position.set(p.x, 0, p.z); this.group.add(g);
    this.addEmitter(`way:${p.id}`, { type: 'waystone', color: 0x78c8ff, intensity: 20, range: 10, flicker: 0.06, offset: [0, 0.8, 0.3], enabled: () => true }, shard);
    return { obj: g, update: (dt, t) => { shard.position.y = 2.4 + Math.sin(t * 1.6) * 0.1; shard.rotation.y = t; ring.material.opacity = 0.35 + Math.sin(t * 2) * 0.15; const active = this.game.progress.checkpoint.spawn === `way:${p.id}`; rune.color.setHex(active ? 0xaaf0ff : 0x5a8aa8); } };
  }

  p_altar(p) {
    const col = SIGIL_COLOR[p.def.sigil];
    const stone = M(0x403c50);
    const g = new THREE.Group();
    g.add(put(C(0.5, 0.6, 0.7, stone, 6), 0, 0.35, 0));
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), new THREE.MeshBasicMaterial({ color: col })); g.add(gem);
    const halo = glow(col, 2.2, 0.55); g.add(halo);
    g.position.set(p.x, 0, p.z); this.group.add(g);
    const shown = () => !p.hidden && !this.game.progress.sigils.includes(p.def.sigil);
    this.addEmitter(`altar:${p.id}`, { type: 'altar', color: col, intensity: 9, range: 6, flicker: 0.1, offset: [0, 0.4, 0], enabled: shown }, gem);
    return { obj: g, update: (dt, t) => { const s = shown(); gem.visible = s; halo.visible = s; gem.position.y = 1.2 + Math.sin(t * 2) * 0.1; gem.rotation.y = t * 1.2; halo.position.y = gem.position.y; g.visible = !p.hidden; } };
  }

  p_urn(p) {
    const clay = M(0x6a4a34, { map: stoneTexture('wall', [100, 66, 44], 33) });
    const pts = [[0, 0], [0.22, 0], [0.3, 0.18], [0.34, 0.4], [0.24, 0.62], [0.16, 0.74], [0.2, 0.8], [0, 0.8]].map(([x, y]) => new THREE.Vector2(x, y));
    const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 8), clay);
    m.position.set(p.x, 0, p.z); m.rotation.y = this.rng.range(0, 6);
    this.group.add(m);
    return { obj: m, update: () => { m.visible = !p.broken; } };
  }

  p_cracked(p) {
    const mt = M(0xffffff, { map: crackTexture(), e: 0x401408, ei: 0.4 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.98, 1.5, 0.98), mt);
    m.position.set(p.x, 0.45, p.z);
    this.group.add(m);
    return { obj: m, update: (dt, t) => { m.visible = !p.broken; mt.emissiveIntensity = 0.4 + Math.sin(t * 2.2) * 0.15 + (p.hitFlash > 0 ? 3 : 0); m.position.x = p.x + (p.hitFlash > 0 ? Math.sin(t * 90) * 0.03 : 0); } };
  }

  p_brazier(p) {
    const r = this.brazierMesh(p.def.x, p.def.z, { id: p.id, getLit: () => p.lit });
    // glyph plaque on the stand
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: glyphTexture(p.glyph, '#ffffff'), transparent: true, color: 0xffd8a0, depthWrite: false }));
    pl.position.set(0, 0.62, 0.12); r.obj.add(pl);
    return { obj: r.obj, update: () => { pl.material.color.setHex(p.lit ? 0xfff0c0 : 0x9a7a60); } };
  }

  p_glyph(p) {
    const col = GLYPH_COLOR[p.idx];
    const g = new THREE.Group();
    g.add(put(B(0.92, 0.06, 0.92, M(0x3a3646)), 0, 0.03, 0));
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: glyphTexture(p.idx, '#ffffff'), transparent: true, color: 0x50607a, depthWrite: false }));
    decal.rotation.x = -Math.PI / 2; decal.position.y = 0.075; g.add(decal);
    g.position.set(p.x, 0, p.z); this.group.add(g);
    this.addEmitter(`glyph:${p.id}`, { type: 'glyph', color: col, intensity: 8, range: 5.5, flicker: 0, offset: [0, 0.6, 0], enabled: () => p.lit > 0 || p.err > 0 }, decal);
    return { obj: g, update: () => { decal.material.color.setHex(p.err > 0 ? 0xff3030 : p.lit > 0 ? col : 0x50607a); } };
  }

  p_block(p) {
    const stone = M(0x57536a, { map: stoneTexture('wall', [84, 80, 100], 41) }), iron = M(0x2a2830, { m: 0.7 });
    const g = new THREE.Group();
    g.add(put(B(0.92, 0.78, 0.92, stone), 0, 0.39, 0)); g.add(put(B(0.8, 0.12, 0.8, M(0x6a667c)), 0, 0.84, 0)); g.add(put(B(0.3, 0.16, 0.5, M(0x7a768c)), 0, 0.95, 0));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(put(B(0.12, 0.8, 0.12, iron), sx * 0.44, 0.4, sz * 0.44));
    g.position.set(p.x, 0, p.z); this.group.add(g);
    return { obj: g, update: () => {
      const k = p.slideT > 0 ? 1 - p.slideT / (p.slideDur || 0.24) : 1;
      const e = k * k * (3 - 2 * k);
      g.position.x = p.fromX + (p.x - p.fromX) * e; g.position.z = p.fromZ + (p.z - p.fromZ) * e;
      if (!(p.slideT > 0)) { g.position.x = p.x; g.position.z = p.z; }
    } };
  }

  p_plate(p) {
    const g = new THREE.Group();
    const base = B(0.9, 0.05, 0.9, M(0x2c2a36)); base.position.y = 0.025; g.add(base);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 20), new THREE.MeshBasicMaterial({ color: 0x6a88a8, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
    g.position.set(p.x, 0, p.z); this.group.add(g);
    this.addEmitter(`plate:${p.id}`, { type: 'plate', color: 0xffd070, intensity: 5, range: 4, flicker: 0.05, offset: [0, 0.8, 0], enabled: () => !!p.pressed }, ring);
    return { obj: g, update: () => { ring.material.color.setHex(p.pressed ? 0xffd070 : 0x6a88a8); } };
  }

  p_pedestal(p) {
    const g = new THREE.Group();
    g.add(put(C(0.38, 0.5, 0.9, M(0x403c50), 6), 0, 0.45, 0));
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: 0x9ad0ff })); g.add(orb);
    g.position.set(p.x, 0, p.z); this.group.add(g);
    const pz = this.ch.puzzleOf(p.def.puzzle);
    this.addEmitter(`ped:${p.id}`, { type: 'pedestal', color: 0x9ad0ff, intensity: 7, range: 6, flicker: 0.08, offset: [0, 0.4, 0], enabled: () => !pz.solved }, orb);
    return { obj: g, update: (dt, t) => { orb.position.y = 1.25 + Math.sin(t * 2) * 0.08; orb.rotation.y = t; orb.material.color.setHex(pz.solved ? 0x506070 : pz.state === 'showing' ? 0xffffff : 0x9ad0ff); } };
  }

  p_resetrune(p) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 6), new THREE.MeshBasicMaterial({ color: 0x78c8ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
    g.add(put(C(0.3, 0.36, 0.5, M(0x403c50), 6), 0, 0.25, 0));
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: 0x9ae0ff })); orb.position.y = 0.72; g.add(orb);
    g.position.set(p.x, 0, p.z); this.group.add(g);
    return { obj: g, update: (dt, t) => { orb.rotation.y = t * 2; ring.rotation.z = t * 0.5; } };
  }

  p_socket(p) {
    const col = SIGIL_COLOR[p.def.sigil];
    const g = new THREE.Group();
    g.add(put(C(0.2, 0.28, 1.1, M(0x433f52), 6), 0, 0.55, 0));
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), new THREE.MeshBasicMaterial({ color: 0x302830 })); gem.position.y = 1.3; g.add(gem);
    g.position.set(p.x, 0, p.z); this.group.add(g);
    this.addEmitter(`sock:${p.id}`, { type: 'socket', color: col, intensity: 5, range: 4.5, flicker: 0.1, offset: [0, 0.3, 0.2], enabled: () => this.game.progress.sigils.includes(p.def.sigil) }, gem);
    return { obj: g, update: (dt, t) => { const has = this.game.progress.sigils.includes(p.def.sigil); gem.material.color.setHex(has ? col : 0x302830); gem.rotation.y = t; } };
  }

  p_flame(p) {
    const g = new THREE.Group();
    const iron = M(0x2a2830, { m: 0.6 });
    g.add(put(C(0.9, 1.1, 0.5, M(0x3a3646), 8), 0, 0.25, 0)); g.add(put(C(0.7, 0.45, 0.5, iron, 8), 0, 0.75, 0));
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ color: 0x601810 })); ember.position.y = 1.0; g.add(ember);
    const fl = flameSprite(2.0); fl.position.y = 1.0; g.add(fl);
    g.position.set(p.x, 0, p.z); this.group.add(g);
    const lit = () => !!this.ch.flags.bishop_slain;
    this.addEmitter('vigil', { type: 'vigil', color: 0xffb060, intensity: 42, range: 18, flicker: 0.12, offset: [0, 0.8, 0], enabled: lit }, fl);
    this.addEmitter('vigil-ember', { type: 'ember', color: 0xff3a20, intensity: 5, range: 5, flicker: 0.2, offset: [0, 0.4, 0], enabled: () => !lit() }, ember);
    return { obj: g, update: (dt, t) => { const on = lit(); fl.visible = on; ember.material.color.setHex(on ? 0xffd080 : 0x601810 + (Math.sin(t * 2) > 0 ? 0x100800 : 0)); if (on) fl.scale.set(2.0 * (1 + Math.sin(t * 9) * 0.06), 2.9 * (1 + Math.sin(t * 7) * 0.1), 1); } };
  }

  // ------------------------------------------------------------ per-frame
  update(dt, t, player, camAz) {
    for (const a of this.anims) a(dt, t);
    for (const p of this.props.values()) p.update?.(dt, t);
    for (const f of this.flames) { f.s.scale.set(f.base * (1 + Math.sin(t * 12 + f.seed) * 0.1), f.base * 1.45 * (1 + Math.sin(t * 9 + f.seed * 2) * 0.14), 1); }
    // occluding props fade when they stand between the camera (SE) and the player
    for (const o of this.occluders) {
      const dx = o.x - player.x, dz = o.z - player.z;
      const nearCam = dx + dz; // >0 => closer to the SE camera than the player
      const lateral = Math.abs(dx - dz) / Math.SQRT2;
      const want = nearCam > 0.2 && nearCam < 8 && lateral < 1.7 ? 0.22 : 1;
      o.a += (want - o.a) * Math.min(1, dt * 9);
      for (const m of o.mats) { const tr = o.a < 0.98; if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } m.opacity = o.a; m.depthWrite = !tr; }
    }
    void camAz; void dirOf;
  }

  dispose() {
    for (const id of this.emitterIds) this.lights.unregister(id);
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose?.(); if (o.material) { for (const m of [].concat(o.material)) m.dispose?.(); } });
  }
}
