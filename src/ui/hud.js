// HUD + panels (inventory, codex). DOM-based, reads simulation state, never mutates it except through Game methods.
import { ICON, slotIcon } from './icons.js';
import { SKILLS, CLASSES, xpToNext, MAX_LEVEL } from '../data/classes.js';
import { BASES, RARITY, SLOTS, SLOT_LABEL, UNIQUES, STAT_LABEL, BAG_SIZE } from '../data/items.js';
import { itemStats } from '../sim/stats.js';
import { LORE, RELICS, SIGILS } from '../data/lore.js';
import { ENEMIES, NAMES } from '../data/enemies.js';
import { CHAMBERS } from '../data/chambers.js';
import { canEquip } from '../sim/inventory.js';

const $ = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString();
export const rarityColor = (r) => RARITY[r].color;

export function itemTipHtml(item, game, { compare = true } = {}) {
  const base = BASES[item.baseId], st = itemStats(item), r = RARITY[item.rarity];
  const lines = [];
  if (st.dmg) lines.push(`<div class="base">${Math.round(st.dmg[0])}–${Math.round(st.dmg[1])} Damage</div>`);
  if (st.armor && !item.affixes.some((a) => a.id === 'armor' && a.v === st.armor)) lines.push(`<div class="base">${Math.round(item.unique ? st.armor : (base.stats.armor ?? 0))} Armor</div>`);
  if (item.unique) for (const [k, v] of Object.entries(st)) { if (k === 'dmg' || k === 'armor') continue; if (STAT_LABEL[k]) lines.push(`<div class="aff">${STAT_LABEL[k](v)}</div>`); }
  else {
    for (const [k, v] of Object.entries(base.stats)) { if (k === 'dmg' || k === 'armor') continue; if (STAT_LABEL[k]) lines.push(`<div class="base">${STAT_LABEL[k](v)}</div>`); }
    for (const a of item.affixes) if (STAT_LABEL[a.id]) lines.push(`<div class="aff">${STAT_LABEL[a.id](a.v)}</div>`);
  }
  let cmp = '';
  const eq = game.inv.equip[base.slot];
  if (compare && eq && eq.uid !== item.uid) {
    const a = itemStats(eq);
    const avg = (s) => (s.dmg ? (s.dmg[0] + s.dmg[1]) / 2 : 0);
    const d1 = avg(st) - avg(a), d2 = (st.armor ?? 0) - (a.armor ?? 0), d3 = (st.hp ?? 0) - (a.hp ?? 0);
    const part = (n, label) => (Math.abs(n) < 0.5 ? '' : `<span class="${n > 0 ? 'up' : 'dn'}">${n > 0 ? '▲' : '▼'} ${Math.abs(Math.round(n))} ${label}</span> `);
    const t = part(d1, 'dmg') + part(d2, 'armor') + part(d3, 'life');
    if (t) cmp = `<div class="sub" style="margin-top:6px">vs equipped: ${t}</div>`;
  }
  const ok = canEquip(item, game.classId);
  return `<div class="nm" style="color:${r.color}">${esc(item.name)}</div><div class="sub">${r.label} ${esc(base.name)} · ${SLOT_LABEL[base.slot]} · ilvl ${item.ilvl}</div>${lines.join('')}${item.unique ? `<div class="sub" style="margin-top:6px;font-style:italic">${esc(UNIQUES[item.unique].lore)}</div>` : ''}${ok.ok ? '' : `<div class="dn">Cannot be used by the ${CLASSES[game.classId].name}</div>`}${cmp}`;
}

const PROMPTS = { chest: 'Open chest', lore: 'Read inscription', waystone: 'Rest at waystone', altar: 'Take the sigil', brazier: 'Light brazier', pedestal: 'Awaken the glyphs', resetrune: 'Reset the coffins' };

export class Hud {
  constructor(root, ctx) {
    this.root = root; this.ctx = ctx; // { view, getGame, input, audio, settings }
    this.game = null; this.floaters = []; this.labels = new Map(); this.mapT = 0; this.sel = null; this.invOpen = false; this.codexOpen = false;
    this.cache = {};
    this.build();
  }
  build() {
    this.el = $(`<div id="hud" class="hidden">
      <div id="tracker"><div class="name"></div><div class="obj"></div><div class="counts"></div></div>
      <canvas id="minimap" width="300" height="300"></canvas>
      <div id="topbtns"><button class="xbtn" id="b-inv" title="Inventory (I)" aria-label="Inventory">${ICON.bag}</button><button class="xbtn" id="b-codex" title="Codex (C)" aria-label="Codex">${ICON.scroll}</button><button class="xbtn" id="b-menu" title="Menu (Esc)" aria-label="Menu">${ICON.menu}</button></div>
      <div id="bossbar" class="hidden"><div class="n"></div><div class="bar"><i></i></div></div>
      <div id="target" class="hidden"><div class="n"></div><div class="bar"><i></i></div></div>
      <div id="toasts" aria-live="polite"></div>
      <div id="prompt" class="hidden" role="button"></div>
      <div class="orb hp"><div class="fill"></div><div class="txt"></div></div>
      <div class="orb mana"><div class="fill"></div><div class="txt"></div></div>
      <div id="skillbar"></div>
      <div id="lvl"></div><div id="xpbar"><i></i></div>
      <div id="floaters"></div><div id="labels"></div>
      <div id="touch"><div id="joy"><i></i></div></div>
    </div>`);
    this.root.appendChild(this.el);
    this.fade = $('<div id="fade"></div>'); this.root.appendChild(this.fade);
    const q = (s) => this.el.querySelector(s);
    this.q = q;
    this.skillbar = q('#skillbar'); this.toasts = q('#toasts'); this.floatRoot = q('#floaters'); this.labelRoot = q('#labels');
    q('#b-inv').onclick = () => this.toggleInv(); q('#b-codex').onclick = () => this.toggleCodex(); q('#b-menu').onclick = () => this.ctx.onMenu?.();
    q('#prompt').onclick = () => this.ctx.input.interact();
    this.inv = $('<div id="invpanel" class="panel hidden"></div>'); this.root.appendChild(this.inv);
    this.codex = $('<div id="codex" class="panel hidden"></div>'); this.root.appendChild(this.codex);
    this.buildTouch();
  }
  buildTouch() {
    const t = this.q('#touch'), input = this.ctx.input;
    const mk = (cls, icon, style, fn, extra = '') => { const b = $(`<button class="tbtn ${cls}" style="${style}" aria-label="${extra}">${icon}<div class="cd"></div></button>`); b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }); t.appendChild(b); return b; };
    const sa = 'env(safe-area-inset-right)', sb = 'env(safe-area-inset-bottom)';
    this.tb = {
      atk: mk('big', ICON.cleave, `right:calc(100px + ${sa});bottom:calc(14px + ${sb})`, () => { input.skillSlot(0); }, 'Attack'),
      s1: mk('', ICON.bash, `right:calc(196px + ${sa});bottom:calc(30px + ${sb})`, () => input.skillSlot(1), 'Skill 2'),
      s2: mk('', ICON.whirl, `right:calc(176px + ${sa});bottom:calc(104px + ${sb})`, () => input.skillSlot(2), 'Skill 3'),
      s3: mk('', ICON.charge, `right:calc(112px + ${sa});bottom:calc(120px + ${sb})`, () => input.skillSlot(3), 'Skill 4'),
      hold: mk('', ICON.hold, `right:calc(14px + ${sa});bottom:calc(112px + ${sb})`, () => { const on = input.toggleStandTouch(); this.tb.hold.style.borderColor = on ? '#ffd070' : ''; this.tb.hold.style.background = on ? '#5a4420cc' : ''; }, 'Hold position'),
      hp: mk('', ICON.hp, `left:calc(104px + env(safe-area-inset-left));bottom:calc(10px + ${sb});color:#ff8a8a;width:52px;height:52px;padding:12px`, () => input.potion('hp'), 'Health potion'),
      mp: mk('', ICON.mana, `right:calc(104px + ${sa});bottom:calc(-60px + ${sb});display:none`, () => input.potion('mana'), 'Resource potion'),
    };
    this.tb.mp.style.cssText = `right:calc(14px + ${sa});bottom:calc(190px + ${sb});color:#8ab0ff;width:52px;height:52px;padding:12px`;
  }

  bind(game) {
    this.unbind(); this.game = game;
    const on = (t, f) => (this.unsubs ??= []).push(game.on(t, f));
    this.buildSkillbar();
    on('toast', (e) => this.toast(e.text, e.kind));
    on('hit', (e) => this.onHit(e));
    on('xp', (e) => { /* shown in bar */ void e; });
    on('pickup', (e) => { const l = e.loot; if (l.kind === 'gold') this.float(game.player.x, game.player.z, `+${l.amount} gold`, 'info'); else if (l.kind === 'potion') this.float(game.player.x, game.player.z, '+ potion', 'info'); else this.float(game.player.x, game.player.z, esc(l.item.name), 'info', rarityColor(l.item.rarity)); this.ctx.audio.play(l.kind === 'gold' ? 'gold' : 'pickup'); });
    on('dodged', (e) => { this.float(e.x, e.z, 'Dodged', 'info'); this.ctx.audio.play('roll', { vol: 0.6 }); });
    on('potion', (e) => { const p = game.player; this.float(p.x, p.z, e.kind === 'hp' ? '+ life' : '+ resource', 'heal'); this.ctx.audio.play('potion'); });
    on('inventory', () => { this.refreshInv(); });
    on('lore', (e) => this.ctx.onLore?.(e));
    on('chamber', () => { this.clearLabels(); this.cache = {}; });
    on('transition', (e) => { this.fade.classList.toggle('on', e.phase === 'out'); });
    on('respawn', () => this.fade.classList.remove('on'));
    this.refreshInv();
  }
  unbind() { for (const u of this.unsubs ?? []) u(); this.unsubs = []; }
  show(v) { this.el.classList.toggle('hidden', !v); if (!v) { this.closePanels(); } }

  buildSkillbar() {
    const g = this.game, c = CLASSES[g.classId];
    this.skillbar.innerHTML = '';
    this.slots = c.skills.map((id, i) => {
      const s = SKILLS[id], keys = ['LMB', 'RMB', 'Q', 'R'];
      const el = $(`<div class="slot" data-slot="${i}" title="${esc(s.name)} — ${esc(s.desc)} (${keys[i]} or ${i + 1})"><div class="key">${keys[i]}</div>${ICON[s.icon]}<div class="cd"></div><div class="cdt"></div></div>`);
      el.onpointerdown = (e) => { e.stopPropagation(); this.ctx.input.skillSlot(i); };
      this.skillbar.appendChild(el); return { el, s, cd: el.querySelector('.cd'), cdt: el.querySelector('.cdt') };
    });
    const sep = $('<div style="width:10px"></div>'); this.skillbar.appendChild(sep);
    const mk = (cls, icon, key, fn, title) => { const el = $(`<div class="slot small ${cls}" title="${title}"><div class="key">${key}</div>${icon}<div class="cd"></div><div class="cnt"></div></div>`); el.onpointerdown = (e) => { e.stopPropagation(); fn(); }; this.skillbar.appendChild(el); return { el, cd: el.querySelector('.cd'), cnt: el.querySelector('.cnt') }; };
    this.holdSlot = mk('hold', ICON.hold, 'SHIFT', () => this.ctx.input.toggleStandTouch(), 'Hold position (Shift): never move; clicks attack and cast toward the cursor');
    this.hpSlot = mk('pot-hp', ICON.hp, 'F', () => this.ctx.input.potion('hp'), 'Health potion (F)');
    this.mpSlot = mk('pot-mana', ICON.mana, 'G', () => this.ctx.input.potion('mana'), 'Resource potion (G)');
    this.q('.orb.mana').className = `orb mana res-${g.classId}`;
    const t = this.tb;
    t.atk.firstChild.outerHTML = ICON[SKILLS[c.skills[0]].icon]; // icon swap
    const set = (b, i) => { const old = b.querySelector('svg'); old.outerHTML = ICON[SKILLS[c.skills[i]].icon]; };
    set(t.s1, 1); set(t.s2, 2); set(t.s3, 3);
  }

  // ------------------------------------------------------------ small widgets
  toast(text, kind = 'info') {
    const t = $(`<div class="toast ${kind}">${esc(text)}</div>`);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    setTimeout(() => t.remove(), 4300);
  }
  float(x, z, text, kind = 'enemy', color) {
    if (this.floaters.length > 40) { const o = this.floaters.shift(); o.el.remove(); }
    const el = $(`<div class="dmg ${kind}">${text}</div>`); if (color) el.style.color = color;
    this.floatRoot.appendChild(el);
    this.floaters.push({ el, x: x + (Math.random() - 0.5) * 0.5, z: z + (Math.random() - 0.5) * 0.5, t: 0, kind });
  }
  onHit(e) {
    const toPlayer = e.target.kind === 'player';
    if (e.target.prop) return;
    this.float(e.x, e.z, e.blocked ? `${e.amount} blocked` : `${e.amount}`, `${toPlayer ? 'player' : 'enemy'}${e.crit ? ' crit' : ''}`);
    const a = this.ctx.audio, pan = this.pan(e.x);
    a.play(toPlayer ? 'hurt' : e.crit ? 'hit_crit' : 'hit', { pan });
  }
  pan(x) { const p = this.game.player; return Math.max(-0.8, Math.min(0.8, (x - p.x) * 0.08)); }
  clearLabels() { for (const l of this.labels.values()) l.el.remove(); this.labels.clear(); }

  // ------------------------------------------------------------ inventory
  toggleInv(force) {
    this.invOpen = force ?? !this.invOpen; this.inv.classList.toggle('hidden', !this.invOpen);
    if (this.invOpen) { this.codexOpen = false; this.codex.classList.add('hidden'); this.refreshInv(); this.ctx.audio.play('ui_open'); }
    this.ctx.onPanel?.();
  }
  toggleCodex(force) {
    this.codexOpen = force ?? !this.codexOpen; this.codex.classList.toggle('hidden', !this.codexOpen);
    if (this.codexOpen) { this.invOpen = false; this.inv.classList.add('hidden'); this.tab ??= 'lore'; this.refreshCodex(); this.ctx.audio.play('ui_open'); }
    this.ctx.onPanel?.();
  }
  closePanels() { this.invOpen = this.codexOpen = false; this.inv.classList.add('hidden'); this.codex.classList.add('hidden'); }
  get panelOpen() { return this.invOpen || this.codexOpen; }

  refreshInv() {
    if (!this.invOpen || !this.game) return;
    const g = this.game, inv = g.inv, st = g.stats, p = g.player;
    const cell = (item, kind, key, slot) => {
      const rc = item ? rarityColor(item.rarity) : '';
      const ic = item ? slotIcon(BASES[item.baseId].slot) : (kind === 'eq' ? slotIcon(slot) : '');
      const sel = this.sel && this.sel.kind === kind && this.sel.key === key;
      return `<div class="cell ${item ? 'has' : ''} ${sel ? 'sel' : ''}" draggable="${!!item}" data-kind="${kind}" data-key="${key}" style="${item ? `color:${rc};border-color:${rc}88` : ''}" tabindex="0" role="button" aria-label="${item ? esc(item.name) : 'empty'}">${ic}</div>`;
    };
    const eq = SLOTS.map((s) => `<div class="eslot">${cell(inv.equip[s], 'eq', s, s)}<div class="lab">${SLOT_LABEL[s]}</div></div>`).join('');
    const bag = inv.bag.map((it, i) => cell(it, 'bag', i)).join('');
    const avg = (st.dmgMin + st.dmgMax) / 2;
    this.inv.innerHTML = `<h2><span>${CLASSES[g.classId].name} · Level ${p.level}</span><button class="xbtn" aria-label="Close">${ICON.close}</button></h2>
      <div class="cols"><div class="equip">${eq}</div>
      <div class="stats"><div><b>Life</b> ${fmt(p.hp)} / ${fmt(st.maxHp)}</div><div><b>${CLASSES[g.classId].resource}</b> ${fmt(p.mana)} / ${fmt(st.maxMana)}</div><div><b>Damage</b> ${st.dmgMin.toFixed(0)}–${st.dmgMax.toFixed(0)} <small>(avg ${avg.toFixed(1)})</small></div><div><b>Armor</b> ${st.armor}</div><div><b>Dodge</b> ${st.dodge}% · <b>Block</b> ${st.block}%</div><div><b>Crit</b> ${st.crit.toFixed(0)}%</div><div><b>Move</b> ${st.speed.toFixed(1)} m/s</div>${st.atkSpeed ? `<div><b>Atk speed</b> +${st.atkSpeed}%</div>` : ''}${st.leech ? `<div><b>Life/hit</b> ${st.leech}</div>` : ''}<div><b>Regen</b> ${st.manaRegen.toFixed(1)}/s</div><div class="gold"><i>${ICON.gold}</i> ${fmt(inv.gold)}</div><div>Potions: <span style="color:#ff8a8a">${inv.potions.hp}</span> · <span style="color:#8ab0ff">${inv.potions.mana}</span></div></div></div>
      <div class="cols" style="padding-top:0"><div class="bag">${bag}</div><div class="tip" id="tip"><small style="color:var(--dim)">Select an item. Double-click or press Equip. Drag to rearrange.</small></div></div>`;
    this.inv.querySelector('.xbtn').onclick = () => this.toggleInv(false);
    for (const c of this.inv.querySelectorAll('.cell')) {
      const kind = c.dataset.kind, key = kind === 'bag' ? Number(c.dataset.key) : c.dataset.key;
      c.onclick = () => { this.sel = { kind, key }; this.refreshInv(); this.ctx.audio.play('ui'); };
      c.ondblclick = () => { this.sel = { kind, key }; this.act('equip'); };
      c.oncontextmenu = (e) => { e.preventDefault(); this.sel = { kind, key }; this.act('equip'); };
      c.onkeydown = (e) => { if (e.key === 'Enter') c.click(); };
      c.ondragstart = (e) => { e.dataTransfer.setData('text/plain', `${kind}:${key}`); };
      c.ondragover = (e) => { e.preventDefault(); c.classList.add('over'); };
      c.ondragleave = () => c.classList.remove('over');
      c.ondrop = (e) => { e.preventDefault(); c.classList.remove('over'); this.drop(e.dataTransfer.getData('text/plain'), kind, key); };
    }
    this.renderTip();
  }
  itemAt(sel) { const inv = this.game.inv; if (!sel) return null; return sel.kind === 'bag' ? inv.bag[sel.key] : inv.equip[sel.key]; }
  renderTip() {
    const tip = this.inv.querySelector('#tip'); if (!tip) return;
    const item = this.itemAt(this.sel);
    if (!item) return;
    const isEq = this.sel.kind === 'eq';
    tip.innerHTML = itemTipHtml(item, this.game, { compare: !isEq }) + `<div class="acts"><button class="btn small" data-a="equip">${isEq ? 'Unequip' : 'Equip'}</button>${isEq ? '' : '<button class="btn small" data-a="drop">Drop</button>'}</div>`;
    for (const b of tip.querySelectorAll('button')) b.onclick = () => this.act(b.dataset.a);
  }
  act(a) {
    const g = this.game, s = this.sel; if (!s) return;
    if (a === 'equip') { if (s.kind === 'bag') { if (g.equip(s.key)) this.ctx.audio.play('ui_open'); else this.ctx.audio.play('denied'); } else { g.unequip(s.key); this.sel = null; } }
    else if (a === 'drop' && s.kind === 'bag') { g.dropItem(s.key); this.sel = null; }
    this.refreshInv();
  }
  drop(src, kind, key) {
    const [sk, sv] = src.split(':'); const g = this.game;
    if (sk === 'bag' && kind === 'bag') g.moveItem(Number(sv), key);
    else if (sk === 'bag' && kind === 'eq') { const i = Number(sv), it = g.inv.bag[i]; if (it && BASES[it.baseId].slot === key) g.equip(i); else this.ctx.audio.play('denied'); }
    else if (sk === 'eq' && kind === 'bag') g.unequip(sv);
    this.refreshInv();
  }

  // ------------------------------------------------------------ codex
  refreshCodex() {
    if (!this.codexOpen) return;
    const g = this.game, pr = g.progress, tab = this.tab;
    const tabs = [['lore', 'Fragments'], ['relics', 'Relics & Sigils'], ['items', 'Treasures'], ['beasts', 'Bestiary']];
    let body = '';
    if (tab === 'lore') body = Object.values(LORE).map((l) => pr.lore.includes(l.id) ? `<div class="entry"><h4>${esc(l.title)}</h4><p>${esc(l.text)}</p><small>${esc(CHAMBERS[l.chamber].name)}</small></div>` : `<div class="entry locked"><h4>? ? ?</h4><small>Undiscovered · ${esc(CHAMBERS[l.chamber].name)}</small></div>`).join('');
    else if (tab === 'relics') body = Object.values(SIGILS).map((s) => `<div class="entry ${pr.sigils.includes(s.id) ? '' : 'locked'}"><h4>${esc(s.name)}</h4><p>${esc(pr.sigils.includes(s.id) ? s.text : 'Guarded within the wings of the abbey.')}</p></div>`).join('') + Object.values(RELICS).map((r) => `<div class="entry ${pr.relics.includes(r.id) ? '' : 'locked'}"><h4>${pr.relics.includes(r.id) ? esc(r.name) : 'Hidden relic'}</h4><p>${esc(pr.relics.includes(r.id) ? r.text : `Look for cracked stone in ${CHAMBERS[r.chamber].name}.`)}</p></div>`).join('');
    else if (tab === 'items') body = Object.values(UNIQUES).map((u) => `<div class="entry ${pr.uniques.includes(u.id) ? '' : 'locked'}"><h4 style="color:${RARITY.legendary.color}">${pr.uniques.includes(u.id) ? esc(u.name) : 'Unknown relic'}</h4><p>${pr.uniques.includes(u.id) ? esc(u.lore) : 'Found only in the great chests of the abbey.'}</p></div>`).join('');
    else body = Object.values(ENEMIES).map((e) => { const n = pr.bestiary[e.id] ?? 0; return `<div class="entry ${n ? '' : 'locked'}"><h4>${n ? esc(e.name) : '???'}</h4><small>Slain: ${n}</small></div>`; }).join('');
    const total = Object.keys(LORE).length + Object.keys(RELICS).length + Object.keys(UNIQUES).length + 3;
    const have = pr.lore.length + pr.relics.length + pr.uniques.length + pr.sigils.length;
    this.codex.innerHTML = `<h2><span>Codex · ${have}/${total} collected</span><button class="xbtn" aria-label="Close">${ICON.close}</button></h2><div class="tabs">${tabs.map(([id, l]) => `<button class="tab ${id === tab ? 'on' : ''}" data-t="${id}">${l}</button>`).join('')}</div><div class="content">${body}</div>`;
    this.codex.querySelector('.xbtn').onclick = () => this.toggleCodex(false);
    for (const b of this.codex.querySelectorAll('.tab')) b.onclick = () => { this.tab = b.dataset.t; this.refreshCodex(); this.ctx.audio.play('ui'); };
  }

  // ------------------------------------------------------------ per-frame
  update(dt) {
    const g = this.game; if (!g || this.el.classList.contains('hidden')) return;
    const p = g.player, st = g.stats, view = this.ctx.view, input = this.ctx.input, c = this.cache;
    const set = (key, val, fn) => { if (c[key] !== val) { c[key] = val; fn(val); } };
    const hpR = Math.max(0, p.hp / st.maxHp), mpR = Math.max(0, p.mana / st.maxMana);
    set('hp', Math.round(hpR * 200), () => { this.q('.orb.hp .fill').style.height = `${hpR * 100}%`; });
    set('hpt', `${Math.ceil(p.hp)}`, (v) => { this.q('.orb.hp .txt').textContent = v; });
    set('mp', Math.round(mpR * 200), () => { this.q('.orb.mana .fill').style.height = `${mpR * 100}%`; });
    set('mpt', `${Math.floor(p.mana)}`, (v) => { this.q('.orb.mana .txt').textContent = v; });
    set('xp', `${p.level}:${Math.round((p.level >= MAX_LEVEL ? 1 : p.xp / xpToNext(p.level)) * 500)}`, () => { this.q('#xpbar i').style.width = `${(p.level >= MAX_LEVEL ? 1 : p.xp / xpToNext(p.level)) * 100}%`; this.q('#lvl').textContent = `LEVEL ${p.level} · ${CLASSES[g.classId].name.toUpperCase()}`; });
    // skills
    this.slots.forEach(({ el, s, cd, cdt }, i) => {
      const locked = p.level < (s.unlock ?? 1), rem = p.cd[s.id] ?? 0, tot = s.cooldown || 1;
      el.classList.toggle('locked', locked); el.classList.toggle('nores', !locked && p.mana < s.cost);
      cd.style.transform = `scaleY(${locked ? 1 : Math.min(1, rem / tot)})`;
      cdt.textContent = locked ? `L${s.unlock}` : rem > 0.05 ? rem.toFixed(rem < 10 ? 1 : 0) : '';
      const tb = [this.tb.atk, this.tb.s1, this.tb.s2, this.tb.s3][i]; tb.querySelector('.cd').style.transform = `scaleY(${locked ? 1 : Math.min(1, rem / tot)})`; tb.style.opacity = locked ? 0.35 : 1;
    });
    this.holdSlot.el.style.borderColor = input.standing ? '#ffd070' : ''; this.holdSlot.el.style.background = input.standing ? 'linear-gradient(#5a4420,#2a200e)' : '';
    const pc = (k, slot) => { slot.cd.style.transform = `scaleY(${p.potionCd[k] / 7})`; slot.cnt.textContent = g.inv.potions[k]; slot.el.style.opacity = g.inv.potions[k] ? 1 : 0.45; };
    pc('hp', this.hpSlot); pc('mana', this.mpSlot);
    // tracker
    const def = g.chamber.def, pr = g.progress;
    set('trk', `${def.id}|${pr.sigils.length}|${pr.relics.length}|${pr.lore.length}|${pr.flags.bishop_slain}`, () => {
      this.q('#tracker .name').textContent = def.name; this.q('#tracker .obj').textContent = pr.flags.bishop_slain ? 'The Vigil Flame burns again. Explore freely, or return to the Nave.' : def.objective;
      this.q('#tracker .counts').innerHTML = `<span>Sigils <b>${pr.sigils.length}/3</b></span><span>Relics <b>${pr.relics.length}/5</b></span><span>Fragments <b>${pr.lore.length}/${Object.keys(LORE).length}</b></span>`;
    });
    // boss / target
    const boss = g.chamber.enemies.find((e) => e.def.boss && !e.dead && e.spawnT <= 0);
    const bb = this.q('#bossbar'); bb.classList.toggle('hidden', !boss);
    if (boss) { set('bossn', boss.def.name, (n) => { bb.querySelector('.n').textContent = n; }); bb.querySelector('i').style.width = `${Math.max(0, boss.hp / boss.maxHp) * 100}%`; }
    const h = input.hover, tg = this.q('#target');
    const te = h && h.kind === 'enemy' && !h.entity.def.boss ? h.entity : null;
    tg.classList.toggle('hidden', !te || !!boss && false);
    if (te) { const nm = (te.elite ? NAMES.elitePrefix[te.elite] + ' ' : '') + te.def.name; tg.querySelector('.n').textContent = `${nm}${te.elite ? ' ★' : ''}`; tg.querySelector('.bar').classList.toggle('elite', !!te.elite); tg.querySelector('i').style.width = `${Math.max(0, te.hp / te.maxHp) * 100}%`; }
    // interact prompt
    const near = p.dead ? null : g.chamber.nearestInteractable(p);
    const pe = this.q('#prompt');
    if (near && !this.panelOpen) {
      const txt = near.kind ? (near.kind === 'item' ? `Pick up ${esc(near.item.name)}` : 'Pick up') : (PROMPTS[near.t] ?? 'Interact');
      set('prompt', txt, (t) => { pe.innerHTML = `<kbd>E</kbd>${t}`; }); pe.classList.remove('hidden');
    } else pe.classList.add('hidden');
    // floaters
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]; f.t += dt;
      if (f.t > 1.1) { f.el.remove(); this.floaters.splice(i, 1); continue; }
      const s = view.project(f.x, 1.7 + f.t * 1.1, f.z);
      f.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%) scale(${f.t < 0.12 ? 0.6 + f.t * 4 : 1})`; f.el.style.opacity = f.t > 0.7 ? Math.max(0, 1 - (f.t - 0.7) / 0.4) : 1;
    }
    // loot labels
    this.labelT = (this.labelT ?? 0) - dt;
    const labs = view.lootLabels(), seen = new Set();
    for (const l of labs) {
      seen.add(l.id);
      let o = this.labels.get(l.id);
      if (!o) {
        const it = l.loot.item, txt = l.loot.kind === 'gold' ? `${l.loot.amount} gold` : esc(it.name), col = l.loot.kind === 'gold' ? '#f0d070' : rarityColor(it.rarity);
        const el = $(`<div class="lootlabel" style="color:${col};border-color:${col}66">${txt}</div>`);
        el.onpointerdown = (e) => { e.stopPropagation(); input.push({ t: 'interact', id: l.id }); };
        this.labelRoot.appendChild(el); o = { el }; this.labels.set(l.id, o);
      }
      o.el.style.transform = `translate(${l.x}px, ${l.y}px) translate(-50%, -100%)`; o.el.classList.toggle('hov', input.hover?.id === l.id);
    }
    for (const [id, o] of this.labels) if (!seen.has(id)) { o.el.remove(); this.labels.delete(id); }
    // minimap
    this.mapT -= dt; if (this.mapT <= 0) { this.mapT = 0.12; this.drawMap(); }
    // joystick
    const joy = this.q('#joy'), s = input.stick;
    joy.style.display = s.active ? 'block' : 'none';
    if (s.active) { joy.style.left = `${s.ox}px`; joy.style.top = `${s.oy}px`; joy.firstChild.style.transform = `translate(${s.x}px, ${s.y}px)`; }
  }

  drawMap() {
    const g = this.game, ch = g.chamber, grid = ch.grid, cv = this.q('#minimap'), x = cv.getContext('2d'), W = cv.width;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, W);
    const R = Math.max(grid.w, grid.h), sc = (W / (R * 1.0)) * 0.72, p = g.player;
    x.translate(W / 2, W / 2); x.rotate(Math.PI / 4); x.scale(sc, sc);
    const px = p.x, pz = p.z;
    x.translate(-px, -pz);
    for (let z = 0; z < grid.h; z++) for (let cx = 0; cx < grid.w; cx++) {
      const i = grid.idx(cx, z); if (!ch.explored[i]) continue;
      x.fillStyle = grid.floor[i] ? (grid.solid[i] ? '#5a4f6a' : '#4a4358') : '#26202e'; x.fillRect(cx, z, 1.02, 1.02);
    }
    const dot = (X, Z, col, r = 0.45) => { const ci = grid.idx(Math.floor(X), Math.floor(Z)); if (!ch.explored[ci]) return; x.fillStyle = col; x.beginPath(); x.arc(X, Z, r, 0, 7); x.fill(); };
    for (const d of ch.doors) dot(d.x, d.z, '#7ab0ff', 0.9);
    for (const q of ch.props.values()) { if (q.t === 'waystone') dot(q.x, q.z, '#78c8ff', 0.7); else if (q.t === 'chest' && !q.opened && !q.hidden) dot(q.x, q.z, '#f0d070', 0.55); else if (q.t === 'altar' && !q.hidden) dot(q.x, q.z, '#ff9a50', 0.7); }
    for (const e of ch.enemies) if (!e.dead && e.spawnT <= 0) dot(e.x, e.z, e.def.boss ? '#ff3030' : '#d04040', e.def.boss ? 1.0 : 0.5);
    for (const l of ch.loot) dot(l.x, l.z, '#ffd070', 0.35);
    x.fillStyle = '#fff'; x.beginPath(); x.arc(px, pz, 0.7, 0, 7); x.fill();
    x.fillStyle = '#ffe090'; x.save(); x.translate(px, pz); x.rotate(-p.face); x.beginPath(); x.moveTo(0, 1.8); x.lineTo(-0.7, 0.6); x.lineTo(0.7, 0.6); x.fill(); x.restore();
  }
}
