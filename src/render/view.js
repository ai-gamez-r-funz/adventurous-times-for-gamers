// GameView: turns simulation state + events into a Three.js scene. Read-only with respect to gameplay.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { clamp, lerpAngle, dirOf } from '../core/util.js';
import { createRig, poseRig, setFlash } from './rigs.js';
import { ChamberView } from './chamberView.js';
import { LightRig } from './lights.js';
import { Particles, Decals, Beams, Telegraphs } from './vfx.js';
import { radialTexture } from './textures.js';
import { RARITY } from '../data/items.js';

const VISUAL_SCALE = { bishop: 1.5, brute: 1.15, oathbound: 1.0, cinderwitch: 1.0 };
const ELITE_COLOR = { frenzied: 0xff4030, bulwark: 0x4aa0ff, vengeful: 0xb050ff };
const CAM_DIR = new THREE.Vector3(0.454, 0.766, 0.454);

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.55 }, uHurt: { value: 0 }, uTint: { value: new THREE.Vector3(1.0, 0.97, 1.06) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; uniform float uVig; uniform float uHurt; uniform vec3 uTint; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); float d = distance(vUv, vec2(0.5)); float v = smoothstep(0.32, 0.95, d); c.rgb *= uTint; c.rgb *= 1.0 - v*uVig; c.rgb = mix(c.rgb, vec3(0.7,0.02,0.02)*(0.4+v), uHurt*v*0.8); gl_FragColor = c; }',
};

export class GameView {
  constructor(canvas, { quality = 'high', mobile = false } = {}) {
    this.canvas = canvas; this.mobile = mobile; this.quality = quality; this.reducedMotion = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance', alpha: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.35;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07060a);
    this.scene.fog = new THREE.FogExp2(0x0a0a10, 0.012);
    this.hemi = new THREE.HemisphereLight(0x6a6a90, 0x1a1620, 2.6); this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x9aa0d0, 1.5); this.moon.position.set(-8, 14, -6); this.scene.add(this.moon);
    this.camera = new THREE.OrthographicCamera(-10, 10, 7, -7, 0.1, 120);
    this.cam = { target: new THREE.Vector3(), zoom: 1, viewH: 13, shake: 0, snap: true, look: new THREE.Vector3() };
    this.lights = new LightRig(this.scene, { poolSize: 8 });
    this.particles = new Particles(this.scene); this.decals = new Decals(this.scene); this.beams = new Beams(this.scene); this.telegraphs = new Telegraphs(this.scene);
    this.actors = new Map(); this.projectiles = new Map(); this.lootViews = new Map(); this.chamberView = null;
    this.time = 0; this.hurtFlash = 0; this.game = null; this.unsubs = []; this.hover = null;
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2(); this.tmpV = new THREE.Vector3();
    this.composer = null; this.fx = { vig: 0.55 };
    this.pxRatio = 1; this.w = 1; this.h = 1;
    this.barGeo = new THREE.PlaneGeometry(1, 1);
    this.lockTarget = null;
    this.lockRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 40), new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
    this.pushDir = null;
    const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.55, -0.4, 0, -0.1, 0.4, 0, -0.1, -0.15, 0, -0.1, -0.15, 0, -0.6, 0.15, 0, -0.6, 0.15, 0, -0.1], 3)); ag.setIndex([0, 2, 1, 3, 4, 5, 3, 5, 6]);
    this.pushArrow = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false })); this.pushArrow.renderOrder = 16; this.pushArrow.visible = false; this.scene.add(this.pushArrow);
    this.lockRing.rotation.x = -Math.PI / 2; this.lockRing.renderOrder = 15; this.lockRing.visible = false; this.scene.add(this.lockRing);
    this.setQuality(quality);
  }

  // ------------------------------------------------------------ setup
  setQuality(q) {
    this.quality = q;
    const high = q === 'high';
    this.lights.setPoolLimit(high ? 8 : 5);
    this.particles.setCap(high ? 900 : 400);
    this.pixelRatioCap = high ? (this.mobile ? 1.5 : 2) : 1;
    this.resize(this.w, this.h, true);
    if (high && !this.composer) this.buildComposer();
  }
  buildComposer() {
    const size = new THREE.Vector2(); this.renderer.getDrawingBufferSize(size);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.7, 0.82);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader); this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }
  resize(w, h, force) {
    if (!force && w === this.w && h === this.h) return;
    this.w = Math.max(1, w); this.h = Math.max(1, h);
    this.pxRatio = Math.min(window.devicePixelRatio || 1, this.pixelRatioCap ?? 1.5);
    this.renderer.setPixelRatio(this.pxRatio); this.renderer.setSize(this.w, this.h, false);
    if (this.composer) { this.composer.setPixelRatio(this.pxRatio); this.composer.setSize(this.w, this.h); }
    this.applyCameraFrustum();
  }
  applyCameraFrustum() {
    const aspect = this.w / this.h;
    const viewH = Math.max(11.5, 11 / aspect) / this.cam.zoom;
    this.cam.viewH = viewH;
    const c = this.camera;
    c.left = (-viewH * aspect) / 2; c.right = (viewH * aspect) / 2; c.top = viewH / 2; c.bottom = -viewH / 2;
    c.updateProjectionMatrix();
    this.particles.setScale((this.h * this.pxRatio) / viewH);
  }
  setZoom(z) { this.cam.zoom = clamp(z, 0.7, 1.5); this.applyCameraFrustum(); }

  bind(game) {
    this.unbind();
    this.game = game;
    const on = (t, f) => this.unsubs.push(game.on(t, f));
    on('chamber', (e) => this.onChamber(e));
    on('swing', (e) => this.onSwing(e)); on('tick', (e) => this.onTick(e));
    on('hit', (e) => this.onHit(e)); on('death', (e) => this.onDeath(e));
    on('projectile', (e) => this.onProjectile(e)); on('projectileEnd', (e) => this.onProjectileEnd(e));
    on('hazardActive', (e) => { const h = e.hazard; this.particles.burst(h.x, 0.2, h.z, { count: 22, color: 0xff7a40, speed: 4, spread: 1.2, life: 0.5 }); this.decals.circle(h.x, h.z, h.r, 0xffb070, 0.35, 0.6); this.shake(h.r > 5 ? 0.22 : 0.1); });
    on('chain', (e) => { this.beams.fire(e.points); for (const p of e.points.slice(1)) this.particles.burst(p.x, 1, p.z, { count: 8, color: 0xbfe8ff, speed: 3, life: 0.35 }); });
    on('blink', (e) => { for (const p of [e.from, e.to]) this.particles.burst(p.x, 0.8, p.z, { count: 26, color: 0xff9040, speed: 4, life: 0.5, grav: -1 }); });
    on('loot', (e) => this.particles.burst(e.loot.x, 0.3, e.loot.z, { count: 8, color: 0xffd070, speed: 2, life: 0.5 }));
    on('pickup', (e) => this.particles.burst(e.loot.x, 0.5, e.loot.z, { count: 10, color: 0xffe8a0, speed: 2.5, life: 0.45, grav: 1 }));
    on('levelup', () => { const p = game.player; this.decals.ring(p.x, p.z, 4, 0xffe090, 0.9); this.decals.ring(p.x, p.z, 2.5, 0xffffff, 0.7); for (let i = 0; i < 40; i++) this.particles.emit(p.x + (Math.random() - 0.5) * 1.2, 0.1, p.z + (Math.random() - 0.5) * 1.2, 0, 2 + Math.random() * 3, 0, 1.1, 0.14, 0xffe090, -0.5); });
    on('chestOpen', (e) => this.particles.burst(e.prop.x, 0.6, e.prop.z, { count: 30, color: 0xffd070, speed: 4, life: 0.8, grav: -3 }));
    on('break', (e) => { const col = e.kind === 'urn' ? 0x8a6a4a : 0x8a8498; this.particles.burst(e.prop.x, 0.5, e.prop.z, { count: e.kind === 'cracked' ? 40 : e.hit ? 6 : 16, color: col, speed: 3.5, life: 0.7, size: 0.18, grav: -9 }); if (e.kind === 'cracked') this.shake(0.15); });
    on('puzzle', (e) => this.onPuzzle(e));
    on('gate', (e) => { for (const [x, z] of e.gate.cells) this.particles.burst(x + 0.5, 0.2, z + 0.5, { count: 8, color: 0x9a9080, speed: 1.2, life: 0.6, size: 0.22, grav: 0.2, up: 0.4 }); if (e.closed) this.shake(0.12); });
    on('rest', () => { const p = game.player; this.decals.ring(p.x, p.z, 3, 0x78c8ff, 0.8); for (let i = 0; i < 24; i++) this.particles.emit(p.x + (Math.random() - 0.5), 0.1, p.z + (Math.random() - 0.5), 0, 1.5 + Math.random(), 0, 1.0, 0.1, 0x9ae0ff, -0.3); });
    on('spawn', (e) => { const a = e.actor; this.particles.burst(a.x, 0.2, a.z, { count: 26, color: 0x9060d0, speed: 2.5, life: 0.9, grav: 0.8 }); this.decals.ring(a.x, a.z, 1.8, 0x7040c0, 0.7); });
    on('boss', (e) => { if (e.kind === 'shift') { const a = e.actor; this.decals.ring(a.x, a.z, 7, 0xffa060, 1.0); this.shake(0.5); this.hurtFlash = 0; } if (e.kind === 'dead') { this.shake(0.6); } });
    on('windup', (e) => { if (e.move.id === 'bishop_summon') { const a = e.actor; this.particles.burst(a.x, 1.8, a.z, { count: 30, color: 0x9060d0, speed: 3, life: 1.0, grav: 0.5 }); } });
    on('playerDeath', () => { this.hurtFlash = 1; });
    on('dodged', (e) => { this.particles.burst(e.actor.x, 1, e.actor.z, { count: 12, color: 0xaad0ff, speed: 3.5, life: 0.4 }); this.decals.ring(e.actor.x, e.actor.z, 1.6, 0xaad0ff, 0.35); });
    on('potion', (e) => { const p = game.player; this.particles.burst(p.x, 0.8, p.z, { count: 18, color: e.kind === 'hp' ? 0xff5050 : 0x6090ff, speed: 2, life: 0.7, grav: 1 }); });
    on('unseal', () => this.shake(0.3));
    if (game.chamber) this.onChamber({ id: game.chamber.id, def: game.chamber.def, initial: true });
  }
  unbind() { for (const u of this.unsubs) u(); this.unsubs = []; }

  // ------------------------------------------------------------ events
  shake(a) { if (!this.reducedMotion) this.cam.shake = Math.min(1, Math.max(this.cam.shake, a)); }
  onChamber({ def, initial }) {
    const game = this.game;
    if (this.chamberView) this.chamberView.dispose();
    for (const v of this.actors.values()) this.removeActorView(v);
    this.actors.clear();
    for (const v of this.projectiles.values()) this.removeProjectileView(v);
    this.projectiles.clear();
    for (const v of this.lootViews.values()) this.scene.remove(v.obj);
    this.lootViews.clear();
    this.lights.clear(); this.telegraphs.clear(); this.decals.clear();
    const mood = def.mood;
    this.scene.background.setHex(mood.fog); this.scene.fog.color.setHex(mood.fog);
    this.hemi.color.setHex(mood.hemiSky); this.hemi.groundColor.setHex(mood.hemiGround);
    this.chamberView = new ChamberView(game, game.chamber, this.scene, this.lights);
    // bounds for camera clamp
    const g = game.chamber.grid; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w; x++) if (g.isFloor(x, z)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); z0 = Math.min(z0, z); z1 = Math.max(z1, z + 1); }
    this.bounds = { x0, x1, z0, z1 };
    this.cam.snap = true;
    void initial;
  }
  onSwing({ actor, move, action }) {
    const sh = move.shape, a = actor;
    const enemy = a.kind === 'enemy';
    const col = enemy ? 0xff9070 : a.classId === 'cinderwitch' ? 0xffa050 : 0xfff2d8;
    const f = action.face, d = dirOf(f);
    if (sh.type === 'arc') {
      this.decals.slash(a.x, a.z, f, sh.range, sh.arc, col);
      this.particles.burst(a.x + d.x * sh.range * 0.7, 0.9, a.z + d.z * sh.range * 0.7, { count: 6, color: col, speed: 3, life: 0.25, size: 0.08 });
      if (a.def?.boss) this.shake(0.2);
    } else if (sh.type === 'circle') {
      const off = sh.offset ?? 0;
      const cx = (sh.atOrigin ? action.origin.x : a.x) + d.x * off, cz = (sh.atOrigin ? action.origin.z : a.z) + d.z * off;
      if (move.id === 'frostnova') { this.decals.ring(a.x, a.z, sh.radius, 0xa0d8ff, 0.55, 0.7); this.decals.circle(a.x, a.z, sh.radius, 0x80c0ff, 0.4, 0.4); this.particles.burst(a.x, 0.4, a.z, { count: 40, color: 0xcfeaff, speed: 7, life: 0.6, spread: 1.4, up: 0.4 }); this.shake(0.12); }
      else if (move.id === 'blink') { this.decals.circle(cx, cz, sh.radius, 0xff9040, 0.4, 0.6); }
      else if (move.id === 'whirlwind') { /* handled by ticks */ }
      else { this.decals.circle(cx, cz, sh.radius, enemy ? 0xffb080 : 0xfff0d0, 0.3, 0.7); this.decals.ring(cx, cz, sh.radius * 1.15, 0xffffff, 0.4); this.particles.burst(cx, 0.1, cz, { count: 24, color: 0x9a9080, speed: 4, life: 0.6, size: 0.2, spread: 1.3, grav: -2, up: 0.5 }); this.shake(enemy ? 0.3 : 0.15); }
    } else if (sh.type === 'line') {
      this.decals.line(a.x, a.z, f, (sh.length ?? 2) + (move.move?.dist ?? 0) * 0.6, sh.width ?? 1.4, col, 0.3);
      this.particles.burst(a.x, 0.1, a.z, { count: 10, color: 0x9a9080, speed: 2, life: 0.5, size: 0.2, grav: -1, up: 0.3 });
      if (move.id === 'brute_charge') this.shake(0.25);
    } else if (sh.type === 'projectile') {
      const m = this.actors.get(a.id)?.rig.sockets.muzzle;
      const p = new THREE.Vector3(); (m ?? a).getWorldPosition?.(p);
      if (m) this.particles.burst(p.x, p.y, p.z, { count: 8, color: enemy ? 0xff8040 : 0xffb060, speed: 3, life: 0.25, size: 0.1 });
    }
    if (move.id === 'bishop_slam' || move.id === 'bishop_mace') this.shake(0.25);
  }
  onTick({ actor, move }) {
    if (move.id === 'whirlwind') { this.decals.spawn(null ?? this.ringG(), { x: actor.x, z: actor.z, rot: 0, color: 0xfff0d0, a0: 0.6, a1: 0, s0: 1.2, s1: move.shape.radius * 1.05, dur: 0.22 }); this.particles.burst(actor.x, 0.8, actor.z, { count: 10, color: 0xfff0d0, speed: 5, life: 0.25, size: 0.08, spread: 1.3 }); }
  }
  ringG() { if (!this._ringG) { this._ringG = new THREE.RingGeometry(0.78, 1, 40); this._ringG.rotateX(-Math.PI / 2); } return this._ringG; }
  onHit({ attacker, target, amount, crit, x, z, killed, poiseBreak, armored, blocked }) {
    const toPlayer = target.kind === 'player';
    const col = blocked ? 0xffd070 : toPlayer ? 0xff3030 : crit ? 0xffe070 : target.def?.tags?.includes('undead') ? 0xd8d0c0 : 0xff6040;
    this.particles.burst(x, 1.0, z, { count: crit ? 22 : 12, color: col, speed: crit ? 6 : 4, life: 0.4, size: crit ? 0.16 : 0.11 });
    if (toPlayer) { this.hurtFlash = Math.min(1, 0.45 + amount / Math.max(40, this.game.stats.maxHp * 0.4)); this.shake(0.18 + Math.min(0.3, amount / this.game.stats.maxHp)); }
    else if (killed) this.shake(target.def?.boss ? 0.5 : 0.14);
    else if (crit || poiseBreak) this.shake(0.08);
    void attacker; void armored;
  }
  onDeath({ actor }) {
    if (actor.kind === 'enemy') {
      const big = actor.def.boss ? 4 : actor.def.tags.includes('heavy') ? 2 : 1;
      this.particles.burst(actor.x, 0.8, actor.z, { count: 26 * big, color: 0xd8c8b0, speed: 4 * big, life: 0.9, size: 0.13, grav: -3 });
      this.particles.burst(actor.x, 0.5, actor.z, { count: 14 * big, color: 0xff7a30, speed: 2.5, life: 1.2, size: 0.1, grav: 1.2 });
      if (actor.def.boss) { this.decals.ring(actor.x, actor.z, 9, 0xffd090, 1.4); this.decals.ring(actor.x, actor.z, 5, 0xffffff, 1.0); }
    } else {
      this.particles.burst(actor.x, 0.8, actor.z, { count: 30, color: 0xff3030, speed: 4, life: 0.9 });
    }
  }
  onProjectile({ proj }) {
    const grp = new THREE.Group();
    const arrow = proj.kind === 'arrow';
    if (arrow) { const sh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.8), new THREE.MeshBasicMaterial({ color: 0xd8d0b8 })); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 4), new THREE.MeshBasicMaterial({ color: 0x9aa0a8 })); tip.rotation.x = Math.PI / 2; tip.position.z = 0.45; grp.add(sh); grp.add(tip); }
    else { const core = new THREE.Mesh(new THREE.SphereGeometry(proj.r * 0.8, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff0c0 })); grp.add(core); const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,255,255,1)'), color: proj.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); gl.scale.setScalar(proj.r * 5); grp.add(gl); }
    grp.position.set(proj.x, 1.0, proj.z); grp.rotation.y = proj.face;
    this.scene.add(grp);
    const v = { obj: grp, proj, emitter: null };
    if (proj.light || proj.owner !== 'player') {
      const id = `proj:${proj.id}`;
      this.lights.register({ id, type: 'projectile', object: grp, color: proj.color, intensity: arrow ? 0 : 9, range: 6, flicker: 0.2, enabled: () => !proj.dead && !arrow });
      v.emitter = id;
    }
    this.projectiles.set(proj.id, v);
  }
  removeProjectileView(v) { this.scene.remove(v.obj); if (v.emitter) this.lights.unregister(v.emitter); v.obj.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
  onProjectileEnd({ proj, x, z, wall }) {
    this.particles.burst(x, 1, z, { count: wall ? 8 : 12, color: proj.color, speed: 3.5, life: 0.35 });
    const v = this.projectiles.get(proj.id); if (v) { this.removeProjectileView(v); this.projectiles.delete(proj.id); }
  }
  onPuzzle(e) {
    const pr = e.prop;
    if (e.event === 'step' && pr) { this.particles.burst(pr.x, 1.1, pr.z, { count: 26, color: 0xffd090, speed: 4, life: 0.7, grav: -1 }); this.decals.ring(pr.x, pr.z, 2.2, 0xffd090, 0.6); }
    if (e.event === 'fail' && pr) { this.particles.burst(pr.x, 0.8, pr.z, { count: 26, color: 0xff3030, speed: 4, life: 0.6 }); this.shake(0.15); }
    if (e.event === 'solved') { const p = this.game.player; this.decals.ring(p.x, p.z, 6, 0xffe0a0, 1.2); this.shake(0.25); }
    if (e.event === 'push' && pr) { this.particles.burst(pr.x, 0.2, pr.z, { count: 10, color: 0x9a9080, speed: 1.5, life: 0.5, size: 0.2, up: 0.3 }); this.shake(0.06); }
    if (e.event === 'show' || e.event === 'step') { const g = e.prop; void g; }
  }

  // ------------------------------------------------------------ actor views
  makeActorView(sim) {
    const rig = createRig(sim.rigId);
    const grp = new THREE.Group(); grp.add(rig.root);
    const sc = (VISUAL_SCALE[sim.rigId] ?? 1) * (sim.scale ?? 1);
    rig.root.scale.setScalar(sc);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.62 * (sim.radius / 0.4), 14), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.03; grp.add(shadow);
    const v = { sim, rig, grp, shadow, face: sim.face, emitters: [], scale: sc, bar: null };
    if (sim.kind === 'player') {
      const lan = rig.sockets.lantern;
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe2a0 }));
      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2830, metalness: 0.7, wireframe: true }));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,255,255,1)'), color: 0xffd890, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.setScalar(0.5);
      lan.add(body); lan.add(cage); lan.add(halo);
      this.lights.register({ id: 'player:lantern', type: 'lantern', object: body, color: 0xffd9a0, intensity: 15, range: 11, flicker: 0.06, priority: 1, offset: [0, 0.6, 0], enabled: () => !sim.dead });
      v.emitters.push('player:lantern');
    } else if (rig.sockets.orb && (sim.rigId === 'cultist' || sim.rigId === 'bishop')) {
      const id = `orb:${sim.id}`;
      this.lights.register({ id, type: 'orb', object: rig.sockets.orb, color: 0xff8a30, intensity: sim.rigId === 'bishop' ? 10 : 5, range: sim.rigId === 'bishop' ? 8 : 5, flicker: 0.2, enabled: () => !sim.dead && sim.spawnT <= 0 });
      v.emitters.push(id);
    }
    if (sim.kind === 'enemy') {
      const bar = new THREE.Group();
      const bg = new THREE.Mesh(this.barGeo, new THREE.MeshBasicMaterial({ color: 0x120808, transparent: true, depthTest: false, opacity: 0.85 }));
      const fill = new THREE.Mesh(this.barGeo, new THREE.MeshBasicMaterial({ color: sim.elite ? 0xffc040 : 0xc42a2a, depthTest: false }));
      bg.renderOrder = 20; fill.renderOrder = 21; bg.scale.set(1.0, 0.11, 1); fill.scale.set(0.96, 0.07, 1);
      bar.add(bg); bar.add(fill); bar.position.set(0, rig.height * sc + 0.55, 0); bar.visible = false; grp.add(bar);
      v.bar = { grp: bar, fill };
    }
    if (sim.elite) {
      const col = ELITE_COLOR[sim.elite];
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 28), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.scale.setScalar(sim.radius / 0.4 * 0.9); grp.add(ring); v.eliteRing = ring;
      for (const m of rig.flashMats) { m.emissive.setHex(col); m.emissiveIntensity = 0.28; }
      v.eliteBase = true;
    }
    this.scene.add(grp);
    return v;
  }
  removeActorView(v) {
    this.scene.remove(v.grp);
    for (const id of v.emitters) this.lights.unregister(id);
    v.grp.traverse((o) => { if (o.geometry && o.geometry !== this.barGeo) o.geometry.dispose?.(); });
  }

  poseInput(sim, dt) {
    const g = this.game;
    const base = sim.kind === 'player' ? g.stats.speed : sim.def.speed;
    const moveAmt = clamp((sim.speedNow ?? 0) / base, 0, 1.2);
    const st = { kind: 'idle', t: this.time, dt, moveAmt: moveAmt > 0.06 ? Math.min(1, moveAmt) : 0 };
    if (sim.dead) { st.kind = 'dead'; st.deadK = sim.deadT / 0.7; }
    else if (sim.state === 'stagger') st.kind = 'stagger';
    else if (sim.action) {
      const a = sim.action, m = a.move;
      let k;
      if (a.phase === 'startup') k = a.t / a.startup; else if (a.phase === 'active') k = (a.t - a.startup) / a.active; else k = (a.t - a.startup - a.active) / a.recovery;
      st.kind = 'action'; st.act = { style: m.anim ?? 'slash', phase: a.phase, k, mirror: a.combo === 1, spinT: a.t * 16 };
      if (m.id === 'whirlwind' || m.anim === 'spin') st.act.spinT = a.t * 16;
    } else if (st.moveAmt > 0) st.kind = 'move';
    return st;
  }

  syncActors(dt) {
    const g = this.game, ch = g.chamber;
    const seen = new Set();
    const list = [g.player, ...ch.enemies];
    for (const sim of list) {
      seen.add(sim.id);
      let v = this.actors.get(sim.id);
      if (!v) { v = this.makeActorView(sim); this.actors.set(sim.id, v); }
      const rig = v.rig;
      v.grp.position.set(sim.x, 0, sim.z);
      v.face = lerpAngle(v.face, sim.face, 1 - Math.exp(-22 * dt));
      v.grp.rotation.y = v.face;
      poseRig(rig, this.poseInput(sim, dt));
      let y = 0, sc = v.scale;
      if (sim.spawnT > 0) { const k = 1 - sim.spawnT / 0.9; sc = v.scale * (0.15 + 0.85 * k); y = (1 - k) * -0.4; rig.root.visible = true; }
      if (sim.dead && sim.deadT > 1.3) y -= (sim.deadT - 1.3) * 1.0;
      rig.root.scale.setScalar(sc); rig.root.position.y = y;
      v.shadow.visible = !(sim.dead && sim.deadT > 1.3); v.shadow.material.opacity = sim.spawnT > 0 ? 0.1 : 0.4;
      // flash
      const hurt = clamp(sim.hurtT / 0.2, 0, 1);
      if (hurt > 0 || !v.eliteBase) setFlash(rig, hurt, sim.kind === 'player' ? 0xff2020 : 0xffffff);
      else if (v.eliteBase) setFlash(rig, 0.18 + Math.sin(this.time * 3) * 0.06, ELITE_COLOR[sim.elite]);
      if (sim.invuln && sim.def?.boss) setFlash(rig, 0.5 + Math.sin(this.time * 18) * 0.3, 0xffd890);
      if (v.eliteRing) v.eliteRing.rotation.z = this.time;
      // enemy bar
      if (v.bar) {
        const recent = sim.ai && g.time - sim.ai.hurtAt < 4.5;
        const hovered = this.hover?.id === sim.id;
        const show = !sim.dead && !sim.def.boss && (recent || hovered) && sim.spawnT <= 0;
        v.bar.grp.visible = show;
        if (show) { const r = clamp(sim.hp / sim.maxHp, 0, 1); v.bar.fill.scale.x = 0.96 * r; v.bar.fill.position.x = -(0.96 * (1 - r)) / 2; v.bar.grp.quaternion.copy(this.camera.quaternion); }
      }
    }
    for (const [id, v] of this.actors) if (!seen.has(id)) { this.removeActorView(v); this.actors.delete(id); }
  }

  syncProjectiles() {
    const ch = this.game.chamber;
    for (const p of ch.projectiles) {
      const v = this.projectiles.get(p.id);
      if (!v) continue;
      v.obj.position.set(p.x, 1.0, p.z);
      if (p.kind !== 'arrow' && Math.random() < 0.9) this.particles.emit(p.x + (Math.random() - 0.5) * 0.1, 1.0 + (Math.random() - 0.5) * 0.1, p.z + (Math.random() - 0.5) * 0.1, 0, 0.3, 0, 0.3, p.r * 0.7, p.color, 0);
    }
    for (const [id, v] of this.projectiles) if (!ch.projectiles.some((p) => p.id === id)) { this.removeProjectileView(v); this.projectiles.delete(id); }
  }

  syncLoot() {
    const ch = this.game.chamber, seen = new Set();
    for (const l of ch.loot) {
      seen.add(l.id);
      let v = this.lootViews.get(l.id);
      if (!v) { v = this.makeLootView(l); this.lootViews.set(l.id, v); this.scene.add(v.obj); }
      const bob = Math.sin(this.time * 2.5 + l.x * 3) * 0.06;
      const drop = l.age < 0.5 ? (1 - l.age / 0.5) * 0.8 : 0;
      v.obj.position.set(l.x, bob + drop, l.z);
      v.spin.rotation.y = this.time * 1.5;
      const hov = this.hover?.id === l.id;
      v.glow.material.opacity = (hov ? 0.9 : 0.5) + Math.sin(this.time * 4) * 0.1;
    }
    for (const [id, v] of this.lootViews) if (!seen.has(id)) { this.scene.remove(v.obj); this.lootViews.delete(id); }
  }
  makeLootView(l) {
    const obj = new THREE.Group(), spin = new THREE.Group(); obj.add(spin);
    let col = 0xffd070;
    if (l.kind === 'gold') { for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 8), new THREE.MeshStandardMaterial({ color: 0xe0b040, metalness: 0.8, roughness: 0.3, emissive: 0x604010 })); c.position.set((i - 1) * 0.12, 0.06 + i * 0.04, (i % 2) * 0.08); c.rotation.x = 0.3 * i; spin.add(c); } }
    else if (l.kind === 'potion') { col = l.potion === 'hp' ? 0xe03a3a : 0x4a80ff; const b = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: col })); b.position.y = 0.22; const n = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.14, 6), new THREE.MeshBasicMaterial({ color: 0xd0c8b0 })); n.position.y = 0.4; spin.add(b); spin.add(n); }
    else { col = Number.parseInt(RARITY[l.item.rarity].color.slice(1), 16); const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: col })); gem.position.y = 0.45; gem.scale.y = 1.3; spin.add(gem); if (l.item.rarity !== 'common') { const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 2.6, 6, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); beam.position.y = 1.3; obj.add(beam); } }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,255,255,1)'), color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
    glow.scale.setScalar(l.kind === 'item' ? 1.5 : 0.9); glow.position.y = 0.3; obj.add(glow);
    return { obj, spin, glow };
  }

  // ------------------------------------------------------------ camera
  updateCamera(dt, aim) {
    const p = this.game.player, c = this.cam, B = this.bounds;
    let tx = p.x, tz = p.z;
    if (aim) { tx += (aim.x - p.x) * 0.06; tz += (aim.z - p.z) * 0.06; }
    if (B) { const m = 3; tx = clamp(tx, B.x0 - m, B.x1 + m); tz = clamp(tz, B.z0 - m, B.z1 + m); }
    const k = c.snap ? 1 : 1 - Math.exp(-7 * dt);
    c.target.x += (tx - c.target.x) * k; c.target.z += (tz - c.target.z) * k; c.target.y = 0;
    c.snap = false;
    c.shake = Math.max(0, c.shake - dt * 2.4);
    const s = c.shake * c.shake * 0.5;
    const ox = (Math.random() - 0.5) * s, oz = (Math.random() - 0.5) * s;
    this.camera.position.set(c.target.x + CAM_DIR.x * 40 + ox, CAM_DIR.y * 40, c.target.z + CAM_DIR.z * 40 + oz);
    this.camera.lookAt(c.target.x + ox, 0, c.target.z + oz);
  }

  // ------------------------------------------------------------ frame
  update(dt, aim) {
    this.time += dt;
    const g = this.game;
    if (!g) return;
    this.syncActors(dt);
    this.syncProjectiles();
    this.syncLoot();
    this.updateCamera(dt, aim);
    this.chamberView?.update(dt, this.time, g.player);
    this.telegraphs.update(g);
    const lk = this.lockTarget;
    this.lockRing.visible = !!lk;
    const isBlock = lk?.t === 'block';
    this.pushArrow.visible = !!(isBlock && this.pushDir);
    if (isBlock && this.pushDir) { const d = this.pushDir; this.pushArrow.position.set(lk.x + d[0] * (1.05 + Math.sin(this.time * 6) * 0.06), 0.1, lk.z + d[1] * (1.05 + Math.sin(this.time * 6) * 0.06)); this.pushArrow.rotation.y = Math.atan2(d[0], d[1]); }
    if (lk) { const r = (lk.radius ?? 0.5) * 1.5 + Math.sin(this.time * 6) * 0.05; this.lockRing.position.set(lk.x, 0.06, lk.z); this.lockRing.scale.setScalar(r); this.lockRing.rotation.z = this.time * 1.5; }
    this.lights.update(dt, this.time, g.player);
    this.particles.update(dt); this.decals.update(dt); this.beams.update(dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    const low = g.player.hp / g.stats.maxHp < 0.3 ? (0.55 + Math.sin(this.time * 5) * 0.2) * (0.3 - g.player.hp / g.stats.maxHp) / 0.3 : 0;
    if (this.grade) { this.grade.uniforms.uHurt.value = this.reducedMotion ? Math.min(0.35, this.hurtFlash * 0.4) : Math.max(this.hurtFlash, low * 0.6); }
  }
  render() {
    if (this.composer && this.quality === 'high') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------ picking & projection
  project(x, y, z) {
    this.tmpV.set(x, y, z).project(this.camera);
    return { x: (this.tmpV.x * 0.5 + 0.5) * this.w, y: (-this.tmpV.y * 0.5 + 0.5) * this.h, behind: this.tmpV.z > 1 };
  }
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    const tg = d.y !== 0 ? -o.y / d.y : 0;
    const ground = { x: o.x + d.x * tg, z: o.z + d.z * tg };
    const g = this.game, ch = g.chamber;
    let best = null, bestScore = 1e9;
    const consider = (kind, ent, x, z, r, h, pri) => {
      // distance from the pick ray to the vertical segment (x,0,z)-(x,h,z)
      const a = new THREE.Vector3(x, 0, z), b = new THREE.Vector3(x, h, z);
      const u = b.clone().sub(a), w0 = o.clone().sub(a);
      const A = d.dot(d), Bv = d.dot(u), Cv = u.dot(u), D = d.dot(w0), E = u.dot(w0);
      const den = A * Cv - Bv * Bv; let s = 0, t = 0;
      if (Math.abs(den) > 1e-6) { s = (Bv * E - Cv * D) / den; t = (A * E - Bv * D) / den; }
      t = clamp(t, 0, 1); s = Math.max(0, s);
      const pr = o.clone().addScaledVector(d, s), ps = a.clone().addScaledVector(u, t);
      const dist = pr.distanceTo(ps);
      if (dist <= r) { const score = dist / r + pri; if (score < bestScore) { bestScore = score; best = { kind, id: ent.id, entity: ent }; } }
    };
    for (const e of ch.enemies) if (!e.dead && e.spawnT <= 0) consider('enemy', e, e.x, e.z, e.radius * 1.1 + 0.25, (this.actors.get(e.id)?.rig.height ?? 1.8) * (e.scale ?? 1) * (VISUAL_SCALE[e.rigId] ?? 1), 0);
    for (const l of ch.loot) consider('loot', l, l.x, l.z, 0.6, 0.6, 0.2);
    for (const p of ch.interactables()) if (!p.kind) consider('interact', p, p.x, p.z, 0.7, p.t === 'waystone' ? 1.8 : 1.0, 0.1);
    for (const p of ch.hurtProps()) if (p.t !== 'brazier') consider('prop', p, p.x, p.z, 0.55, 0.9, 0.15);
    for (const p of ch.props.values()) if (p.t === 'block' && !ch.puzzleOfBlock(p.id)?.solved) consider('block', p, p.x, p.z, 0.62, 0.9, 0.05);
    return { ground, hover: best };
  }

  lootLabels() {
    const out = [];
    for (const l of this.game.chamber.loot) {
      if (l.kind !== 'item' && l.kind !== 'gold') continue;
      const s = this.project(l.x, 0.9, l.z);
      if (s.behind || s.x < -40 || s.x > this.w + 40 || s.y < -40 || s.y > this.h + 40) continue;
      out.push({ id: l.id, x: s.x, y: s.y, loot: l });
    }
    return out;
  }
  hasWebGL() { return !!this.renderer.getContext(); }
  dispose() { this.unbind(); this.renderer.dispose(); }
}
