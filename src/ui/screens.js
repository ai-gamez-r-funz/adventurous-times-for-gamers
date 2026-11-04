import { CLASSES, SKILLS } from '../data/classes.js';
import { STORY } from '../data/lore.js';
import { LORE } from '../data/lore.js';
import { ICON } from './icons.js';

const $ = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export const fmtTime = (s) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + 'h ' : ''}${Math.floor((s % 3600) / 60)}m ${Math.floor(s % 60)}s`;

export class Screens {
  constructor(root) { this.root = root; this.cur = null; }
  show(html, bind) {
    this.hide();
    const el = $(`<div class="screen">${html}</div>`); this.root.appendChild(el); this.cur = el;
    bind?.(el); el.querySelector('button:not(:disabled)')?.focus?.({ preventScroll: true });
    return el;
  }
  hide() { this.cur?.remove(); this.cur = null; }
  get open() { return !!this.cur; }

  title({ hasSave, onContinue, onNew, onSettings, onHelp }) {
    return this.show(`<h1 class="logo">EMBERHOLLOW</h1><div class="tag">${STORY.tagline}</div>
      <div class="menu"><button class="btn" data-a="cont" ${hasSave ? '' : 'disabled'}>Continue</button><button class="btn" data-a="new">New Game</button><button class="btn" data-a="help">Controls</button><button class="btn" data-a="set">Settings</button></div>
      <div class="help" style="margin-top:14px">An isometric gothic action-RPG · v0.1</div>`, (el) => {
      el.querySelector('[data-a=cont]').onclick = onContinue; el.querySelector('[data-a=new]').onclick = onNew; el.querySelector('[data-a=set]').onclick = onSettings; el.querySelector('[data-a=help]').onclick = onHelp;
    });
  }
  classSelect({ onPick, onBack, hover }) {
    const card = (c) => `<div class="card" data-c="${c.id}" tabindex="0" role="button"><h3>${c.name}</h3><div class="sub">${c.title}</div><p>${c.blurb}</p><ul>${c.skills.map((s) => `<li>${SKILLS[s].name}</li>`).join('')}</ul></div>`;
    return this.show(`<div class="tag" style="margin:0">Choose your champion</div><div class="cards">${Object.values(CLASSES).map(card).join('')}</div><button class="btn small" data-a="back">Back</button>`, (el) => {
      for (const c of el.querySelectorAll('.card')) { c.onclick = () => onPick(c.dataset.c); c.onkeydown = (e) => { if (e.key === 'Enter') onPick(c.dataset.c); }; c.onmouseenter = c.onfocus = () => { hover?.(c.dataset.c); for (const o of el.querySelectorAll('.card')) o.classList.toggle('sel', o === c); }; }
      el.querySelector('[data-a=back]').onclick = onBack;
    });
  }
  intro({ onBegin }) {
    return this.show(`<div class="story">${STORY.intro.map((l) => `<p>${esc(l)}</p>`).join('')}</div><button class="btn">Descend</button>`, (el) => { el.querySelector('button').onclick = onBegin; });
  }
  pause({ onResume, onSettings, onHelp, onQuit, onSave }) {
    return this.show(`<h1 class="logo" style="font-size:44px">PAUSED</h1><div class="menu"><button class="btn" data-a="r">Resume</button><button class="btn" data-a="h">Controls</button><button class="btn" data-a="s">Settings</button><button class="btn" data-a="v">Save</button><button class="btn" data-a="q">Save &amp; Quit to Title</button></div>`, (el) => {
      el.classList.add('dim'); el.querySelector('[data-a=r]').onclick = onResume; el.querySelector('[data-a=s]').onclick = onSettings; el.querySelector('[data-a=h]').onclick = onHelp; el.querySelector('[data-a=q]').onclick = onQuit;
      el.querySelector('[data-a=v]').onclick = (e) => { onSave(); e.target.textContent = 'Saved ✓'; };
    });
  }
  settings({ s, onChange, onBack }) {
    return this.show(`<div class="panel center"><h2><span>Settings</span></h2><div class="body">
      <div class="row"><label for="s-ctl">Controls</label><select id="s-ctl"><option value="mouse">Mouse (Diablo-style)</option><option value="wasd">WASD + mouse aim</option></select></div>
      <div class="row"><label for="s-vol">Volume</label><input id="s-vol" type="range" min="0" max="100" value="${Math.round(s.volume * 100)}"></div>
      <div class="row"><label for="s-mute">Mute</label><input id="s-mute" type="checkbox" ${s.muted ? 'checked' : ''}></div>
      <div class="row"><label for="s-q">Graphics</label><select id="s-q"><option value="auto">Auto</option><option value="high">High (bloom)</option><option value="low">Low (fast)</option></select></div>
      <div class="row"><label for="s-rm">Reduced motion (no shake / flashes)</label><input id="s-rm" type="checkbox" ${s.reducedMotion ? 'checked' : ''}></div>
      <div class="row"><label for="s-lab">Always show item labels</label><input id="s-lab" type="checkbox" ${s.labels ? 'checked' : ''}></div>
      <div style="text-align:center;margin-top:12px"><button class="btn" data-a="b">Back</button></div></div></div>`, (el) => {
      el.classList.add('dim'); el.querySelector('#s-q').value = s.quality; el.querySelector('#s-ctl').value = s.controls ?? 'mouse';
      const upd = () => onChange({ volume: el.querySelector('#s-vol').value / 100, muted: el.querySelector('#s-mute').checked, quality: el.querySelector('#s-q').value, reducedMotion: el.querySelector('#s-rm').checked, labels: el.querySelector('#s-lab').checked, controls: el.querySelector('#s-ctl').value });
      for (const i of el.querySelectorAll('input,select')) i.oninput = i.onchange = upd;
      el.querySelector('[data-a=b]').onclick = onBack;
    });
  }
  help({ onBack }) {
    return this.show(`<div class="panel center"><h2><span>Controls</span></h2><div class="body"><div class="kv">
      <b>Left click</b><span>Move · click an enemy to attack and lock on (it follows the target) · click loot / objects to use them</span>
      <b>Hold left</b><span>Keep moving toward the cursor, or keep attacking the locked enemy</span><b>Right click</b><span>Second skill (aims at your locked target)</span>
      <b>1 2 3 4 / Q R</b><span>Skills (unlock as you level)</span><b>Shift (hold)</b><span>HOLD POSITION: you never move; clicks only attack / cast toward the cursor</span>
      <b>E</b><span>Interact: chests, tablets, waystones, braziers…</span>
      <b>F / G</b><span>Life / resource potion</span><b>I · C · M · Esc</b><span>Inventory · Codex · Mute · Menu</span>
      <b>Defence</b><span>Passive: <b>Dodge</b> avoids a hit, <b>Block</b> halves one. Gear and class raise them. Escape with movement and Ember Blink!</span>
      <b>Settings → Controls</b><span>Switch to WASD + mouse aim (LMB = primary skill) if you prefer</span><b>Mouse wheel</b><span>Zoom</span><b>Touch</b><span>Left thumb: stick · right: buttons · tap to move / target</span></div>
      <p class="help" style="margin-top:12px"><b>Tips:</b> red shapes on the floor are attacks about to land — step out of them. Push coffins by walking into them. Waystones heal you and set your respawn. Cracked stone hides relics.</p>
      <div style="text-align:center"><button class="btn" data-a="b">Back</button></div></div></div>`, (el) => { el.classList.add('dim'); el.querySelector('[data-a=b]').onclick = onBack; });
  }
  death({ onRespawn, onTitle }) {
    return this.show(`<div class="deathtxt">YOU DIED</div><div class="menu"><button class="btn" data-a="r">Return to waystone</button><button class="btn small" data-a="t">Quit to title</button></div>`, (el) => { el.classList.add('dim'); el.querySelector('[data-a=r]').onclick = onRespawn; el.querySelector('[data-a=t]').onclick = onTitle; });
  }
  victory({ game, onContinue, onTitle }) {
    const pr = game.progress, st = pr.stats;
    return this.show(`<h1 class="logo" style="font-size:54px">THE VIGIL BURNS</h1><div class="story">${STORY.victory.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
      <div class="kv" style="margin:8px 0"><b>Time</b><span>${fmtTime(st.time)}</span><b>Level</b><span>${game.player.level}</span><b>Slain</b><span>${st.kills}</span><b>Deaths</b><span>${st.deaths}</span><b>Relics</b><span>${pr.relics.length}/5</span><b>Fragments</b><span>${pr.lore.length}/${Object.keys(LORE).length}</span></div>
      <div class="menu"><button class="btn" data-a="c">Keep exploring</button><button class="btn small" data-a="t">Quit to title</button></div>`, (el) => { el.classList.add('dim'); el.querySelector('[data-a=c]').onclick = onContinue; el.querySelector('[data-a=t]').onclick = onTitle; });
  }
  lore({ id, onClose }) {
    const l = LORE[id];
    return this.show(`<div class="panel center"><h2><span>${esc(l.title)}</span><button class="xbtn" aria-label="Close">${ICON.close}</button></h2><div class="body"><p class="story" style="margin:0">${esc(l.text)}</p><div style="text-align:center;margin-top:14px"><button class="btn small">Close</button></div></div></div>`, (el) => { el.querySelector('.xbtn').onclick = onClose; el.querySelector('.btn').onclick = onClose; });
  }
  error(msg) {
    return this.show(`<h1 class="logo" style="font-size:36px">EMBERHOLLOW</h1><div class="story">${esc(msg)}</div>`);
  }
}
