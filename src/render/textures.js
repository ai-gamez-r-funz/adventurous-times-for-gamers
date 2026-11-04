// Procedural canvas textures: no external assets, so the game is fully self-contained and offline-safe.
import * as THREE from 'three';
import { RNG } from '../core/util.js';

const cache = new Map();
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function finish(canvas, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

/** Seamless-ish stone: speckle noise + mortar. kind: 'floor' (slab with border) | 'wall' (offset bricks) */
export function stoneTexture(kind, base = [92, 90, 104], seed = 1) {
  const key = `stone:${kind}:${base}:${seed}`;
  if (cache.has(key)) return cache.get(key);
  const S = 128, c = mk(S, S), g = c.getContext('2d'), r = new RNG(seed);
  g.fillStyle = rgb(...base); g.fillRect(0, 0, S, S);
  for (let i = 0; i < 1400; i++) {
    const v = r.range(-22, 22);
    g.fillStyle = rgb(base[0] + v, base[1] + v, base[2] + v * 1.1, r.range(0.08, 0.3));
    g.fillRect(r.range(0, S), r.range(0, S), r.range(1, 5), r.range(1, 4));
  }
  g.strokeStyle = rgb(12, 12, 18, 0.65); g.lineWidth = 2.5;
  if (kind === 'floor') {
    g.strokeRect(1.5, 1.5, S - 3, S - 3);
    g.strokeStyle = rgb(0, 0, 0, 0.18); g.lineWidth = 1;
    for (let i = 0; i < 5; i++) { g.beginPath(); let x = r.range(10, S - 10), z = r.range(10, S - 10); g.moveTo(x, z); for (let k = 0; k < 4; k++) { x += r.range(-14, 14); z += r.range(-14, 14); g.lineTo(x, z); } g.stroke(); }
  } else {
    const rows = 4, h = S / rows;
    for (let row = 0; row < rows; row++) {
      const y = row * h; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
      const off = row % 2 ? S / 4 : 0;
      for (let x = off; x < S + S / 2; x += S / 2) { g.beginPath(); g.moveTo(x % S, y); g.lineTo(x % S, y + h); g.stroke(); }
    }
  }
  const t = finish(c); cache.set(key, t); return t;
}

/** Four gothic puzzle glyphs, white on transparent. 0 crescent, 1 flame-spire, 2 eye, 3 hollow ring. */
export function glyphTexture(idx, color = '#ffffff') {
  const key = `glyph:${idx}:${color}`;
  if (cache.has(key)) return cache.get(key);
  const S = 128, c = mk(S, S), g = c.getContext('2d');
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = color; g.shadowBlur = 8;
  if (idx === 0) { g.beginPath(); g.arc(64, 64, 36, Math.PI * 0.35, Math.PI * 1.65, false); g.arc(80, 64, 28, Math.PI * 1.6, Math.PI * 0.4, true); g.closePath(); g.fill(); }
  else if (idx === 1) { g.beginPath(); g.moveTo(64, 14); g.lineTo(96, 108); g.lineTo(32, 108); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(64, 50); g.quadraticCurveTo(80, 76, 64, 98); g.quadraticCurveTo(48, 76, 64, 50); g.fill(); }
  else if (idx === 2) { g.beginPath(); g.moveTo(12, 64); g.quadraticCurveTo(64, 14, 116, 64); g.quadraticCurveTo(64, 114, 12, 64); g.stroke(); g.beginPath(); g.arc(64, 64, 15, 0, Math.PI * 2); g.fill(); }
  else { g.beginPath(); g.arc(64, 64, 40, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(64, 64, 14, 0, Math.PI * 2); g.stroke(); g.lineWidth = 5; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.beginPath(); g.moveTo(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46); g.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56); g.stroke(); } }
  const t = finish(c, { repeat: false }); cache.set(key, t); return t;
}

export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const key = `rad:${inner}:${outer}`;
  if (cache.has(key)) return cache.get(key);
  const S = 64, c = mk(S, S), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.55)')); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = finish(c, { repeat: false }); cache.set(key, t); return t;
}

export function flameTexture() {
  if (cache.has('flame')) return cache.get('flame');
  const W = 64, H = 96, c = mk(W, H), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 62, 2, 32, 58, 34);
  gr.addColorStop(0, 'rgba(255,245,200,1)'); gr.addColorStop(0.3, 'rgba(255,170,60,0.95)'); gr.addColorStop(0.7, 'rgba(220,70,20,0.45)'); gr.addColorStop(1, 'rgba(120,20,0,0)');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(32, 2); g.bezierCurveTo(54, 36, 62, 56, 32, 92); g.bezierCurveTo(2, 56, 10, 36, 32, 2); g.fill();
  const t = finish(c, { repeat: false }); cache.set('flame', t); return t;
}

export function crackTexture() {
  if (cache.has('crack')) return cache.get('crack');
  const S = 128, c = mk(S, S), g = c.getContext('2d'), r = new RNG(77);
  g.fillStyle = 'rgb(84,76,86)'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 700; i++) { const v = r.range(-20, 20); g.fillStyle = rgb(84 + v, 76 + v, 86 + v, 0.2); g.fillRect(r.range(0, S), r.range(0, S), r.range(1, 5), r.range(1, 4)); }
  g.strokeStyle = 'rgba(8,6,12,0.95)'; g.lineWidth = 3;
  for (let k = 0; k < 4; k++) { let x = r.range(30, 100), y = 0; g.beginPath(); g.moveTo(x, y); while (y < S) { x += r.range(-14, 14); y += r.range(12, 24); g.lineTo(x, y); } g.stroke(); }
  g.strokeStyle = 'rgba(255,140,60,0.55)'; g.lineWidth = 1.5; for (let k = 0; k < 2; k++) { let x = r.range(30, 100), y = r.range(0, 40); g.beginPath(); g.moveTo(x, y); for (let i = 0; i < 4; i++) { x += r.range(-12, 12); y += r.range(10, 22); g.lineTo(x, y); } g.stroke(); }
  const t = finish(c); cache.set('crack', t); return t;
}

export function bannerTexture(color = '#6e1a22') {
  const key = `banner:${color}`;
  if (cache.has(key)) return cache.get(key);
  const W = 64, H = 128, c = mk(W, H), g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 6; i++) g.fillRect(i * 11 + 3, 0, 2, H);
  g.fillStyle = '#c9a24a'; g.fillRect(0, 0, W, 6); g.fillRect(0, H - 12, W, 4);
  g.beginPath(); g.moveTo(0, H - 8); g.lineTo(16, H); g.lineTo(32, H - 12); g.lineTo(48, H); g.lineTo(64, H - 8); g.lineTo(64, H); g.lineTo(0, H); g.closePath(); g.fillStyle = 'rgba(0,0,0,0)'; g.fill();
  g.strokeStyle = '#c9a24a'; g.lineWidth = 3; g.beginPath(); g.arc(32, 52, 14, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(32, 30); g.lineTo(32, 76); g.moveTo(18, 52); g.lineTo(46, 52); g.stroke();
  const t = finish(c, { repeat: false }); cache.set(key, t); return t;
}
