// Procedural WebAudio: no asset files. Cue map covers input accepted, windup, contact, miss, damage, pickup, warning,
// death, objective. Voice-capped, unlocked from a user gesture, state-driven music (explore / combat / boss).
const PRIORITY = { hit: 2, hurt: 3, death: 3, levelup: 3, warn: 3, ui: 1, step: 0, swing: 1, spell: 1, pickup: 1 };

export class AudioSys {
  constructor() { this.ctx = null; this.master = null; this.muted = false; this.vol = 0.7; this.voices = 0; this.maxVoices = 22; this.music = { state: 'none' }; this.lastPlay = {}; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.vol; this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.gain.value = 1; this.sfx.connect(this.master);
    this.mus = this.ctx.createGain(); this.mus.gain.value = 0.5; this.mus.connect(this.master);
    this.noiseBuf = this.makeNoise();
    this.startMusic();
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = this.muted ? 0 : v; }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.vol; }
  makeNoise() { const n = this.ctx.sampleRate; const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return b; }

  env(g, t, a, d, peak) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  tone({ f = 440, f2, type = 'sine', a = 0.005, d = 0.2, v = 0.3, pan = 0, delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d);
    this.env(g, t, a, d, v); let n = o; n.connect(g);
    if (c.createStereoPanner && pan) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.sfx); } else g.connect(this.sfx);
    o.start(t); o.stop(t + a + d + 0.05); this.voices++; o.onended = () => { this.voices--; };
  }
  noise({ f = 1200, q = 1, type = 'bandpass', a = 0.005, d = 0.15, v = 0.3, f2, pan = 0, delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + d); fl.Q.value = q;
    const g = c.createGain(); this.env(g, t, a, d, v); s.connect(fl); fl.connect(g);
    if (c.createStereoPanner && pan) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.sfx); } else g.connect(this.sfx);
    s.start(t); s.stop(t + a + d + 0.05); this.voices++; s.onended = () => { this.voices--; };
  }

  /** name: cue id. opts: { pan, vol, prio } */
  play(name, opts = {}) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime, key = name;
    if (this.lastPlay[key] && now - this.lastPlay[key] < 0.035) return;
    this.lastPlay[key] = now;
    const prio = opts.prio ?? PRIORITY[name.split('_')[0]] ?? 1;
    if (this.voices >= this.maxVoices && prio < 2) return;
    const pan = opts.pan ?? 0, vv = opts.vol ?? 1;
    const T = (o) => this.tone({ pan, ...o, v: (o.v ?? 0.3) * vv }), N = (o) => this.noise({ pan, ...o, v: (o.v ?? 0.3) * vv });
    switch (name) {
      case 'swing': N({ f: 900, f2: 3200, q: 0.8, d: 0.14, v: 0.22 }); break;
      case 'swing_heavy': N({ f: 400, f2: 1800, q: 0.7, d: 0.28, v: 0.3 }); T({ f: 90, f2: 50, type: 'sine', d: 0.25, v: 0.3 }); break;
      case 'bash': N({ f: 500, d: 0.18, v: 0.35 }); T({ f: 120, f2: 60, d: 0.2, v: 0.4 }); break;
      case 'whirl': N({ f: 700, f2: 2400, q: 0.6, d: 0.3, v: 0.2 }); break;
      case 'charge': N({ f: 300, f2: 1200, d: 0.35, v: 0.3 }); T({ f: 70, f2: 140, type: 'sawtooth', d: 0.3, v: 0.12 }); break;
      case 'bow': T({ f: 220, f2: 90, type: 'triangle', d: 0.12, v: 0.25 }); N({ f: 2500, d: 0.08, v: 0.15 }); break;
      case 'ember': T({ f: 500, f2: 900, type: 'sawtooth', d: 0.18, v: 0.12 }); N({ f: 1800, d: 0.2, v: 0.15 }); break;
      case 'nova': T({ f: 800, f2: 200, type: 'triangle', d: 0.5, v: 0.25 }); N({ f: 4000, f2: 600, d: 0.45, v: 0.25 }); break;
      case 'arc': N({ f: 3000, q: 4, d: 0.22, v: 0.3 }); T({ f: 1400, f2: 300, type: 'square', d: 0.18, v: 0.1 }); break;
      case 'blink': T({ f: 300, f2: 1400, type: 'sine', d: 0.2, v: 0.25 }); N({ f: 2000, d: 0.2, v: 0.15 }); break;
      case 'slam': T({ f: 100, f2: 38, d: 0.5, v: 0.6 }); N({ f: 250, d: 0.35, v: 0.35 }); break;
      case 'toll': T({ f: 110, d: 1.4, v: 0.35 }); T({ f: 221, d: 1.1, v: 0.2 }); T({ f: 331, d: 0.8, v: 0.12 }); break;
      case 'rite': T({ f: 200, f2: 520, type: 'sawtooth', a: 0.4, d: 0.4, v: 0.12 }); break;
      case 'summon': T({ f: 90, f2: 180, type: 'sawtooth', a: 0.5, d: 1.0, v: 0.2 }); N({ f: 500, d: 1.2, a: 0.5, v: 0.15 }); break;
      case 'hit': N({ f: 1400, q: 1.2, d: 0.08, v: 0.3 }); T({ f: 160, f2: 70, d: 0.1, v: 0.3 }); break;
      case 'hit_crit': N({ f: 2200, q: 1, d: 0.12, v: 0.35 }); T({ f: 220, f2: 60, d: 0.18, v: 0.4 }); T({ f: 1200, f2: 600, type: 'triangle', d: 0.15, v: 0.15 }); break;
      case 'hurt': T({ f: 140, f2: 60, type: 'sawtooth', d: 0.25, v: 0.35 }); N({ f: 600, d: 0.15, v: 0.25 }); break;
      case 'death': T({ f: 200, f2: 40, type: 'sawtooth', d: 0.6, v: 0.25 }); N({ f: 500, f2: 100, d: 0.5, v: 0.25 }); break;
      case 'roll': N({ f: 600, f2: 200, type: 'lowpass', d: 0.3, v: 0.25 }); break;
      case 'pickup': T({ f: 880, f2: 1320, d: 0.12, v: 0.15 }); T({ f: 1320, d: 0.15, v: 0.1, delay: 0.07 }); break;
      case 'gold': T({ f: 1800, d: 0.06, v: 0.12 }); T({ f: 2400, d: 0.09, v: 0.1, delay: 0.04 }); break;
      case 'potion': N({ f: 700, f2: 300, d: 0.3, v: 0.2 }); T({ f: 300, f2: 500, d: 0.3, v: 0.12 }); break;
      case 'levelup': [523, 659, 784, 1047].forEach((f, i) => T({ f, type: 'triangle', d: 0.6, v: 0.2, delay: i * 0.09 })); break;
      case 'chest': T({ f: 120, f2: 80, d: 0.3, v: 0.3 }); [660, 880, 1100].forEach((f, i) => T({ f, d: 0.4, v: 0.12, delay: 0.1 + i * 0.08 })); break;
      case 'break': N({ f: 900, f2: 300, d: 0.3, v: 0.35 }); break;
      case 'gate': T({ f: 70, f2: 45, type: 'sawtooth', d: 0.6, v: 0.25 }); N({ f: 300, d: 0.6, v: 0.2 }); break;
      case 'push': N({ f: 200, type: 'lowpass', d: 0.3, v: 0.4 }); T({ f: 60, d: 0.3, v: 0.3 }); break;
      case 'puzzle_step': { const f = opts.note ? 330 * Math.pow(1.122, opts.note * 2) : 440; T({ f, type: 'triangle', d: 0.6, v: 0.25 }); T({ f: f * 2, d: 0.5, v: 0.08 }); break; }
      case 'puzzle_fail': T({ f: 110, f2: 70, type: 'sawtooth', d: 0.5, v: 0.3 }); N({ f: 400, d: 0.4, v: 0.25 }); break;
      case 'puzzle_solved': [392, 494, 587, 784].forEach((f, i) => T({ f, type: 'triangle', d: 1.0, v: 0.2, delay: i * 0.12 })); break;
      case 'rest': [330, 495, 660].forEach((f, i) => T({ f, d: 1.2, v: 0.12, delay: i * 0.1 })); break;
      case 'denied': T({ f: 150, f2: 110, type: 'square', d: 0.1, v: 0.1 }); break;
      case 'aggro': T({ f: 130, f2: 190, type: 'sawtooth', d: 0.25, v: 0.12 }); break;
      case 'ui': T({ f: 600, d: 0.05, v: 0.1 }); break;
      case 'ui_open': T({ f: 400, f2: 600, d: 0.08, v: 0.1 }); break;
      case 'unseal': T({ f: 80, f2: 160, type: 'sawtooth', d: 1.5, v: 0.3 }); break;
      case 'victory': [262, 330, 392, 523, 659, 784].forEach((f, i) => T({ f, type: 'triangle', d: 2.0, v: 0.16, delay: i * 0.25 })); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- music: drone bed + sparse bells + combat pulse
  startMusic() {
    const c = this.ctx;
    this.drone = [55, 55.4, 82.4].map((f, i) => { const o = c.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth'; o.frequency.value = f; const g = c.createGain(); g.gain.value = i === 2 ? 0.05 : 0.04; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; o.connect(lp); lp.connect(g); g.connect(this.mus); o.start(); return { o, g, lp }; });
    this.pulseGain = c.createGain(); this.pulseGain.gain.value = 0; this.pulseGain.connect(this.mus);
    this.nextBell = 0; this.nextBeat = 0; this.beat = 0;
    this.timer = setInterval(() => this.musicTick(), 120);
  }
  setMusicState(s) {
    if (!this.ctx || this.music.state === s) return;
    this.music.state = s;
    const t = this.ctx.currentTime;
    const lp = s === 'boss' ? 520 : s === 'combat' ? 360 : 220;
    for (const d of this.drone) d.lp.frequency.linearRampToValueAtTime(lp, t + 1.5);
    this.pulseGain.gain.linearRampToValueAtTime(s === 'explore' || s === 'title' ? 0 : s === 'combat' ? 0.5 : 0.8, t + 0.8);
  }
  musicTick() {
    if (!this.ctx || this.muted || document.hidden) return;
    const c = this.ctx, t = c.currentTime, s = this.music.state;
    if (t > this.nextBell && s !== 'combat') {
      const notes = [220, 261.6, 293.7, 349.2, 392]; const f = notes[Math.floor(Math.random() * notes.length)] * (Math.random() < 0.3 ? 2 : 1);
      const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f; this.env(g, t, 0.01, 2.8, 0.05); o.connect(g); g.connect(this.mus); o.start(t); o.stop(t + 3);
      this.nextBell = t + 3 + Math.random() * 5;
    }
    const bpm = s === 'boss' ? 104 : 84, step = 60 / bpm / 2;
    while (this.nextBeat < t + 0.25) {
      if (this.nextBeat < t) this.nextBeat = t;
      if (this.pulseGain.gain.value > 0.02) {
        const b = this.beat++ % 8, o = c.createOscillator(), g = c.createGain(); o.type = 'sine';
        if (b % 4 === 0) { o.frequency.setValueAtTime(90, this.nextBeat); o.frequency.exponentialRampToValueAtTime(40, this.nextBeat + 0.2); this.env(g, this.nextBeat, 0.005, 0.25, 0.5); }
        else if (b % 4 === 2 && s === 'boss') { o.frequency.setValueAtTime(140, this.nextBeat); o.frequency.exponentialRampToValueAtTime(60, this.nextBeat + 0.15); this.env(g, this.nextBeat, 0.005, 0.18, 0.3); }
        else { o.frequency.value = 0; this.env(g, this.nextBeat, 0.005, 0.01, 0.0001); }
        o.connect(g); g.connect(this.pulseGain); o.start(this.nextBeat); o.stop(this.nextBeat + 0.3);
      }
      this.nextBeat += step;
    }
  }
}
