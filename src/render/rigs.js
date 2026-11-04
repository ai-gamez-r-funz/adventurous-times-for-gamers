// Procedural rigged actors. Contract (see build-game-monster-system): +Y up, +Z forward, metres, ground-contact root.
// Hierarchy: root -> motion -> body -> hips -> {spine -> chest -> {neck -> head, shoulders -> elbows -> hands}, hips -> knees -> feet}
// Poses are driven by the authoritative action clock (phase + normalised progress). The rig never decides hits.
import * as THREE from 'three';
import { clamp, lerp, easeOut, easeIn, smooth } from '../core/util.js';

// ------------------------------------------------------------------ helpers
const geoCache = new Map();
const geo = (key, f) => { if (!geoCache.has(key)) geoCache.set(key, f()); return geoCache.get(key); };
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.85, metalness: o.m ?? 0.1, flatShading: true, emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1, transparent: !!o.t, opacity: o.o ?? 1, side: o.side ?? THREE.FrontSide });
const box = (w, h, d, m) => new THREE.Mesh(geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), m);
const cyl = (rt, rb, h, m, seg = 6) => new THREE.Mesh(geo(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), m);
const sph = (r, m, w = 7, h = 5) => new THREE.Mesh(geo(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h)), m);
const cone = (r, h, m, seg = 6) => new THREE.Mesh(geo(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)), m);
const limb = (len, rt, rb, m) => new THREE.Mesh(geo(`l${len},${rt},${rb}`, () => { const g = new THREE.CylinderGeometry(rt, rb, len, 6); g.translate(0, -len / 2, 0); return g; }), m);
const at = (o, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); return o; };
const grp = (name) => { const g = new THREE.Group(); g.name = name; return g; };

// ------------------------------------------------------------------ poses
const NEUTRAL = { cX: 0, cY: 0, cZ: 0, hY: 0, shRx: 0.08, shRy: 0, shRz: -0.14, elRx: -0.3, shLx: 0.08, shLy: 0, shLz: 0.14, elLx: -0.3, headX: 0, headY: 0, lean: 0, drop: 0 };
const KEYS = Object.keys(NEUTRAL);
const STYLES = {
  slash: { wind: { cY: -0.9, hY: -0.2, shRx: -1.25, shRz: -1.05, elRx: -0.5, shLz: 0.5, lean: -0.08 }, strike: { cY: 0.95, hY: 0.2, shRx: -1.35, shRz: 0.55, elRx: -0.15, shLx: 0.4, lean: 0.12 } },
  overhead: { wind: { cX: -0.4, shRx: -3.0, shRz: -0.25, elRx: -0.5, shLx: -2.6, shLz: 0.3, lean: -0.18, headX: -0.2 }, strike: { cX: 0.6, shRx: -0.55, elRx: -0.1, shLx: -0.5, shLz: 0.15, lean: 0.28, drop: 0.12, headX: 0.25 } },
  thrust: { wind: { cY: -0.55, hY: -0.2, shRx: 0.7, shRz: -0.35, elRx: -0.9, shLx: -0.4, lean: -0.1 }, strike: { cY: 0.35, cX: 0.2, shRx: -1.45, shRz: -0.1, elRx: -0.05, shLx: 0.2, lean: 0.3, headX: 0.15 } },
  bash: { wind: { cX: -0.2, cY: -0.3, shLx: -0.6, shLz: 0.7, elLx: -1.5, shRx: 0.4, lean: -0.1 }, strike: { cX: 0.3, cY: 0.25, shLx: -1.65, shLz: 0.15, elLx: -0.4, shRx: -0.3, lean: 0.28 } },
  spin: { wind: { shRx: -1.3, shRz: -1.35, elRx: -0.2, shLx: -1.3, shLz: 1.35, elLx: -0.2, lean: 0.1 }, strike: { shRx: -1.3, shRz: -1.35, elRx: -0.2, shLx: -1.3, shLz: 1.35, elLx: -0.2, lean: 0.14 } },
  shoot: { wind: { cY: -0.3, shLx: -1.55, shLz: 0.12, elLx: -0.1, shRx: -1.4, shRz: -0.95, elRx: -1.95, headY: 0.2 }, strike: { cY: -0.3, shLx: -1.55, shLz: 0.12, elLx: -0.1, shRx: -1.25, shRz: -1.2, elRx: -0.35, headY: 0.2, lean: -0.05 } },
  cast: { wind: { cX: -0.12, shRx: -1.0, shRz: -0.95, elRx: -1.0, shLx: -1.0, shLz: 0.95, elLx: -1.0, headX: -0.1 }, strike: { cX: 0.18, shRx: -1.55, shRz: -0.25, elRx: -0.12, shLx: -1.55, shLz: 0.25, elLx: -0.12, headX: 0.1, lean: 0.12 } },
  cast_aoe: { wind: { cX: -0.22, shRx: 0.35, shRz: -0.3, elRx: -0.5, shLx: 0.35, shLz: 0.3, elLx: -0.5, drop: 0.08, headX: -0.2 }, strike: { cX: 0.25, shRx: -0.25, shRz: -1.55, elRx: -0.1, shLx: -0.25, shLz: 1.55, elLx: -0.1, headX: 0.15 } },
  summon: { wind: { cX: -0.25, shRx: -2.8, shRz: -0.45, elRx: -0.3, shLx: -2.8, shLz: 0.45, elLx: -0.3, headX: -0.35 }, strike: { cX: 0.4, shRx: -0.9, shRz: -0.35, elRx: -0.2, shLx: -0.9, shLz: 0.35, elLx: -0.2, drop: 0.1, headX: 0.2 } },
};
const STYLE_ALIAS = { lunge: 'thrust' };
const mix = (a, b, k) => { const o = {}; for (const key of KEYS) o[key] = lerp(a[key], b[key], k); return o; };
const full = (p) => ({ ...NEUTRAL, ...p });

function actionPose(style, phase, k, mirror) {
  const S = STYLES[STYLE_ALIAS[style] ?? style] ?? STYLES.slash;
  const W = full(S.wind), T = full(S.strike);
  let p;
  if (phase === 'startup') p = mix(NEUTRAL, W, easeOut(clamp(k, 0, 1)));
  else if (phase === 'active') p = mix(W, T, easeIn(clamp(k, 0, 1)));
  else p = mix(T, NEUTRAL, smooth(clamp(k, 0, 1)));
  if (mirror) { p.cY *= -1; p.hY *= -1; }
  return p;
}

// ------------------------------------------------------------------ the humanoid skeleton
function buildSkeleton(d, mats) {
  const root = grp('root'), motion = grp('motion'), body = grp('body'), hips = grp('hips');
  const legLen = d.thigh + d.shin;
  const height = legLen + d.torso + d.neck + d.head * 1.6;
  motion.position.y = height * 0.5; body.position.y = -height * 0.5; hips.position.y = legLen;
  root.add(motion); motion.add(body); body.add(hips);
  const J = { root, motion, body, hips };
  const S = {};
  // torso chain
  J.spine = at(grp('spine'), 0, 0.02, 0); hips.add(J.spine);
  J.chest = at(grp('chest'), 0, d.torso * 0.18, 0); J.spine.add(J.chest);
  J.neck = at(grp('neck'), 0, d.torso * 0.82, 0); J.chest.add(J.neck);
  J.head = at(grp('head'), 0, d.neck, 0); J.neck.add(J.head);
  // arms
  for (const [side, sx] of [['R', -1], ['L', 1]]) {
    const sh = at(grp('shoulder' + side), sx * d.shoulderW, d.torso * 0.72, 0); J.chest.add(sh);
    const upper = limb(d.arm, d.limbR * 1.15, d.limbR * 0.95, mats.limbA ?? mats.body); sh.add(upper);
    const el = at(grp('elbow' + side), 0, -d.arm, 0); sh.add(el);
    const fore = limb(d.fore, d.limbR * 0.95, d.limbR * 0.75, mats.limbB ?? mats.limbA ?? mats.body); el.add(fore);
    const hand = at(grp('hand' + side), 0, -d.fore, 0); el.add(hand);
    J['shoulder' + side] = sh; J['elbow' + side] = el; J['hand' + side] = hand; S['hand' + side] = hand;
  }
  // legs
  if (!d.noLegs) {
    for (const [side, sx] of [['R', -1], ['L', 1]]) {
      const hp = at(grp('hip' + side), sx * d.hipW, 0, 0); hips.add(hp);
      hp.add(limb(d.thigh, d.limbR * 1.25, d.limbR, mats.legA ?? mats.body));
      const kn = at(grp('knee' + side), 0, -d.thigh, 0); hp.add(kn);
      kn.add(limb(d.shin, d.limbR, d.limbR * 0.8, mats.legB ?? mats.legA ?? mats.body));
      const ft = at(grp('foot' + side), 0, -d.shin, 0); kn.add(ft);
      ft.add(at(box(d.limbR * 2.2, d.limbR * 1.2, d.limbR * 3.4, mats.foot ?? mats.body), 0, -d.limbR * 0.4, d.limbR * 0.8));
      J['hip' + side] = hp; J['knee' + side] = kn; J['foot' + side] = ft;
    }
  }
  S.head = J.head; S.chest = J.chest; S.origin = root;
  S.hit = at(grp('hit'), 0, height * 0.55, 0); root.add(S.hit);
  S.lantern = at(grp('lantern'), d.hipW + 0.2, 0.0, 0.04); hips.add(S.lantern);
  return { J, S, height, legLen };
}

// ------------------------------------------------------------------ character specs
const SPECS = {
  oathbound(rig) {
    const d = { thigh: 0.46, shin: 0.46, torso: 0.66, neck: 0.06, head: 0.21, shoulderW: 0.36, hipW: 0.15, arm: 0.36, fore: 0.34, limbR: 0.085 };
    const m = { body: mat(0x3d414c, { m: 0.35, r: 0.55 }), limbA: mat(0x4a4f5c, { m: 0.35, r: 0.55 }), legA: mat(0x2c2f38, { m: 0.5 }), foot: mat(0x1c1a1e), cloth: mat(0x6d1c22, { side: THREE.DoubleSide }), steel: mat(0xaab3c0, { m: 0.85, r: 0.3 }), gold: mat(0xb08a35, { m: 0.8, r: 0.35 }), dark: mat(0x16171c), eye: mat(0xffb040, { e: 0xffa020, ei: 2 }) };
    const sk = buildSkeleton(d, m); const { J, S } = sk;
    J.chest.add(at(box(0.58, d.torso, 0.34, m.body), 0, d.torso / 2, 0));
    J.chest.add(at(box(0.46, 0.18, 0.38, m.gold), 0, d.torso * 0.12, 0));
    J.hips.add(at(box(0.44, 0.2, 0.3, m.dark), 0, 0.06, 0));
    const tab = at(box(0.26, 0.62, 0.03, m.cloth), 0, -0.2, 0.18); J.hips.add(tab);
    for (const s of [-1, 1]) { const p = at(sph(0.17, m.body, 7, 4), s * (d.shoulderW + 0.02), d.torso * 0.78, 0); p.scale.set(1.25, 0.8, 1.2); J.chest.add(p); J['shoulder' + (s < 0 ? 'R' : 'L')].add(at(box(0.18, 0.04, 0.22, m.gold), 0, 0.12, 0)); }
    J.head.add(at(box(0.25, 0.27, 0.26, m.body), 0, 0.13, 0));
    J.head.add(at(box(0.2, 0.035, 0.02, m.eye), 0, 0.14, 0.135));
    J.head.add(at(box(0.04, 0.12, 0.3, m.cloth), 0, 0.31, -0.02));
    const cloak = at(box(0.5, 1.05, 0.03, m.cloth), 0, d.torso * 0.5 - 0.5, -0.2); J.chest.add(cloak); sk.cloak = cloak;
    // sword (right hand)
    const sword = grp('sword'); sword.add(at(cyl(0.03, 0.03, 0.2, m.dark), 0, -0.02, 0)); sword.add(at(box(0.3, 0.05, 0.06, m.gold), 0, -0.12, 0)); sword.add(at(box(0.07, 1.0, 0.02, m.steel), 0, -0.66, 0)); sword.add(at(box(0.02, 0.9, 0.04, m.dark), 0, -0.62, 0));
    sword.rotation.x = -1.1; J.handR.add(sword); S.weapon = sword; S.weaponTip = at(grp('tip'), 0, -1.15, 0); sword.add(S.weaponTip);
    // shield (left forearm)
    const sh = grp('shield'); sh.add(at(box(0.62, 0.78, 0.08, m.body), 0, 0, 0)); sh.add(at(box(0.5, 0.66, 0.05, m.cloth), 0, 0, 0.05)); sh.add(at(box(0.1, 0.5, 0.06, m.gold), 0, 0, 0.08)); sh.add(at(box(0.36, 0.08, 0.06, m.gold), 0, 0.08, 0.08));
    sh.position.set(0.1, -0.1, 0.16); sh.rotation.y = 0.2; J.elbowL.add(sh); S.offhand = sh;
    return { ...sk, d, mats: m, flash: [m.body, m.limbA, m.legA, m.cloth], idle: { breathe: 0.014 } };
  },

  cinderwitch(rig) {
    const d = { thigh: 0.44, shin: 0.44, torso: 0.58, neck: 0.05, head: 0.2, shoulderW: 0.27, hipW: 0.11, arm: 0.33, fore: 0.31, limbR: 0.06 };
    const m = { body: mat(0x2a1a34, { r: 0.9 }), limbA: mat(0x33213f), legA: mat(0x1a1020), foot: mat(0x120c16), trim: mat(0xe8742c, { e: 0xff6a1c, ei: 1.4 }), skin: mat(0xb89a86), hood: mat(0x1f1328, { side: THREE.DoubleSide }), ember: mat(0xffa040, { e: 0xff7a20, ei: 2.5 }), wood: mat(0x3b2a20), cloth: mat(0x3a2147, { side: THREE.DoubleSide }) };
    const sk = buildSkeleton(d, m); const { J, S } = sk;
    J.chest.add(at(box(0.44, d.torso, 0.26, m.body), 0, d.torso / 2, 0));
    J.chest.add(at(box(0.46, 0.05, 0.28, m.trim), 0, d.torso * 0.32, 0));
    const robe = at(cyl(0.2, 0.5, 0.95, m.body, 8), 0, -0.34, 0); J.hips.add(robe); sk.robe = robe;
    J.hips.add(at(cyl(0.505, 0.505, 0.04, m.trim, 8), 0, -0.8, 0));
    J.chest.add(at(cone(0.3, 0.5, m.hood, 6), 0, d.torso + 0.04, -0.06)); // shoulder cowl
    J.head.add(at(box(0.2, 0.22, 0.2, m.skin), 0, 0.11, 0.0));
    J.head.add(at(cone(0.24, 0.52, m.hood, 6), 0, 0.3, -0.04));
    J.head.add(at(box(0.15, 0.04, 0.02, m.ember), 0, 0.13, 0.105));
    const cape = at(box(0.46, 0.9, 0.03, m.cloth), 0, d.torso * 0.5 - 0.42, -0.17); J.chest.add(cape); sk.cloak = cape;
    // staff with ember orb
    const staff = grp('staff'); staff.add(at(cyl(0.025, 0.03, 1.5, m.wood), 0, 0.15, 0)); staff.add(at(sph(0.1, m.ember, 8, 6), 0, 0.98, 0)); staff.add(at(box(0.18, 0.04, 0.04, m.wood), 0, 0.86, 0)); staff.rotation.x = -0.25; J.handR.add(staff); S.weapon = staff;
    S.muzzle = at(grp('muzzle'), 0, 0.98, 0); staff.add(S.muzzle); S.weaponTip = S.muzzle;
    // focus orb in left hand
    const orb = at(sph(0.07, m.ember, 8, 6), 0, -0.06, 0.05); J.handL.add(orb); S.offhand = orb; S.orb = orb;
    return { ...sk, d, mats: m, flash: [m.body, m.limbA, m.hood], idle: { breathe: 0.01 } };
  },

  husk(rig) {
    const d = { thigh: 0.4, shin: 0.4, torso: 0.56, neck: 0.05, head: 0.19, shoulderW: 0.28, hipW: 0.12, arm: 0.46, fore: 0.44, limbR: 0.055, hunch: 0.42 };
    const m = { body: mat(0x6e7868, { r: 0.95 }), limbA: mat(0x657160), legA: mat(0x4b5446), foot: mat(0x3a3a34), rag: mat(0x3b3228, { side: THREE.DoubleSide }), eye: mat(0xff3a2a, { e: 0xff2010, ei: 2.5 }), bone: mat(0xc8c2ac) };
    const sk = buildSkeleton(d, m); const { J, S } = sk;
    J.chest.add(at(box(0.4, d.torso, 0.24, m.body), 0, d.torso / 2, 0));
    for (let i = 0; i < 3; i++) J.chest.add(at(box(0.42, 0.025, 0.26, m.bone), 0, 0.16 + i * 0.12, 0.01));
    J.hips.add(at(box(0.3, 0.12, 0.2, m.legA), 0, 0.04, 0));
    J.hips.add(at(box(0.36, 0.45, 0.03, m.rag), 0, -0.2, 0.12));
    J.head.add(at(box(0.18, 0.2, 0.2, m.body), 0, 0.1, 0.02));
    J.head.add(at(box(0.15, 0.06, 0.15, m.legA), 0, -0.02, 0.05));
    for (const s of [-1, 1]) J.head.add(at(box(0.04, 0.035, 0.02, m.eye), s * 0.05, 0.13, 0.125));
    for (const s of ['R', 'L']) { for (let i = 0; i < 3; i++) J['hand' + s].add(at(cone(0.012, 0.12, m.bone, 4), (i - 1) * 0.03, -0.08, 0.02)); }
    S.weaponTip = at(grp('tip'), 0, -0.2, 0); J.handR.add(S.weaponTip);
    return { ...sk, d, mats: m, flash: [m.body, m.limbA, m.legA], hunch: d.hunch, idle: { breathe: 0.03 } };
  },

  archer(rig) {
    const d = { thigh: 0.45, shin: 0.45, torso: 0.52, neck: 0.04, head: 0.2, shoulderW: 0.24, hipW: 0.1, arm: 0.34, fore: 0.32, limbR: 0.035 };
    const m = { body: mat(0xd6cfb8), limbA: mat(0xcfc8b0), legA: mat(0xc2bba4), foot: mat(0xb4ad98), dark: mat(0x16141a), eye: mat(0x6dffd2, { e: 0x40ffc0, ei: 2.5 }), rag: mat(0x2c2a34, { side: THREE.DoubleSide }), wood: mat(0x5a4030) };
    const sk = buildSkeleton(d, m); const { J, S } = sk;
    for (let i = 0; i < 4; i++) J.chest.add(at(box(0.3 - i * 0.02, 0.045, 0.18, m.body), 0, 0.12 + i * 0.12, 0));
    J.chest.add(at(box(0.05, d.torso, 0.06, m.body), 0, d.torso / 2, -0.06));
    J.hips.add(at(box(0.26, 0.08, 0.16, m.body), 0, 0.04, 0));
    J.hips.add(at(box(0.32, 0.4, 0.03, m.rag), 0, -0.18, 0.1));
    J.head.add(at(box(0.18, 0.2, 0.19, m.body), 0, 0.1, 0));
    J.head.add(at(box(0.14, 0.06, 0.12, m.body), 0, -0.01, 0.04));
    for (const s of [-1, 1]) { J.head.add(at(box(0.05, 0.05, 0.02, m.dark), s * 0.045, 0.12, 0.1)); J.head.add(at(box(0.025, 0.025, 0.02, m.eye), s * 0.045, 0.12, 0.108)); }
    J.chest.add(at(cone(0.28, 0.34, m.rag, 5), 0, d.torso + 0.02, -0.02));
    const bow = grp('bow'); const arc = new THREE.Mesh(geo('bow', () => new THREE.TorusGeometry(0.5, 0.025, 4, 10, Math.PI * 0.85)), m.wood); arc.rotation.z = Math.PI / 2 + (Math.PI - Math.PI * 0.85) / 2 - Math.PI / 2; arc.rotation.z = -Math.PI * 0.425 + Math.PI / 2; bow.add(arc);
    bow.add(at(cyl(0.006, 0.006, 0.86, m.body, 3), 0.0, 0, -0.0)); bow.rotation.set(0, Math.PI / 2, 0); bow.position.set(0, -0.02, 0.05); J.handL.add(bow); S.weapon = bow;
    S.muzzle = at(grp('muzzle'), 0, 0, 0.1); J.handL.add(S.muzzle); S.weaponTip = S.muzzle;
    return { ...sk, d, mats: m, flash: [m.body, m.limbA, m.legA], idle: { breathe: 0.01 } };
  },

  cultist(rig) {
    const d = { thigh: 0.4, shin: 0.4, torso: 0.58, neck: 0.05, head: 0.2, shoulderW: 0.28, hipW: 0.1, arm: 0.34, fore: 0.32, limbR: 0.06, noLegs: true, float: 0.34 };
    const m = { body: mat(0x4a1216, { r: 0.9 }), limbA: mat(0x5a181d), hood: mat(0x2a0a0e, { side: THREE.DoubleSide }), gold: mat(0xb08a35, { m: 0.8 }), eye: mat(0xff7a30, { e: 0xff6010, ei: 2.5 }), skin: mat(0x7d5d50), flame: mat(0xffa040, { e: 0xff7a20, ei: 2.6 }), dark: mat(0x120608) };
    const sk = buildSkeleton({ ...d, thigh: 0.4, shin: 0.4 }, m); const { J, S } = sk;
    J.hips.position.y = d.float + 0.5;
    J.chest.add(at(box(0.44, d.torso, 0.26, m.body), 0, d.torso / 2, 0));
    const robe = at(cone(0.46, 1.0, m.body, 7), 0, -0.4, 0); J.hips.add(robe); sk.robe = robe;
    J.hips.add(at(cyl(0.47, 0.47, 0.035, m.gold, 7), 0, -0.88, 0));
    J.chest.add(at(box(0.5, 0.04, 0.3, m.gold), 0, d.torso * 0.5, 0));
    J.head.add(at(box(0.18, 0.2, 0.18, m.dark), 0, 0.1, 0));
    J.head.add(at(cone(0.22, 0.6, m.hood, 6), 0, 0.34, -0.03));
    for (const s of [-1, 1]) J.head.add(at(box(0.04, 0.03, 0.02, m.eye), s * 0.045, 0.12, 0.1));
    const orb = at(sph(0.1, m.flame, 8, 6), 0, -0.05, 0.08); J.handR.add(orb); S.orb = orb; S.muzzle = orb; S.weaponTip = orb;
    const orbL = at(sph(0.06, m.flame, 8, 6), 0, -0.05, 0.05); J.handL.add(orbL);
    S.lantern.position.set(0, 0.1, 0);
    sk.height += d.float;
    return { ...sk, d, mats: m, flash: [m.body, m.limbA, m.hood], float: d.float, idle: { breathe: 0.01 } };
  },

  brute(rig) {
    const d = { thigh: 0.5, shin: 0.5, torso: 0.8, neck: 0.04, head: 0.2, shoulderW: 0.58, hipW: 0.22, arm: 0.6, fore: 0.58, limbR: 0.17, hunch: 0.25 };
    const m = { body: mat(0x59695a, { r: 0.95 }), limbA: mat(0x536354), legA: mat(0x3f4b40), foot: mat(0x2e302c), iron: mat(0x4a4a52, { m: 0.7, r: 0.5 }), rag: mat(0x3a2e26, { side: THREE.DoubleSide }), eye: mat(0xff4a2a, { e: 0xff3010, ei: 2.5 }), stitch: mat(0x1a1612), bone: mat(0xc8c2ac) };
    const sk = buildSkeleton(d, m); const { J, S } = sk;
    J.chest.add(at(box(1.0, d.torso, 0.55, m.body), 0, d.torso / 2, 0));
    J.chest.add(at(box(1.04, 0.1, 0.58, m.iron), 0, d.torso * 0.28, 0)); J.chest.add(at(box(1.04, 0.1, 0.58, m.iron), 0, d.torso * 0.62, 0));
    J.chest.add(at(box(0.1, d.torso * 0.8, 0.02, m.stitch), 0.1, d.torso / 2, 0.28));
    J.hips.add(at(box(0.7, 0.22, 0.45, m.legA), 0, 0.06, 0));
    J.hips.add(at(box(0.6, 0.55, 0.04, m.rag), 0, -0.25, 0.22));
    for (const s of [-1, 1]) { const p = at(sph(0.28, m.iron, 7, 4), s * 0.62, d.torso * 0.82, 0); p.scale.set(1, 0.7, 1); J.chest.add(p); for (let i = 0; i < 3; i++) J.chest.add(at(cone(0.04, 0.16, m.bone, 4), s * (0.5 + i * 0.12), d.torso * 0.82 + 0.2, 0)); }
    J.head.add(at(box(0.26, 0.24, 0.28, m.body), 0, 0.1, 0.02));
    J.head.add(at(box(0.22, 0.07, 0.1, m.legA), 0, -0.02, 0.1));
    for (const s of [-1, 1]) { J.head.add(at(box(0.05, 0.04, 0.02, m.eye), s * 0.065, 0.14, 0.16)); J.head.add(at(cone(0.015, 0.06, m.bone, 4), s * 0.06, -0.04, 0.16)); }
    const club = grp('club'); club.add(at(cyl(0.05, 0.05, 0.5, m.rag), 0, -0.15, 0)); club.add(at(cyl(0.2, 0.09, 0.9, m.iron), 0, -0.85, 0));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; club.add(at(cone(0.035, 0.14, m.bone, 4), Math.cos(a) * 0.2, -0.95 + (i % 2) * 0.25, Math.sin(a) * 0.2)); }
    club.rotation.x = -1.0; J.handR.add(club); S.weapon = club; S.weaponTip = at(grp('tip'), 0, -1.3, 0); club.add(S.weaponTip);
    return { ...sk, d, mats: m, flash: [m.body, m.limbA, m.legA], hunch: d.hunch, idle: { breathe: 0.016 } };
  },

  bishop(rig) {
    const d = { thigh: 0.52, shin: 0.52, torso: 0.74, neck: 0.06, head: 0.22, shoulderW: 0.4, hipW: 0.13, arm: 0.42, fore: 0.4, limbR: 0.075, noLegs: false };
    const m = { body: mat(0x14101a, { r: 0.9 }), limbA: mat(0x1c1622), legA: mat(0x0e0a12), foot: mat(0x0a080c), gold: mat(0xc9a24a, { m: 0.85, r: 0.35 }), bone: mat(0xd8d2c0), eye: mat(0xe8f4ff, { e: 0xaad0ff, ei: 3 }), robe: mat(0x1b1422, { side: THREE.DoubleSide }), core: mat(0xff9a40, { e: 0xff7a20, ei: 3 }), iron: mat(0x4a4850, { m: 0.7 }), red: mat(0x5a141c, { side: THREE.DoubleSide }) };
    const sk = buildSkeleton(d, m); const { J, S } = sk;
    J.chest.add(at(box(0.62, d.torso, 0.36, m.body), 0, d.torso / 2, 0));
    J.chest.add(at(box(0.18, d.torso * 0.9, 0.04, m.gold), 0, d.torso / 2, 0.19));
    J.chest.add(at(sph(0.1, m.core, 8, 6), 0, d.torso * 0.55, 0.12));
    for (const s of [-1, 1]) { const p = at(sph(0.2, m.gold, 7, 4), s * 0.46, d.torso * 0.8, 0); p.scale.set(1.1, 0.65, 1.1); J.chest.add(p); }
    const robe = at(cyl(0.3, 0.62, 1.1, m.robe, 8), 0, -0.42, 0); J.hips.add(robe); sk.robe = robe;
    J.hips.add(at(cyl(0.63, 0.63, 0.05, m.gold, 8), 0, -0.97, 0));
    const cape = at(box(0.8, 1.5, 0.04, m.red), 0, d.torso * 0.5 - 0.7, -0.26); J.chest.add(cape); sk.cloak = cape;
    J.head.add(at(box(0.22, 0.26, 0.22, m.bone), 0, 0.12, 0));
    for (const s of [-1, 1]) { J.head.add(at(box(0.05, 0.05, 0.02, m.body), s * 0.05, 0.15, 0.115)); J.head.add(at(box(0.03, 0.03, 0.02, m.eye), s * 0.05, 0.15, 0.123)); }
    const mitre = at(cone(0.17, 0.5, m.gold, 4), 0, 0.5, 0); mitre.scale.set(1, 1, 0.55); J.head.add(mitre);
    J.head.add(at(box(0.2, 0.05, 0.05, m.body), 0, 0.3, 0.13));
    // mace
    const mace = grp('mace'); mace.add(at(cyl(0.035, 0.035, 1.2, m.iron), 0, -0.3, 0)); mace.add(at(cyl(0.22, 0.16, 0.34, m.gold, 8), 0, -1.0, 0));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; mace.add(at(cone(0.04, 0.16, m.iron, 4), Math.cos(a) * 0.2, -1.0, Math.sin(a) * 0.2)); }
    mace.rotation.x = -1.0; J.handR.add(mace); S.weapon = mace; S.weaponTip = at(grp('tip'), 0, -1.2, 0); mace.add(S.weaponTip);
    // censer on a chain
    const censer = grp('censer'); censer.add(at(cyl(0.008, 0.008, 0.5, m.iron, 3), 0, -0.25, 0)); censer.add(at(sph(0.13, m.iron, 7, 5), 0, -0.55, 0)); censer.add(at(sph(0.08, m.core, 7, 5), 0, -0.55, 0));
    J.handL.add(censer); S.offhand = censer; S.orb = censer; sk.censer = censer; S.muzzle = at(grp('muzzle'), 0, -0.05, 0.1); J.handL.add(S.muzzle);
    // ground aura ring
    const aura = at(new THREE.Mesh(geo('aura', () => new THREE.RingGeometry(0.9, 1.15, 28)), new THREE.MeshBasicMaterial({ color: 0xff7a40, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })), 0, 0.03, 0); aura.rotation.x = -Math.PI / 2; J.root.add(aura); sk.aura = aura;
    return { ...sk, d, mats: m, flash: [m.body, m.limbA, m.legA, m.robe], idle: { breathe: 0.012 } };
  },
};

export const RIG_IDS = Object.keys(SPECS);

// ------------------------------------------------------------------ rig runtime
export function createRig(id) {
  const spec = SPECS[id];
  if (!spec) throw new Error(`unknown rig ${id}`);
  const r = spec();
  const rig = {
    id, root: r.J.root, joints: r.J, sockets: r.S, height: r.height, d: r.d, extras: r, gait: Math.random() * 6, flashMats: r.flash, flashAmt: 0,
    materials: Object.values(r.mats),
  };
  rig.root.userData.rig = rig;
  return rig;
}

export function setFlash(rig, v, color = 0xff3a2a) {
  if (rig.flashAmt === v) return;
  rig.flashAmt = v;
  for (const m of rig.flashMats) { m.emissive.setHex(color); m.emissiveIntensity = v * 1.6; }
}

const tmp = {};
/**
 * Apply a pose.
 * in: { kind: 'idle'|'move'|'action'|'stagger'|'dead'|'roll', t, dt, moveAmt (0..1), act: { style, phase, k, kAll, mirror, spinT }, deadK, rollK, staggerK }
 */
export function poseRig(rig, st) {
  const J = rig.joints, X = rig.extras, d = rig.d;
  const t = st.t;
  rig.gait += st.dt * (1.5 + st.moveAmt * 6.2);
  let P = NEUTRAL;
  let spin = 0;
  if (st.kind === 'action' && st.act) {
    P = actionPose(st.act.style, st.act.phase, st.act.k, st.act.mirror);
    if (st.act.style === 'spin') spin = st.act.spinT ?? 0;
  } else if (st.kind === 'stagger') {
    P = full({ cX: -0.45, shRx: 0.9, shRz: -0.9, shLx: 0.9, shLz: 0.9, elRx: -0.7, elLx: -0.7, headX: -0.3, lean: -0.22 });
  }
  const g = rig.gait, bob = st.moveAmt;
  const sw = Math.sin(g), sw2 = Math.sin(g + Math.PI);
  const hunch = X.hunch ?? 0;
  const brth = Math.sin(t * 1.7 + rig.id.length) * (X.idle?.breathe ?? 0.01);

  J.spine.rotation.set(hunch * 0.5 + brth * 2 + (st.kind === 'move' ? 0.06 * bob : 0), P.hY, 0);
  J.chest.rotation.set(hunch * 0.5 + P.cX, P.cY + (st.kind === 'move' ? sw * 0.12 * bob : 0), P.cZ);
  J.head.rotation.set(-hunch * 0.6 + P.headX, P.headY - P.cY * 0.5, 0);
  const idleSway = Math.sin(t * 1.3 + 1) * 0.03;
  const armSwing = st.kind === 'move' || (st.kind === 'action' && st.moveAmt > 0.2 && st.act && st.act.style !== 'spin') ? 0.7 * bob : 0;
  const usesAct = st.kind === 'action' || st.kind === 'stagger';
  J.shoulderR.rotation.set(P.shRx + (usesAct ? 0 : sw2 * armSwing + idleSway), P.shRy, P.shRz + (usesAct ? 0 : 0.02));
  J.shoulderL.rotation.set(P.shLx + (usesAct ? 0 : sw * armSwing - idleSway), P.shLy, P.shLz);
  J.elbowR.rotation.set(P.elRx - (usesAct ? 0 : Math.max(0, sw2) * 0.5 * bob), 0, 0);
  J.elbowL.rotation.set(P.elLx - (usesAct ? 0 : Math.max(0, sw) * 0.5 * bob), 0, 0);
  if (J.hipR) {
    const legAmt = Math.min(1, st.moveAmt * 1.1);
    J.hipR.rotation.set(sw * 0.75 * legAmt, 0, 0); J.hipL.rotation.set(sw2 * 0.75 * legAmt, 0, 0);
    J.kneeR.rotation.set(Math.max(0, -sw) * 0.95 * legAmt + (P.drop ? 0.5 : 0), 0, 0); J.kneeL.rotation.set(Math.max(0, -sw2) * 0.95 * legAmt + (P.drop ? 0.5 : 0), 0, 0);
    if (P.drop) { J.hipR.rotation.x -= 0.25; J.hipL.rotation.x -= 0.25; }
  }
  // whole-body motion
  const M = J.motion;
  const center = -J.body.position.y;
  const floatY = X.float ? 0.12 + Math.sin(t * 2.2) * 0.07 : 0;
  M.position.set(0, center + (Math.abs(Math.sin(g)) * 0.05 * bob) - P.drop * 0.5 + floatY, 0);
  M.rotation.set(P.lean + (X.float ? bob * 0.12 : 0), spin, 0);
  if (st.kind === 'roll') { M.rotation.x = st.rollK * Math.PI * 2; M.position.y = center * 0.62; J.chest.rotation.x = 0.8; J.hipR && (J.hipR.rotation.x = -1.2, J.hipL.rotation.x = -1.2, J.kneeR.rotation.x = 1.6, J.kneeL.rotation.x = 1.6); J.shoulderR.rotation.set(-1.6, 0, -0.3); J.shoulderL.rotation.set(-1.6, 0, 0.3); }
  if (st.kind === 'dead') {
    const k = easeOut(clamp(st.deadK, 0, 1));
    M.rotation.x = -k * 1.5; M.position.y = lerp(center, 0.22, k);
    J.shoulderR.rotation.set(-0.5 * k, 0, -1.0 * k); J.shoulderL.rotation.set(-0.3 * k, 0, 1.0 * k);
  }
  // secondary motion
  if (X.cloak) X.cloak.rotation.x = 0.1 + bob * 0.5 + Math.sin(t * 2.4) * 0.05 + (st.kind === 'action' ? 0.25 : 0);
  if (X.robe) { X.robe.rotation.z = Math.sin(t * 1.9) * 0.03; X.robe.rotation.x = bob * 0.08; }
  if (X.censer) X.censer.rotation.set(Math.sin(t * 2.6) * 0.45 + bob * 0.3, 0, Math.cos(t * 2.1) * 0.3);
  if (X.aura) { X.aura.material.opacity = 0.28 + Math.sin(t * 3) * 0.1; X.aura.scale.setScalar(1 + Math.sin(t * 2) * 0.04); }
  void tmp; void d;
}
