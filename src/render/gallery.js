// Review route (?view=gallery): every rig on one stage with selectable, freezable poses.
// Deterministic fixture for visual review: window.__gal.set(style, phase, k) freezes the pose at an exact phase.
import * as THREE from 'three';
import { createRig, poseRig, RIG_IDS } from './rigs.js';

export function startGallery(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x15121c);
  scene.add(new THREE.HemisphereLight(0x9a9ab8, 0x2a2430, 1.6));
  const key = new THREE.DirectionalLight(0xffe0c0, 2.2); key.position.set(4, 8, 6); scene.add(key);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), new THREE.MeshStandardMaterial({ color: 0x24202c })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const rigs = RIG_IDS.map((id, i) => { const r = createRig(id); r.root.position.set((i - (RIG_IDS.length - 1) / 2) * 2.3, 0, 0); r.root.scale.setScalar(id === 'bishop' ? 1.5 : id === 'brute' ? 1.15 : 1); scene.add(r.root); return r; });
  const state = { style: 'idle', phase: 'startup', k: 0, frozen: false, mode: 'idle', mirror: false };
  const api = {
    set(style, phase = 'active', k = 0.5, mirror = false) { Object.assign(state, { style, phase, k, frozen: true, mirror, mode: style === 'idle' || style === 'move' || style === 'roll' || style === 'dead' || style === 'stagger' ? style : 'action' }); },
    play(style) { Object.assign(state, { style, frozen: false, mode: style === 'idle' || style === 'move' || style === 'roll' || style === 'dead' || style === 'stagger' ? style : 'action' }); },
    rigs, camera: cam,
  };
  window.__gal = api;
  const resize = () => { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();
  let t = 0, last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    cam.position.set(0, 3.2, 14.5); cam.lookAt(0, 1.2, 0);
    for (const r of rigs) {
      let st = { kind: state.mode, t, dt, moveAmt: state.mode === 'move' ? 1 : 0 };
      if (state.mode === 'action') {
        let phase, k;
        if (state.frozen) { phase = state.phase; k = state.k; }
        else { const c = (t % 1.6) / 1.6; if (c < 0.4) { phase = 'startup'; k = c / 0.4; } else if (c < 0.55) { phase = 'active'; k = (c - 0.4) / 0.15; } else { phase = 'recovery'; k = (c - 0.55) / 0.45; } }
        st.act = { style: state.style, phase, k, mirror: state.mirror, spinT: t * 16 };
      }
      if (state.mode === 'roll') st.rollK = state.frozen ? state.k : (t % 0.5) / 0.5;
      if (state.mode === 'dead') st.deadK = state.frozen ? state.k : Math.min(1, (t % 3) / 0.7);
      poseRig(r, st);
    }
    renderer.render(scene, cam);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
