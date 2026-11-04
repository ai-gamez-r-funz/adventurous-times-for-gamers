import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LightRig } from '../src/render/lights.js';

const mkEmitter = (scene, x, z) => { const o = new THREE.Object3D(); o.position.set(x, 1, z); scene.add(o); return o; };

describe('motivated light pool', () => {
  it('refuses an emitter with no visible object (no floating lights)', () => {
    const rig = new LightRig(new THREE.Scene(), { poolSize: 3 });
    expect(() => rig.register({ id: 'x', type: 'torch', color: 0xffffff, intensity: 10, range: 5 })).toThrow();
  });

  it('assigns pool lights only to the nearest enabled emitters and traces each to its emitter', () => {
    const scene = new THREE.Scene(), rig = new LightRig(scene, { poolSize: 3 });
    const objs = [0, 4, 8, 12, 16].map((x, i) => { const o = mkEmitter(scene, x, 0); rig.register({ id: `t${i}`, type: 'torch', object: o, color: 0xff8800, intensity: 10, range: 8 }); return o; });
    for (let i = 0; i < 60; i++) rig.update(1 / 60, i / 60, { x: 0, z: 0 });
    const inv = rig.inventory();
    expect(inv.filter((e) => e.light >= 0).map((e) => e.emitterId).sort()).toEqual(['t0', 't1', 't2']);
    expect(rig.verify()).toEqual([]);
    // light follows a moving emitter
    objs[0].position.x = 2;
    rig.update(1 / 60, 2, { x: 0, z: 0 });
    const slot = rig.pool.find((s) => s.emitterId === 't0');
    expect(slot.light.position.x).toBeCloseTo(2, 5);
  });

  it('a disabled emitter loses its light, and a removed one never leaves an orphan', () => {
    const scene = new THREE.Scene(), rig = new LightRig(scene, { poolSize: 2 });
    let on = true;
    const a = mkEmitter(scene, 0, 0), b = mkEmitter(scene, 3, 0);
    rig.register({ id: 'brazier', type: 'brazier', object: a, color: 0xff8800, intensity: 12, range: 8, enabled: () => on });
    rig.register({ id: 'glyph', type: 'glyph', object: b, color: 0x66ccff, intensity: 8, range: 5 });
    for (let i = 0; i < 40; i++) rig.update(1 / 60, i / 60, { x: 0, z: 0 });
    expect(rig.pool.some((s) => s.emitterId === 'brazier' && s.light.intensity > 1)).toBe(true);
    on = false;
    for (let i = 0; i < 120; i++) rig.update(1 / 60, 1 + i / 60, { x: 0, z: 0 });
    expect(rig.pool.some((s) => s.emitterId === 'brazier')).toBe(false);
    scene.remove(b); // emitter vanished from the scene while still enabled -> verify() must flag it
    expect(rig.verify().length).toBeGreaterThan(0);
    rig.unregister('glyph');
    for (let i = 0; i < 120; i++) rig.update(1 / 60, 3 + i / 60, { x: 0, z: 0 });
    expect(rig.verify()).toEqual([]);
    expect(rig.pool.every((s) => s.light.intensity < 0.02)).toBe(true);
  });

  it('the player lantern priority wins the pool even when far from the focus', () => {
    const scene = new THREE.Scene(), rig = new LightRig(scene, { poolSize: 1 });
    rig.register({ id: 'torch', type: 'torch', object: mkEmitter(scene, 0, 0), color: 0xff8800, intensity: 10, range: 8 });
    rig.register({ id: 'lantern', type: 'lantern', object: mkEmitter(scene, 6, 0), color: 0xffe0a0, intensity: 10, range: 8, priority: 1 });
    for (let i = 0; i < 30; i++) rig.update(1 / 60, i / 60, { x: 0, z: 0 });
    expect(rig.pool[0].emitterId).toBe('lantern');
  });
});
