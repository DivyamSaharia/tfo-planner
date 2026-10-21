// TFO Planner app: state, saving, and the screens.
import * as C from './calc.js';
import { conf, load, save, readCache, writeCache, DEFAULT_URL } from './api.js';
import { makeSample } from './sample.js';
import { pickBtn, openPicker, closePicker, pickerOpen, matches } from './picker.js';

const PTABS = ['PlannerLooms', 'PlannerChangeovers', 'PlannerBeamStock', 'PlannerYarnStock', 'PlannerReceipts', 'PlannerTfoSides', 'PlannerSettings', 'PlannerProduction'];
// The first ten have number keys 1-9 and 0. Masters are read-only and have none.
const SCREENS = [
  ['looms', 'Looms'], ['production', 'Production'], ['running', 'Running today'], ['changeover', 'Machine changeover'], ['yarn', 'Yarn requirement'],
  ['beams', 'Beam stock'], ['ystock', 'Yarn stock'], ['receipts', 'Receipts from outside'], ['tfo', 'TFO machines'],
  ['stock', 'Stock and deficit'], ['rpm', 'RPM master'],
  ['fmaster', 'Fabric master', 'masters'], ['ymaster', 'Yarn master', 'masters']
];
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

const S = { tabs: {}, M: null, P: null, date: todayIST(), tab: 'looms', tpmOnly: true, pending: 0, loading: false, err: null, loadedAt: 0, ysDate: null, cached: false, prodDate: C.addDays(todayIST(), -1), fq: '', yq: '', ysExtra: [] };
const $ = (s, r = document) => r.querySelector(s);
const main = $('#main');

// ---------- formatting ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kg = (v) => (v == null || Math.abs(v) < 0.05 ? '–' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(1));
const n0 = (v) => (v == null || !Number.isFinite(v) ? '–' : Math.round(v).toLocaleString('en-IN'));
const mc = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const D = (n) => new Date(n * 864e5);
const fd = (n) => (n == null ? '–' : D(n).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }));
const sd = (n) => (n == null ? '–' : D(n).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }));
const dl = (d) => (d === 0 ? 'Today' : fd(S.P.D0 + d));
const hm = (t) => { const h = ((t % 24) + 24) % 24; return String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor((h * 60) % 60)).padStart(2, '0'); };
const tAbs = (t) => `${fd(S.P.D0 + Math.floor(t / 24))} ${hm(t)}`;
const tStr = (t) => C.dayStr(S.P.D0 + Math.floor(t / 24)) + 'T' + hm(t);
const yn = (id) => (S.M.yarns[id] ? S.M.yarns[id].name : id ? 'Unknown yarn' : '–');
const fl = (id) => (S.M.fabrics[id] ? S.M.fabrics[id].label : id ? 'Unknown fabric' : '–');
const isTpm = (id) => !!(S.M.yarns[id] && S.M.yarns[id].isTpm);
const tpmPill = (id) => (isTpm(id) ? ' <span class="pill tpm">TPM</span>' : '');
const pannaTxt = (p) => (p >= 2 ? 'double panna' : 'single panna');
const newId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const sel = (v, cur) => (String(v) === String(cur ?? '') ? ' selected' : '');

// ---------- state ----------
const rows = (tab) => (S.tabs[tab] || []).filter((r) => !r.unit_id || !S.M || r.unit_id === S.M.uid);
const setting = (key, def) => { const r = (S.tabs.PlannerSettings || []).find((r) => r.key === key); const v = r ? C.num(r.value) : null; return v ?? def; };
const win = () => { const w = setting('window', 7); return [3, 5, 7].includes(w) ? w : 7; };
const lead = () => Math.max(0, setting('lead_days', 1));

function recompute() {
  S.M = C.buildMaster(S.tabs);
  const st = { looms: rows('PlannerLooms'), changeovers: rows('PlannerChangeovers'), beamStock: rows('PlannerBeamStock'), yarnStock: rows('PlannerYarnStock'), receipts: rows('PlannerReceipts'), sides: rows('PlannerTfoSides'), production: rows('PlannerProduction') };
  S.P = C.plan(S.M, st, { date: S.date, days: win(), lead: lead() });
}

// ---------- saving ----------
const queue = [];
let flushing = false;
function applyLocal(c) {
  const arr = S.tabs[c.tab] || (S.tabs[c.tab] = []);
  const i = arr.findIndex((r) => r.id === c.row.id);
  if (c.op === 'delete') { if (i >= 0) arr.splice(i, 1); return; }
  const row = { ...c.row, updated_by: conf.user || 'you', updated_at: new Date().toISOString() };
  if (i >= 0) Object.assign(arr[i], row); else arr.push(row);
}
function commit(changes, { quiet } = {}) {
  changes = changes.map((c) => {
    const op = c.op || 'upsert';
    const row = op === 'delete' ? { id: c.row.id } : PTABS.includes(c.tab) ? { unit_id: S.M.uid, ...c.row } : c.row;
    return { tab: c.tab, op, row, summary: c.summary || '' };
  });
  changes.forEach(applyLocal);
  writeCache(S.tabs);
  refresh();
  for (let i = 0; i < changes.length; i += 40) queue.push(changes.slice(i, i + 40));
  flush(quiet);
}
async function flush(quiet) {
  if (flushing) return;
  flushing = true;
  while (queue.length) {
    const batch = queue[0];
    S.pending++; syncDot();
    try { await save(batch); queue.shift(); S.err = null; } catch (e) {
      queue.length = 0; S.err = e.message;
      toast(`Not saved: ${e.message}`, true, conf.key ? ['Reload', reloadAll] : ['Settings', openSettings]);
    }
    S.pending--; syncDot();
  }
  flushing = false;
  if (!S.err && !quiet) { /* saved */ }
}
function syncDot() {
  const cls = 'sync' + (S.pending || S.loading ? ' busy' : S.err ? ' err' : !conf.key ? ' off' : '');
  const title = S.pending ? 'Saving…' : S.loading ? 'Loading…' : S.err ? S.err : !conf.key ? 'No key entered' : 'Saved';
  document.querySelectorAll('.sync').forEach((el) => { el.className = cls; el.title = title; });
}

async function reloadAll() {
  if (!conf.key) { openSettings(); return; }
  S.loading = true; syncDot();
  try {
    const out = await load();
    S.tabs = out.tabs || {};
    S.cached = false; S.loadedAt = Date.now(); S.err = null;
    writeCache(S.tabs);
  } catch (e) {
    S.err = e.message;
    toast(e.message, true, ['Settings', openSettings]);
  }
  S.loading = false; syncDot();
  refresh();
}

// ---------- toast and sheet ----------
let toastTimer;
function toast(msg, bad, action) {
  const t = $('#toast');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action[0])}</button>` : ''}`;
  t.hidden = false;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; action[1](); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 8000 : 2600);
}

const sheet = $('#sheet'), sheetBody = $('#sheet-body');
let sheetSubmit = null, sheetChange = null;
function openSheet(html, onSubmit, onChange) {
  sheetBody.innerHTML = html;
  sheetSubmit = onSubmit; sheetChange = onChange || null;
  if (!sheet.open) sheet.showModal();
}
function closeSheet() { if (sheet.open) sheet.close(); }
sheetBody.addEventListener('submit', (e) => {
  e.preventDefault();
  const act = e.submitter ? e.submitter.value : 'save';
  if (act === 'cancel') { closeSheet(); return; }
  const fdata = Object.fromEntries(new FormData(sheetBody));
  const err = sheetSubmit ? sheetSubmit(fdata, act) : null;
  if (typeof err === 'string' && err) { const el = $('.err', sheetBody); if (el) el.textContent = err; return; }
  closeSheet();
});
sheetBody.addEventListener('change', (e) => { if (sheetChange) sheetChange(e, Object.fromEntries(new FormData(sheetBody))); });
sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-close]')) closeSheet(); });
const sheetHead = (title) => `<div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="btn quiet small" data-close>Close</button></div>`;

// ---------- yarn picker ----------
// TPM yarns first, then other yarns; typeId adds "no speed" for yarns that TFO type has no speed for
function yarnGroups({ tpmOnly = false, typeId = '' } = {}) {
  const ys = Object.values(S.M.yarns).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  const opt = (y) => ({ value: y.id, label: y.name, note: typeId ? (C.tfoSpeed(S.M, typeId, y.id) ? '' : 'no speed') : y.den ? `${Math.round(y.den)} D` : '', search: y.isTpm ? 'tpm' : '' });
  const g = [{ group: 'TPM yarns', options: ys.filter((y) => y.isTpm).map(opt) }];
  if (!tpmOnly) g.push({ group: 'Other yarns', options: ys.filter((y) => !y.isTpm).map(opt) });
  return g;
}
// kind: what to save when a yarn is chosen (ty, tnext, ys-add, field); see onPicked
function yarnPick({ kind, id = '', type = '', cur = '', blank = '', title, domId, need = false, tpmOnly = false }) {
  const y = S.M.yarns[cur];
  return pickBtn({ label: title, text: y ? y.name : cur ? 'Unknown yarn' : blank || 'Choose yarn', empty: !y, id: domId, need, attrs: { kind, id, type, cur, blank, title, tpm: tpmOnly ? '1' : '' } });
}
function startPick(b) {
  const d = b.dataset;
  openPicker({
    title: d.title || 'Choose yarn', value: d.cur || '', blank: d.blank || '', back: b,
    groups: yarnGroups({ tpmOnly: d.tpm === '1', typeId: d.type || '' }),
    onPick: (v) => onPicked(d, v, b)
  });
}
function onPicked(d, v, b) {
  if (d.kind === 'ty') { saveSide(d.id, 'yarn_id', v); return; }
  if (d.kind === 'tnext') { saveSide(d.id, 'next_yarn_id', v); return; }
  if (d.kind === 'ys-add') { if (v && !S.ysExtra.includes(v)) S.ysExtra.push(v); scheduleRender(); setTimeout(() => { const el = document.getElementById('ys-' + v); if (el) el.focus(); }, 60); return; }
  if (d.kind === 'field') {
    const inp = sheetBody.querySelector(`input[name="${d.name}"]`);
    if (!inp) return;
    inp.value = v;
    if (sheetChange) sheetChange({ target: inp }, Object.fromEntries(new FormData(sheetBody)));
  }
}

// ---------- render ----------
let raf = 0;
function refresh() { recompute(); scheduleRender(); }
function scheduleRender() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const id = document.activeElement && main.contains(document.activeElement) ? document.activeElement.id : null;
    render();
    if (id) { const el = document.getElementById(id); if (el) el.focus({ preventScroll: true }); }
  });
}
function render() {
  $('#plan-date').value = S.date;
  document.querySelectorAll('#win button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === win())));
  const badges = tabBadges();
  const sl = $('#tabs').scrollLeft;
  const mFirst = SCREENS.findIndex((x) => x[2] === 'masters');
  $('#tabs').innerHTML = SCREENS.map(([k, t], i) => `${i === mFirst ? '<span class="tab-sep" aria-hidden="true"></span>' : ''}<button data-act="tab" data-v="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${t}${badges[k] ? `<span class="badge">${badges[k]}</span>` : ''}</button>`).join('');
  $('#side-nav').innerHTML = SCREENS.map(([k, t], i) => `${i === mFirst ? '<div class="side-head">Masters</div>' : ''}<button data-act="tab" data-v="${k}" ${S.tab === k ? 'aria-current="page"' : ''}><kbd>${i < 10 ? (i + 1) % 10 : ''}</kbd><span class="lab">${t}</span>${badges[k] ? `<span class="badge">${badges[k]}</span>` : ''}</button>`).join('');
  $('#side-user').textContent = conf.user || '';
  $('#win-txt').textContent = winTxt();
  syncDot();
  const fn = { looms: scrLooms, production: scrProduction, running: scrRunning, changeover: scrChangeover, yarn: scrYarn, beams: scrBeams, ystock: scrYarnStock, receipts: scrReceipts, tfo: scrTfo, stock: scrStock, rpm: scrRpm, fmaster: scrFabricMaster, ymaster: scrYarnMaster }[S.tab];
  let banner = '';
  if (!conf.key) banner = `<div class="note">Enter your planner key to read and save the sheet. <button class="link" data-act="settings">Open Settings</button></div>`;
  else if (S.cached && S.loading) banner = `<div class="note ok">Showing the last saved copy while the sheet loads.</div>`;
  main.innerHTML = banner + fn();
  applySearch();
  const cur = $('#tabs [aria-current=page]');
  if (cur && cur.scrollIntoView && !render.done) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
  else $('#tabs').scrollLeft = sl;
  render.done = true;
}
function tabBadges() {
  const P = S.P;
  const open = changeItems().filter((x) => !x.ev).length;
  const tpend = P.days.reduce((t, d) => t + d.tpend.length, 0);
  const def = P.yarnIds.filter((y) => P.bal[y].first != null).length;
  return { changeover: open, tfo: tpend, stock: def };
}
const winTxt = () => `${fd(S.P.D0)} to ${fd(S.P.D0 + S.P.H - 1)}`;
const tpmSeg = () => `<div class="seg light" role="group" aria-label="Yarns shown"><button data-act="tpm" data-v="1" aria-pressed="${S.tpmOnly}">TPM yarns</button><button data-act="tpm" data-v="0" aria-pressed="${!S.tpmOnly}">All yarns</button></div>`;
const strip = (key, unit, empty) => `<div class="strip">${S.P.days.map((d, i) => { const a = d[key]; return `<div class="day ${a.length ? 'hot' : ''}"><span class="lbl">${dl(i)}</span><b>${a.length}</b><span class="small">${a.length ? unit + ' ' + a.join(', ') : empty}</span></div>`; }).join('')}</div>`;
const flagNotes = () => {
  const P = S.P, out = [];
  if (P.flags.noRpm.size) out.push(`<div class="note bad">Loom RPM missing for ${[...P.flags.noRpm].map((k) => { const [f, p] = k.split('|'); return `${esc(fl(f))} (${pannaTxt(+p)})`; }).join(', ')}. Their yarn is not counted until you enter it on RPM master.</div>`);
  if (P.flags.noLen.size) out.push(`<div class="note bad">Beam length missing for the new beam on loom ${[...P.flags.noLen].join(', ')}. No warp is booked for it until you enter a length on Machine changeover.</div>`);
  return out.join('');
};

// ---------- 1. Looms ----------
function runPill(o) {
  const P = S.P;
  if (!o.f) return '<span class="pill">Idle</span>';
  if (o.runout == null) return '<span class="pill warn">No RPM</span>';
  const set = o.ovr != null ? ' · set' : '';
  if (o.overdue) return `<span class="pill bad">Ran out ${sd(o.runout)}${set}</span>`;
  const d = o.runout - P.D0;
  if (d === 0) return `<span class="pill bad">Runs out today${set}</span>`;
  if (d < P.H) return `<span class="pill warn">Runs out ${fd(o.runout)}${set}</span>`;
  return `<span class="pill">Runs out ${sd(o.runout)}${set}</span>`;
}
function scrLooms() {
  const P = S.P, M = S.M, L = P.looms;
  let h = `<div class="screen-head"><h2>Looms</h2><button class="btn small" data-act="loom-add">Add loom</button></div>`;
  if (!L.length) {
    h += `<div class="card"><p class="title">No looms entered yet</p><p class="muted">Start here. Enter every running loom with its loom group, fabric and beam balance; the other screens work from these. You can also load sample data to see the planner working and clear it later in Settings.</p><div class="btns"><button class="btn" data-act="loom-add">Add first loom</button><button class="btn ghost" data-act="sample-load">Load sample data</button></div></div>`;
  }
  const total = M.groupList.reduce((t, g) => t + (g.looms || 0), 0);
  const running = L.filter((o) => o.f).length;
  const soon = L.filter((o) => o.f && o.runout != null && o.runout < P.D0 + P.H).length;
  if (L.length) h += `<div class="stats"><div class="stat"><span>Looms entered</span><b>${L.length}</b><span>of ${total} in the loom groups</span></div><div class="stat"><span>Running a fabric</span><b>${running}</b><span>${L.length - running} without a fabric</span></div><div class="stat"><span>Beams running out</span><b>${soon}</b><span>in the ${P.H}-day window</span></div></div>`;
  if (P.flags.noRpm.size) h += flagNotes();
  M.groupList.forEach((g) => {
    const gl = L.filter((o) => o.row.loom_group_id === g.id);
    h += `<div class="section-title"><h3>${esc(g.label)}</h3><span class="small">${gl.length} of ${g.looms ?? '–'} entered</span></div>`;
    if (!gl.length) { h += `<div class="card tight"><span class="muted small">No looms entered for this group.</span></div>`; return; }
    h += `<div class="grid2">${gl.map((o) => `<button class="card tight tap" data-act="loom-edit" data-id="${esc(o.row.id)}">
      <div class="row"><span><span class="loomno">Loom ${o.no}</span>${o.panna !== C.defPanna(g) ? ` <span class="pill acc">${pannaTxt(o.panna)}</span>` : ''}</span>${runPill(o)}</div>
      <div class="row"><span class="grow">${o.f ? esc(o.f.label) : '<span class="muted">No fabric</span>'}</span><span class="small n">${o.f ? `${n0(o.balToday)} m left` : ''}</span></div>
      <div class="small">${prodLine(o)}</div>
    </button>`).join('')}</div>`;
  });
  const other = L.filter((o) => !o.g);
  if (other.length) h += `<div class="section-title"><h3>Loom group not found</h3></div><div class="grid2">${other.map((o) => `<button class="card tight tap bad" data-act="loom-edit" data-id="${esc(o.row.id)}">Loom ${o.no}: pick a loom group</button>`).join('')}</div>`;
  return h;
}
// last production entry counted against the beam
function prodLine(o) {
  if (o.prod.last != null) return `Production to ${sd(o.prod.last)}${o.overRun ? ' · <span class="pill bad">more than the beam held</span>' : ''}`;
  return o.bal != null ? `No production since ${sd(o.bdate)}` : 'No beam balance';
}
function fabricOptions(gid, panna, cur, extra = '') {
  const g = S.M.groups[gid];
  const list = S.M.fabricList.filter((f) => C.fits(f, g, panna) || f.id === cur);
  return extra + list.map((f) => `<option value="${f.id}"${sel(f.id, cur)}>${esc(f.label)} · ${f.weave.toLowerCase()}${C.fits(f, g, panna) ? '' : ' (does not fit)'}</option>`).join('');
}
function loomSheet(id) {
  const M = S.M, P = S.P;
  const r = id ? rows('PlannerLooms').find((x) => x.id === id) : null;
  const o = r ? P.looms.find((x) => x.row.id === id) : null;
  const maxNo = Math.max(0, ...rows('PlannerLooms').map((x) => C.num(x.loom_no) || 0));
  const v = r ? { ...r } : { loom_no: String(maxNo + 1), loom_group_id: M.groupList[0] ? M.groupList[0].id : '', panna: '', fabric_id: '', beam_balance_m: '', balance_date: S.date, runout_override: '', notes: '' };
  const body = (v) => {
    const g = M.groups[v.loom_group_id];
    const panna = C.num(v.panna) || C.defPanna(g);
    return `${sheetHead(r ? `Loom ${r.loom_no}` : 'Add loom')}
    <div class="fields">
      <label class="field"><span>Loom no.</span><input type="number" name="loom_no" inputmode="numeric" min="1" step="1" value="${esc(v.loom_no)}" required></label>
      <label class="field"><span>Loom group</span><select name="loom_group_id">${M.groupList.map((g) => `<option value="${g.id}"${sel(g.id, v.loom_group_id)}>${esc(g.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Panna</span><select name="panna"><option value="1"${sel(1, panna)}>Single</option><option value="2"${sel(2, panna)}>Double</option></select></label>
    </div>
    <label class="field"><span>Fabric running</span><select name="fabric_id">${fabricOptions(v.loom_group_id, panna, v.fabric_id, `<option value="">No fabric (idle)</option>`)}</select></label>
    <div class="fields">
      <label class="field"><span>Beam balance, m</span><input type="number" name="beam_balance_m" inputmode="decimal" min="0" step="1" value="${esc(v.beam_balance_m)}"></label>
      <label class="field"><span>Balance at start of</span><input type="date" name="balance_date" max="${S.date}" value="${esc(v.balance_date || S.date)}"></label>
      <label class="field"><span>Run-out date (your own)</span><input type="date" name="runout_override" value="${esc(v.runout_override)}"></label>
    </div>
    ${o && o.bal != null ? `<dl class="kv card tight" style="background:var(--sunk)"><dt>Current balance</dt><dd><b>${n0(o.cur)} m</b></dd>
      <dt>Production since ${sd(o.bdate)}</dt><dd>${o.prod.entries ? `${n0(o.prod.metres)} m in ${o.prod.entries} entr${o.prod.entries === 1 ? 'y' : 'ies'} · uses ${n0(o.prod.used)} m of beam` : 'none entered'}</dd>
      <dt>Last production</dt><dd>${o.prod.last != null ? fd(o.prod.last) : '–'}</dd>
      <dt>Balance on ${sd(S.P.D0)}</dt><dd>${n0(o.balToday)} m</dd></dl>
      ${o.overRun ? '<p class="note bad">Production entered is more than this beam held. Check the balance or the production metres.</p>' : ''}` : ''}
    ${o && o.runCalc != null ? `<p class="small">Calculated run-out: ${fd(o.runCalc)}, counted from ${fd(o.prod.start)}. Leave your own date blank to use it.</p>` : `<p class="small">The run-out date is calculated from the balance less production entered since the balance date, RPM and warp shortage. Fill in your own date only to overrule it.</p>`}
    <label class="field"><span>Notes</span><input type="text" name="notes" value="${esc(v.notes)}"></label>
    <p class="err"></p>
    <div class="btns"><button class="btn" value="save">Save</button>${r ? '<button class="btn danger" value="delete" formnovalidate>Delete loom</button>' : ''}</div>`;
  };
  openSheet(body(v), (f, act) => {
    if (act === 'delete') {
      if (!confirm(`Delete loom ${r.loom_no}? Its changeovers and production entries are deleted too.`)) return 'Not deleted.';
      const cos = rows('PlannerChangeovers').filter((c) => C.num(c.loom_no) === C.num(r.loom_no));
      const prs = rows('PlannerProduction').filter((c) => C.num(c.loom_no) === C.num(r.loom_no));
      commit([{ tab: 'PlannerLooms', op: 'delete', row: r, summary: `Loom ${r.loom_no}` }, ...cos.map((c) => ({ tab: 'PlannerChangeovers', op: 'delete', row: c, summary: `Loom ${r.loom_no} changeover` })), ...prs.map((c) => ({ tab: 'PlannerProduction', op: 'delete', row: c, summary: `Loom ${r.loom_no} production ${c.date}` }))]);
      return;
    }
    const no = C.num(f.loom_no);
    if (!no || no < 1 || !Number.isInteger(no)) return 'Enter a whole loom number.';
    if (rows('PlannerLooms').some((x) => x.id !== (r && r.id) && C.num(x.loom_no) === no)) return `Loom ${no} is already entered.`;
    if (!f.loom_group_id) return 'Pick the loom group.';
    const g = M.groups[f.loom_group_id], fab = M.fabrics[f.fabric_id], panna = C.num(f.panna) || 1;
    if (fab && !C.fits(fab, g, panna)) return fab.dobby && !g.dobby ? `${fab.label} is dobby; it needs a dobby loom.` : `${fab.label} does not fit ${g.width} cm at ${pannaTxt(panna)}.`;
    if (fab && f.beam_balance_m === '') return 'Enter the beam balance in metres.';
    if (f.balance_date && f.balance_date > S.date) return 'The balance date cannot be after the plan date.';
    const row = { id: r ? r.id : newId('lm'), loom_no: String(no), loom_group_id: f.loom_group_id, panna: String(panna), fabric_id: f.fabric_id || '', beam_balance_m: f.beam_balance_m, balance_date: f.balance_date || S.date, runout_override: f.runout_override || '', notes: f.notes || '' };
    const ch = [{ tab: 'PlannerLooms', row, summary: `Loom ${no} · ${fab ? fab.label : 'idle'} · ${f.beam_balance_m || 0} m` }];
    if (r && C.num(r.loom_no) !== no) ['PlannerChangeovers', 'PlannerProduction'].forEach((tab) => rows(tab).filter((c) => C.num(c.loom_no) === C.num(r.loom_no)).forEach((c) => ch.push({ tab, row: { ...c, loom_no: String(no) }, summary: `Loom ${r.loom_no} → ${no}` })));
    commit(ch);
  }, (e, f) => {
    if (e.target.name === 'loom_group_id' || e.target.name === 'panna') {
      if (e.target.name === 'loom_group_id') f.panna = String(C.defPanna(M.groups[f.loom_group_id]));
      const keep = $('.err', sheetBody).textContent;
      sheetBody.innerHTML = body({ ...v, ...f });
      $('.err', sheetBody).textContent = keep;
    }
  });
}

// ---------- 2. Production ----------
function scrProduction() {
  const P = S.P, M = S.M, L = P.looms;
  const date = S.prodDate && S.prodDate <= S.date ? S.prodDate : C.addDays(S.date, -1);
  const day = C.dayNum(date);
  const entries = rows('PlannerProduction').filter((r) => r.date === date);
  const byNo = Object.fromEntries(entries.map((r) => [String(C.num(r.loom_no)), r]));
  const tot = (list) => list.reduce((t, o) => t + (C.num((byNo[String(o.no)] || {}).metres) || 0), 0);
  const cnt = (list) => list.filter((o) => byNo[String(o.no)]).length;
  let h = `<div class="screen-head"><h2>Production</h2><span class="small">metres woven per loom</span></div>
  <div class="card tight"><div class="inline">
    <button class="btn quiet small" data-act="pd-step" data-v="-1" aria-label="Day before">‹</button>
    <label>Production on <input type="date" id="prod-date" max="${S.date}" value="${date}"></label>
    <button class="btn quiet small" data-act="pd-step" data-v="1" aria-label="Day after"${date >= S.date ? ' disabled' : ''}>›</button>
    <span class="small">${fd(day)}</span></div>
  <p class="small">Enter loom metres for the day. The balance of each beam is the balance you entered less these metres plus warp shortage, counting entries on or after its balance date. Leave a box empty for nothing entered.</p></div>`;
  if (!L.length) return h + `<div class="card empty">No looms entered yet. Add looms on the Looms screen first.</div>`;
  h += `<div class="stats"><div class="stat"><span>Looms entered</span><b>${cnt(L)}</b><span>of ${L.length}</span></div>
    <div class="stat"><span>Total production</span><b>${n0(tot(L))} m</b><span>${fd(day)}</span></div>
    <div class="stat"><span>Looms with no entry</span><b>${L.length - cnt(L)}</b><span>blank boxes</span></div></div>`;
  const groups = [...M.groupList.map((g) => ({ g, list: L.filter((o) => o.row.loom_group_id === g.id) })), { g: null, list: L.filter((o) => !o.g) }].filter((x) => x.list.length);
  groups.forEach(({ g, list }) => {
    h += `<div class="section-title"><h3>${esc(g ? g.label : 'Loom group not found')}</h3><span class="small">${cnt(list)} of ${list.length} entered · <b class="n">${n0(tot(list))} m</b></span></div>
    <div class="grid2 prod">${list.map((o) => {
      const e = byNo[String(o.no)];
      const before = e && day < o.bdate;
      return `<div class="card tight prod-row"><div class="grow"><span class="loomno">Loom ${o.no}</span> <span class="small">${o.f ? esc(o.f.label) : 'No fabric'}</span>
        <span class="small" style="display:block">${o.mday ? `about ${n0(o.mday)} m/day · ` : ''}${o.bal != null ? `${n0(o.cur)} m on beam` : 'no balance'}${before ? ' · <span class="pill">before balance date</span>' : ''}</span></div>
        <input type="number" inputmode="decimal" min="0" step="1" id="pr-${o.no}" data-pr="${o.no}" value="${e ? esc(e.metres) : ''}" placeholder="m" aria-label="Loom ${o.no} metres on ${date}"></div>`;
    }).join('')}</div>`;
  });
  h += `<div class="card tight"><div class="row"><b>Total, ${fd(day)}</b><b class="n">${n0(tot(L))} m · ${cnt(L)} looms</b></div></div>`;
  return h;
}

// ---------- 3. Running today ----------
function rpmInput(f, panna, pre) {
  const v = C.fabricRpm(f, panna);
  const can = S.M.groupList.some((g) => C.fits(f, g, panna) && C.defPanna(g) === panna);
  return `<input type="number" inputmode="numeric" min="1" step="1" id="${pre}-${f.id}-${panna}" data-rpm="${f.id}" data-panna="${panna}" value="${v ?? ''}" placeholder="${can ? 'Enter' : 'n/a'}" class="${v || !can ? '' : 'need'}" aria-label="Loom RPM, ${esc(f.label)}, ${pannaTxt(panna)}">`;
}
function scrRunning() {
  const P = S.P, D0 = P.days[0];
  const fabs = Object.values(D0.fab).sort((a, b) => a.f.label.localeCompare(b.f.label, 'en', { numeric: true }) || a.panna - b.panna);
  const tot = fabs.reduce((t, x) => t + x.looms, 0);
  const plain = fabs.reduce((t, x) => t + x.plain, 0), dobby = fabs.reduce((t, x) => t + x.dobby, 0);
  const tpmW = Object.entries(D0.weft).filter(([y]) => isTpm(y)).reduce((t, [, v]) => t + v, 0);
  const co = P.looms.filter((o) => o.events.some((e) => e.day === P.D0) || (o.open === P.D0)).length;
  let h = `<div class="screen-head"><h2>Running today</h2><span class="small">${fd(P.D0)} · loom efficiency ${S.M.loomEff}%</span></div>
  <div class="stats">
    <div class="stat"><span>Looms running</span><b>${mc(tot)}</b><span>${mc(plain)} on plain · ${mc(dobby)} on dobby groups</span></div>
    <div class="stat"><span>Idle looms</span><b>${mc(D0.idle)}</b><span>no fabric on the loom</span></div>
    <div class="stat"><span>TPM weft today</span><b>${kg(tpmW)} kg</b><span>weft shortage included</span></div>
    <div class="stat"><span>Changeovers today</span><b>${co}</b><span>counted half old, half new</span></div>
  </div>${flagNotes()}`;
  if (!fabs.length) return h + `<div class="card empty">No looms running. Enter looms on the Looms screen.</div>`;
  h += `<p class="small">Tap a fabric to see its looms and edit any of them.</p><div class="grid2">${fabs.map((x) => `<div class="card tight">
    <button class="row tap-head" data-act="fab-looms" data-f="${x.f.id}" data-p="${x.panna}" aria-label="${esc(x.f.label)}, ${pannaTxt(x.panna)}: show looms"><span class="title">${esc(x.f.label)}</span><span class="pill">${x.panna >= 2 ? 'Double' : 'Single'} panna</span></button>
    <div class="small">${mc(x.looms)} ${x.looms === 1 ? 'loom' : 'looms'} · ${[x.plain && mc(x.plain) + ' plain', x.dobby && mc(x.dobby) + ' dobby'].filter(Boolean).join(', ')} · shortage warp ${x.f.wsh}% / weft ${x.f.fsh}%</div>
    <div class="row"><label class="inline"><span class="small">RPM</span> ${rpmInput(x.f, x.panna, 'rr')}</label><span class="small n">${n0(x.mday)} m/day per loom</span></div>
    <div><div class="small muted">Weft, kg/day</div>${Object.entries(x.weft).map(([y, v]) => `<div class="yl"><span>${esc(yn(y))}${tpmPill(y)}</span><b>${x.mday ? kg(v) : '–'}</b></div>`).join('') || '<div class="small">–</div>'}</div>
    <div><div class="small muted">Warp running off beams, kg/day</div>${Object.entries(x.warp).map(([y, v]) => `<div class="yl"><span>${esc(yn(y))}</span><b>${x.mday ? kg(v) : '–'}</b></div>`).join('') || '<div class="small">–</div>'}</div>
    <button class="btn quiet small looms-btn" data-act="fab-looms" data-f="${x.f.id}" data-p="${x.panna}">Loom ${x.list.map((l) => l.no).join(', ')} <span aria-hidden="true">›</span></button>
  </div>`).join('')}</div>`;
  const ys = [...new Set([...Object.keys(D0.weft), ...Object.keys(D0.runWarp)])].filter((y) => !S.tpmOnly || isTpm(y)).sort((a, b) => (D0.weft[b] || 0) - (D0.weft[a] || 0));
  h += `<div class="screen-head"><h3>Today by yarn</h3>${tpmSeg()}</div>
  <div class="tw"><table><thead><tr><th>Yarn</th><th>Weft kg</th><th>Warp off beams kg</th></tr></thead><tbody>
  ${ys.map((y) => `<tr><td>${esc(yn(y))}${tpmPill(y)}</td><td>${kg(D0.weft[y])}</td><td>${kg(D0.runWarp[y])}</td></tr>`).join('') || '<tr><td colspan="3">No yarn in use.</td></tr>'}
  <tr class="tot"><td>Total</td><td>${kg(ys.reduce((t, y) => t + (D0.weft[y] || 0), 0))}</td><td>${kg(ys.reduce((t, y) => t + (D0.runWarp[y] || 0), 0))}</td></tr></tbody></table></div>
  <p class="small">Warp running off beams was warped earlier, so it is shown for information and does not draw on yarn stock.</p>`;
  return h;
}

// looms running a fabric today; each opens the loom editor
function fabLoomsSheet(fid, panna) {
  const x = S.P.days[0].fab[fid + '|' + panna];
  const f = S.M.fabrics[fid];
  if (!x || !f) return;
  const list = x.list.map((l) => ({ l, o: S.P.looms.find((o) => o.no === l.no) })).filter((r) => r.o);
  openSheet(`${sheetHead(`${f.label} · ${pannaTxt(panna)}`)}
    <p class="small">${mc(x.looms)} ${x.looms === 1 ? 'loom' : 'looms'} today. Tap a loom to change its fabric, panna, beam balance, balance date or run-out date.</p>
    <div class="list">${list.map(({ l, o }) => `<button type="button" class="card tight tap" data-act="loom-edit" data-id="${esc(o.row.id)}">
      <div class="row"><span><span class="loomno">Loom ${o.no}</span> <span class="small">${esc(o.g ? o.g.label : '')}${l.share < 1 ? ' · half day (changeover)' : ''}</span></span>${runPill(o)}</div>
      <div class="row"><span class="small grow">${o.f && o.f.id !== fid ? `Beam of ${esc(o.f.label)} runs out first · ` : ''}${prodLine(o)}</span><span class="small n">${o.bal != null ? n0(o.balToday) + ' m left' : ''}</span></div>
    </button>`).join('')}</div>`, null);
}

// ---------- 4. Machine changeover ----------
function changeItems() {
  const P = S.P, out = [];
  P.looms.forEach((o) => o.segs.forEach((s, i) => {
    if (!s.f || s.end == null || s.end < P.D0 || s.end >= P.D0 + P.H) return;
    out.push({ o, s, i, ev: o.events[i] || null });
  }));
  return out.sort((a, b) => a.s.end - b.s.end || a.o.no - b.o.no);
}
function lotLeft(lot) { return lot.beams - lot.used.length; }
function beamOptions(o, fabId, day, cur) {
  const g = o.g;
  const lots = Object.values(S.P.lots).filter((l) => l.fabric_id === fabId && S.M.groups[l.group_id] && g && S.M.groups[l.group_id].width === g.width);
  let h = `<option value="new"${sel('new', cur)}>New beam, warped from yarn</option>`;
  lots.forEach((l) => {
    const mine = l.used.some((u) => u.loom === o.no);
    const left = lotLeft(l) + (mine ? 1 : 0);
    const lg = S.M.groups[l.group_id];
    const txt = l.src === 'stock' ? `From beam stock (${lg.label}) · ${left} of ${l.beams} free · ${n0(l.len)} m` : `Beam arriving ${sd(l.arrive)} · ${left} of ${l.beams} free · ${n0(l.len)} m${l.arrive > day ? ' · too late' : ''}`;
    h += `<option value="${l.key}"${sel(l.key, cur)}${left <= 0 && !mine ? ' disabled' : ''}>${esc(txt)}</option>`;
  });
  return h;
}
function warpLines(ev) {
  return (ev.warp || []).map((w) => `<div class="card tight ${w.covered === false ? 'bad' : ''}" style="background:var(--sunk)">
    <div class="yl"><span>Warp ${esc(yn(w.yarn_id))}${tpmPill(w.yarn_id)}</span><b>${kg(w.kg)} kg</b></div>
    <div class="small">Needed in weaving by ${fd(w.needDay)}${w.overdue ? ' <span class="pill bad">overdue</span>' : ''}${w.tpm ? ` · latest doff ${fd(w.latestDoff)} · ${w.sideDoffs ?? '–'} side-doff${w.sideDoffs === 1 ? '' : 's'} of ${kg(w.sideKg)} kg` : ''}</div>
    <div>${w.covered == null ? '<span class="pill">after this window</span>' : w.covered ? '<span class="pill ok">covered</span>' : '<span class="pill bad">short</span>'}</div>
  </div>`).join('');
}
function scrChangeover() {
  const P = S.P, items = changeItems();
  const cnt = P.days.map((_, d) => items.filter((x) => x.s.end === P.D0 + d).length);
  let h = `<div class="screen-head"><h2>Machine changeover</h2><span class="small">${winTxt()}</span></div>
  <div class="strip">${cnt.map((c, d) => `<div class="day"><span class="lbl">${dl(d)}</span><b>${c}</b><span class="small">${c === 1 ? 'beam runs out' : 'beams run out'}</span></div>`).join('')}</div>${flagNotes()}`;
  if (!items.length) h += `<div class="card empty">No beams run out in this window.</div>`;
  h += `<div class="grid2">${items.map(({ o, s, i, ev }) => {
    const key = `${o.row.id}-${i}`;
    const nxVal = ev ? (ev.to ? ev.to.id : 'none') : '';
    const g = o.g;
    const first = i === 0;
    let out = `<div class="card ${ev ? '' : 'warn'}">
      <div class="row"><span><span class="loomno">Loom ${o.no}</span> <span class="small">${esc(g ? g.label : '')}${o.panna !== C.defPanna(g) ? ' · ' + pannaTxt(o.panna) : ''}</span></span>${s.end === P.D0 ? `<span class="pill bad">${first && o.overdue ? 'Overdue' : 'Today'}</span>` : `<span class="pill warn">${fd(s.end)}</span>`}</div>
      <div class="row"><span class="grow">${esc(s.f.label)}</span><span class="small n">${first ? `${n0(o.balToday)} m left · ` : ''}${n0(s.mday)} m/day</span></div>
      <div class="inline"><label>RPM now ${rpmInput(s.f, s.panna, 'cr' + key)}</label></div>`;
    if (first) out += `<div class="inline"><label>Runs out <input type="date" id="ro-${o.row.id}" data-ro="${o.row.id}" value="${C.dayStr(o.runout)}" class="${o.ovr != null ? 'set' : ''}"></label>${o.ovr != null ? `<span class="small">your date · calculated ${o.runCalc != null ? sd(o.runCalc) : '–'}</span> <button class="link" data-act="ro-clear" data-id="${o.row.id}">Use calculated</button>` : ''}</div>`;
    else out += `<div class="small">New beam from the changeover on ${sd(s.start)} runs out on this date.</div>`;
    out += `<label class="field"><span>Next on this loom</span><select id="nx-${key}" data-nx="${o.row.id}" data-i="${i}" data-day="${s.end}" class="${ev ? '' : 'need'}">
      <option value="">Choose next fabric</option>${fabricOptions(o.row.loom_group_id, o.panna, ev && ev.to ? ev.to.id : '', '')}<option value="none"${sel('none', nxVal)}>No beam: loom stands idle</option></select></label>`;
    if (ev && ev.to) {
      out += `<label class="field"><span>Beam</span><select id="bm-${key}" data-bm="${ev.co.id}" data-loom="${o.row.id}">${beamOptions(o, ev.to.id, ev.day, ev.co.beam || 'new')}</select></label>`;
      const def = ev.kind === 'lot' ? (ev.lot && ev.lot.len) : C.beamLen(S.M, ev.to.id, o.row.loom_group_id);
      out += `<div class="inline"><label>Beam length, m <input type="number" inputmode="numeric" min="0" step="10" id="ln-${key}" data-ln="${ev.co.id}" value="${esc(ev.co.beam_length_m)}" placeholder="${def ? n0(def) : 'Enter'}" class="${ev.len ? '' : 'need'}"></label><label>RPM next ${rpmInput(ev.to, o.panna, 'cn' + key)}</label></div>`;
      if (ev.lotMissing) out += `<div class="note bad">That beam lot no longer exists. Pick another beam.</div>`;
      if (ev.lot && lotLeft(ev.lot) < 0) out += `<div class="note bad">More looms take beams from this lot than it holds.</div>`;
      if (ev.lotLate) out += `<div class="note bad">This beam arrives after the loom runs out.</div>`;
      out += warpLines(ev);
    } else if (ev) out += `<div class="small">Loom stands idle from ${fd(ev.day)} until you plan a fabric for it below.</div>`;
    return out + '</div>';
  }).join('')}</div>`;

  // idle looms
  const idle = [];
  P.looms.forEach((o) => o.segs.forEach((s, i) => {
    if (s.f) return;
    const from = s.start === -Infinity ? P.D0 : s.start;
    if (from >= P.D0 + P.H) return;
    if (s.end != null && s.end < P.D0) return;
    idle.push({ o, s, i, from, restart: o.events[i] || null });
  }));
  h += `<div class="section-title"><h3>Idle looms</h3><span class="small">${idle.length}</span></div>`;
  h += idle.length ? `<div class="grid2">${idle.map(({ o, from, restart }) => `<div class="card tight">
      <div class="row"><span><span class="loomno">Loom ${o.no}</span> <span class="small">${esc(o.g ? o.g.label : '')}</span></span><span class="pill">Idle from ${from <= P.D0 ? 'today' : sd(from)}</span></div>
      ${restart ? `<div class="row"><span class="grow small">Starts ${esc(restart.to ? restart.to.label : '–')} on ${fd(restart.day)}${restart.kind === 'lot' ? ' (beam from stock)' : ''}</span><button class="btn quiet small" data-act="restart" data-id="${o.row.id}" data-co="${restart.co.id}">Edit</button></div>${warpLines(restart)}` : `<div class="row"><span class="small grow">No fabric planned.</span><button class="btn small" data-act="restart" data-id="${o.row.id}" data-from="${from}">Plan a fabric</button></div>`}
    </div>`).join('')}</div>` : `<div class="card tight"><span class="small muted">No looms stand idle in this window.</span></div>`;
  return h;
}
function restartSheet(loomRowId, coId, from) {
  const o = S.P.looms.find((x) => x.row.id === loomRowId);
  const co = coId ? rows('PlannerChangeovers').find((c) => c.id === coId) : null;
  const minD = C.addDays(S.date, 1);
  const v = co ? { ...co } : { date: C.dayStr(Math.max(+from || 0, S.P.D0 + 1)), to_fabric_id: '', beam: 'new', beam_length_m: '' };
  const body = (v) => `${sheetHead(`Loom ${o.no}: start a fabric`)}
    <label class="field"><span>Start on</span><input type="date" name="date" min="${minD}" value="${esc(v.date)}" required></label>
    <label class="field"><span>Fabric</span><select name="to_fabric_id"><option value="">Choose fabric</option>${fabricOptions(o.row.loom_group_id, o.panna, v.to_fabric_id)}</select></label>
    ${v.to_fabric_id ? `<label class="field"><span>Beam</span><select name="beam">${beamOptions(o, v.to_fabric_id, C.dayNum(v.date), v.beam)}</select></label>
    <label class="field"><span>Beam length, m</span><input type="number" name="beam_length_m" inputmode="numeric" min="0" step="10" value="${esc(v.beam_length_m)}" placeholder="${n0(C.beamLen(S.M, v.to_fabric_id, o.row.loom_group_id)) === '–' ? 'Enter' : n0(C.beamLen(S.M, v.to_fabric_id, o.row.loom_group_id))}"></label>` : ''}
    <p class="err"></p>
    <div class="btns"><button class="btn" value="save">Save</button>${co ? '<button class="btn danger" value="delete" formnovalidate>Remove</button>' : ''}</div>`;
  openSheet(body(v), (f, act) => {
    if (act === 'delete') { commit([{ tab: 'PlannerChangeovers', op: 'delete', row: co, summary: `Loom ${o.no} restart removed` }]); return; }
    if (!f.date || f.date < minD) return 'Pick a date after the plan date.';
    if (!f.to_fabric_id) return 'Choose the fabric.';
    const beam = f.beam || 'new';
    if (beam === 'new' && !C.num(f.beam_length_m) && !C.beamLen(S.M, f.to_fabric_id, o.row.loom_group_id)) return 'Enter the beam length.';
    commit([{ tab: 'PlannerChangeovers', row: { id: co ? co.id : newId('co'), loom_no: String(o.no), date: f.date, to_fabric_id: f.to_fabric_id, beam, beam_length_m: f.beam_length_m || '', notes: co ? co.notes || '' : '' }, summary: `Loom ${o.no} starts ${fl(f.to_fabric_id)} on ${f.date}` }]);
  }, (e, f) => { if (e.target.name === 'to_fabric_id' || e.target.name === 'date') sheetBody.innerHTML = body({ ...v, ...f }); });
}

// ---------- 5. Yarn requirement ----------
function matrix(key, lk, unit, empty) {
  const P = S.P;
  const tot = (y) => P.days.reduce((t, d) => t + (d[key][y] || 0), 0);
  const ys = [...new Set(P.days.flatMap((d) => Object.keys(d[key])))].filter((y) => tot(y) > 0.05 && (!S.tpmOnly || isTpm(y))).sort((a, b) => tot(b) - tot(a));
  if (!ys.length) return `<div class="card tight"><span class="small muted">${empty}</span></div>`;
  return `<div class="tw"><table><thead><tr><th>Yarn</th>${P.days.map((_, d) => `<th>${dl(d)}</th>`).join('')}<th>Total kg</th></tr></thead><tbody>
  ${ys.map((y) => `<tr><td>${esc(yn(y))}${tpmPill(y)}</td>${P.days.map((d) => `<td>${kg(d[key][y])}${lk && d[lk][y] ? `<span class="small">${unit} ${d[lk][y].join(', ')}</span>` : ''}</td>`).join('')}<td><b>${kg(tot(y))}</b></td></tr>`).join('')}
  <tr class="tot"><td>Total</td>${P.days.map((d) => `<td>${kg(ys.reduce((t, y) => t + (d[key][y] || 0), 0))}</td>`).join('')}<td>${kg(ys.reduce((t, y) => t + tot(y), 0))}</td></tr></tbody></table></div>`;
}
function scrYarn() {
  return `<div class="screen-head"><h2>Yarn requirement</h2>${tpmSeg()}</div><p class="small">${winTxt()}</p>
  <h3>Beams running out with no next fabric chosen</h3>${strip('pend', 'loom', 'all planned')}
  ${flagNotes()}
  <h3>Weft, kg per day</h3>${matrix('weft', null, '', 'No weft needed in this window.')}
  <h3>Warp for new beams, kg</h3><p class="small">Dated ${lead()} day${lead() === 1 ? '' : 's'} before the changeover (warping lead time, set in Settings). Beams from stock book no warp.</p>
  ${matrix('warp', 'warpLooms', 'loom', 'No warp booked in this window.')}`;
}

// ---------- 6. Beam stock ----------
function scrBeams() {
  const P = S.P, M = S.M;
  const lots = Object.values(P.lots);
  const stock = lots.filter((l) => l.src === 'stock'), rc = lots.filter((l) => l.src === 'receipt');
  const lotCard = (l) => {
    const g = M.groups[l.group_id], def = C.beamLen(M, l.fabric_id, l.group_id);
    const arriving = rc.filter((r) => r.fabric_id === l.fabric_id && r.group_id === l.group_id);
    const left = lotLeft(l);
    return `<div class="card tight ${left < 0 ? 'bad' : ''}">
      <div class="row"><span class="title">${esc(fl(l.fabric_id))}</span><span class="small">${esc(g ? g.label : 'unknown group')}</span></div>
      <div class="inline"><label>Beams ready <input type="number" inputmode="numeric" min="0" step="1" id="bsb-${l.row.id}" data-bs="${l.row.id}" data-f="beams" value="${esc(l.row.beams)}"></label>
      <label>Length, m <input type="number" inputmode="numeric" min="0" step="10" id="bsl-${l.row.id}" data-bs="${l.row.id}" data-f="length_m" value="${esc(l.row.length_m)}" placeholder="${def ? n0(def) : 'Enter'}" class="${l.len ? '' : 'need'}"></label></div>
      <dl class="kv"><dt>Arriving from outside</dt><dd>${arriving.length ? arriving.map((r) => `${r.beams} on ${sd(r.arrive)}`).join(', ') : '–'}</dd>
      <dt>Taken by changeovers</dt><dd>${l.used.length ? l.used.map((u) => `loom ${u.loom} (${sd(u.day)})`).join(', ') : '–'}</dd>
      <dt>Beams left</dt><dd><b>${left}</b></dd></dl>
      <div class="row"><span class="small">${esc(l.row.notes || '')}</span><button class="btn danger small" data-act="bs-del" data-id="${l.row.id}">Remove</button></div>
    </div>`;
  };
  return `<div class="screen-head"><h2>Beam stock</h2><button class="btn small" data-act="bs-add">Add beams</button></div>
  <p class="small">Ready beams per fabric and loom group. The length starts from the beam length in the fabric master and can be changed here.</p>
  ${stock.length ? `<div class="grid2">${stock.map(lotCard).join('')}</div>` : '<div class="card empty">No beams in stock. Tap Add beams.</div>'}
  <div class="section-title"><h3>Beams arriving from outside</h3><span class="small">entered on Receipts</span></div>
  ${rc.length ? `<div class="grid2">${rc.map((l) => `<div class="card tight"><div class="row"><span class="title">${esc(fl(l.fabric_id))}</span><span class="small">${esc(M.groups[l.group_id] ? M.groups[l.group_id].label : '')}</span></div>
    <dl class="kv"><dt>Arriving</dt><dd>${l.beams} from ${sd(l.arrive)} · ${n0(l.len)} m</dd><dt>Taken by changeovers</dt><dd>${l.used.length ? l.used.map((u) => `loom ${u.loom}`).join(', ') : '–'}</dd><dt>Left</dt><dd>${lotLeft(l)}</dd></dl></div>`).join('')}</div>` : '<div class="card tight"><span class="small muted">No beams expected.</span></div>'}`;
}
function beamStockSheet() {
  const M = S.M;
  const v0 = { loom_group_id: M.groupList[0] ? M.groupList[0].id : '', fabric_id: '', beams: '1', length_m: '', notes: '' };
  const body = (v) => {
    const g = M.groups[v.loom_group_id];
    const def = v.fabric_id ? C.beamLen(M, v.fabric_id, v.loom_group_id) : null;
    return `${sheetHead('Add beams to stock')}
    <label class="field"><span>Loom group</span><select name="loom_group_id">${M.groupList.map((g) => `<option value="${g.id}"${sel(g.id, v.loom_group_id)}>${esc(g.label)}</option>`).join('')}</select></label>
    <label class="field"><span>Fabric</span><select name="fabric_id"><option value="">Choose fabric</option>${fabricOptions(v.loom_group_id, C.defPanna(g), v.fabric_id)}</select></label>
    <div class="fields"><label class="field"><span>Beams</span><input type="number" name="beams" inputmode="numeric" min="1" step="1" value="${esc(v.beams)}"></label>
    <label class="field"><span>Length per beam, m</span><input type="number" name="length_m" inputmode="numeric" min="0" step="10" value="${esc(v.length_m)}" placeholder="${def ? n0(def) : 'Enter'}"></label></div>
    <label class="field"><span>Notes</span><input type="text" name="notes" value="${esc(v.notes)}"></label>
    <p class="err"></p><div class="btns"><button class="btn" value="save">Add</button></div>`;
  };
  openSheet(body(v0), (f) => {
    if (!f.fabric_id) return 'Choose the fabric.';
    const b = C.num(f.beams);
    if (!b || b < 1) return 'Enter the number of beams.';
    if (!C.num(f.length_m) && !C.beamLen(M, f.fabric_id, f.loom_group_id)) return 'This fabric has no beam length in the master. Enter the length.';
    commit([{ tab: 'PlannerBeamStock', row: { id: newId('bs'), fabric_id: f.fabric_id, loom_group_id: f.loom_group_id, beams: String(Math.round(b)), length_m: f.length_m || '', notes: f.notes || '' }, summary: `${b} beam(s) ${fl(f.fabric_id)}` }]);
  }, (e, f) => { if (e.target.name !== 'notes' && e.target.name !== 'beams') sheetBody.innerHTML = body({ ...v0, ...f }); });
}

// ---------- 7. Yarn stock ----------
function scrYarnStock() {
  const P = S.P, M = S.M;
  const date = S.ysDate && S.ysDate <= S.date ? S.ysDate : S.date;
  const entries = rows('PlannerYarnStock').filter((r) => r.date === date);
  const ys = [...new Set([...P.yarnIds, ...S.ysExtra, ...entries.map((r) => r.yarn_id)])].filter((y) => M.yarns[y]).sort((a, b) => isTpm(b) - isTpm(a) || yn(a).localeCompare(yn(b)));
  const dates = [...new Set(rows('PlannerYarnStock').map((r) => r.date))].sort().reverse().slice(0, 6);
  const line = (y) => {
    const e = entries.find((r) => r.yarn_id === y);
    const op = P.opening[y];
    return `<div class="row card tight" style="flex-direction:row"><span class="grow">${esc(yn(y))}${tpmPill(y)}<span class="small" style="display:block">${op ? `Opening ${kg(op.kg)} kg (entered ${sd(op.day)})` : 'No stock entered'}</span></span>
      <input type="number" inputmode="decimal" min="0" step="1" id="ys-${y}" data-ys="${y}" value="${e ? esc(e.kg) : ''}" placeholder="kg" aria-label="${esc(yn(y))} kg on ${date}"></div>`;
  };
  return `<div class="screen-head"><h2>Yarn stock</h2></div>
  <div class="card tight"><div class="inline"><label>Stock on <input type="date" id="ys-date" data-act-change="ys-date" max="${S.date}" value="${date}"></label></div>
  <p class="small">Enter kg on hand per yarn for this date. The latest entry on or before the plan date is the opening stock. Leave a box empty to keep the earlier entry.</p>
  ${dates.length ? `<p class="small">Entries on: ${dates.map((d) => `<button class="link" data-act="ys-pick" data-v="${d}">${sd(C.dayNum(d))}</button>`).join(' · ')}</p>` : ''}
  <div class="field"><span>Yarn not in the list</span>${yarnPick({ kind: 'ys-add', blank: 'Add a yarn to enter its stock', title: 'Add yarn stock', domId: 'ys-add' })}</div></div>
  <div class="section-title"><h3>TPM yarns</h3></div><div class="grid2">${ys.filter(isTpm).map(line).join('')}</div>
  <div class="section-title"><h3>Other yarns</h3></div><div class="grid2">${ys.filter((y) => !isTpm(y)).map(line).join('')}</div>`;
}

// ---------- 8. Receipts ----------
function receiptText(r) {
  const unit = r.kind === 'yarn' ? 'kg' : r.qty === 1 ? 'beam' : 'beams';
  const q = `${r.kind === 'yarn' ? kg(r.qty) : r.qty} ${unit}`;
  return r.mode === 'oneoff' ? `${q} on ${fd(r.start)}` : `${q} a day from ${fd(r.start)} ${r.days ? `for ${r.days} days (to ${sd(r.last)})` : 'until further notice'}`;
}
function receiptItem(r) {
  if (r.kind === 'yarn') return esc(yn(r.row.item)) + tpmPill(r.row.item);
  const [f, g] = String(r.row.item || '').split('@');
  return `${esc(fl(f))} <span class="small">${esc(S.M.groups[g] ? S.M.groups[g].label : '')}</span>`;
}
function scrReceipts() {
  const P = S.P;
  const open = P.recs.filter((r) => !r.done).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const done = P.recs.filter((r) => r.done).sort((a, b) => (b.last ?? 0) - (a.last ?? 0));
  const inWin = (r) => P.days.reduce((t, d) => t + r.on(d.day), 0);
  return `<div class="screen-head"><h2>Receipts from outside</h2><button class="btn small" data-act="rc-add">Add receipt</button></div>
  <p class="small">Yarn or beams coming from outside, one-off or a daily average, dated today or later. Yarn arriving today counts in today's stock and deficit. Each stays editable until it is fully received.</p>
  <div class="section-title"><h3>Expected</h3><span class="small">${open.length}</span></div>
  ${open.length ? `<div class="grid2">${open.map((r) => {
    const lot = P.lots['rcpt:' + r.row.id];
    const w = inWin(r);
    return `<div class="card tight"><div class="row"><span class="pill ${r.kind === 'yarn' ? 'acc' : ''}">${r.kind === 'yarn' ? 'Yarn' : 'Beam'}</span><span class="small">${r.mode === 'daily' ? 'Daily average' : 'One-off'}</span></div>
      <div class="title">${receiptItem(r)}</div><div>${receiptText(r)}</div>
      <div class="small">${esc(r.row.source || '')}${r.row.notes ? ' · ' + esc(r.row.notes) : ''}</div>
      <div class="row"><span class="small">${r.kind === 'yarn' ? (w ? `${kg(w)} kg in this window` : 'after this window') : lot && lot.used.length ? `taken by loom ${lot.used.map((u) => u.loom).join(', ')}` : 'no changeover takes it yet'}</span>
      <span class="btns"><button class="btn quiet small" data-act="rc-edit" data-id="${r.row.id}">Edit</button><button class="btn danger small" data-act="rc-del" data-id="${r.row.id}">Remove</button></span></div></div>`;
  }).join('')}</div>` : '<div class="card empty">No receipts expected.</div>'}
  ${done.length ? `<div class="section-title"><h3>Arrived</h3><span class="small">now part of stock</span></div><div class="grid2">${done.map((r) => `<div class="card tight"><div class="title">${receiptItem(r)}</div><div class="small">${receiptText(r)} · ${esc(r.row.source || '')}</div><div class="row"><span class="pill ok">Arrived</span><button class="btn danger small" data-act="rc-del" data-id="${r.row.id}">Remove</button></div></div>`).join('')}</div>` : ''}`;
}
function receiptSheet(id) {
  const M = S.M;
  const r = id ? rows('PlannerReceipts').find((x) => x.id === id) : null;
  // yarn can arrive today (plan date); beams from the next day, as before
  const minFor = (kind) => (kind === 'yarn' ? S.date : C.addDays(S.date, 1));
  const v0 = r ? { ...r } : { kind: 'yarn', item: '', mode: 'oneoff', start_date: S.date, days: '', qty: '', length_m: '', source: '', notes: '' };
  const beamItems = (cur) => `<option value="">Choose fabric and loom group</option>${M.groupList.flatMap((g) => M.fabricList.filter((f) => C.fits(f, g, C.defPanna(g))).map((f) => `<option value="${f.id}@${g.id}"${sel(f.id + '@' + g.id, cur)}>${esc(f.label)} · ${esc(g.label)}</option>`)).join('')}`;
  const body = (v) => {
    const [bf, bg] = String(v.item || '').split('@');
    const def = v.kind === 'beam' && bf ? C.beamLen(M, bf, bg) : null;
    return `${sheetHead(r ? 'Edit receipt' : 'Add receipt')}
    <div class="fields"><label class="field"><span>Type</span><select name="kind"><option value="yarn"${sel('yarn', v.kind)}>Yarn</option><option value="beam"${sel('beam', v.kind)}>Beams</option></select></label>
    <label class="field"><span>How it comes</span><select name="mode"><option value="oneoff"${sel('oneoff', v.mode)}>One-off</option><option value="daily"${sel('daily', v.mode)}>Daily average</option></select></label></div>
    ${v.kind === 'yarn' ? `<div class="field"><span>Yarn</span><input type="hidden" name="item" value="${esc(v.item)}">${pickBtn({ label: 'Yarn', text: S.M.yarns[v.item] ? S.M.yarns[v.item].name : 'Choose yarn', empty: !S.M.yarns[v.item], attrs: { kind: 'field', name: 'item', cur: v.item, title: 'Yarn received' } })}</div>`
    : `<label class="field"><span>Beam of</span><select name="item">${beamItems(v.item)}</select></label>`}
    <div class="fields"><label class="field"><span>${v.mode === 'daily' ? 'From' : 'Arrives on'}</span><input type="date" name="start_date" min="${r ? '' : minFor(v.kind)}" value="${esc(v.start_date)}"></label>
    <label class="field"><span>${v.kind === 'yarn' ? 'Kg' : 'Beams'}${v.mode === 'daily' ? ' per day' : ''}</span><input type="number" name="qty" inputmode="decimal" min="0" step="${v.kind === 'yarn' ? 'any' : 1}" value="${esc(v.qty)}"></label>
    ${v.mode === 'daily' ? `<label class="field"><span>For how many days</span><input type="number" name="days" inputmode="numeric" min="1" step="1" value="${esc(v.days)}" placeholder="Indefinite"></label>` : ''}
    ${v.kind === 'beam' ? `<label class="field"><span>Metres per beam</span><input type="number" name="length_m" inputmode="numeric" min="0" step="10" value="${esc(v.length_m)}" placeholder="${def ? n0(def) : 'Enter'}"></label>` : ''}</div>
    <div class="fields"><label class="field"><span>From</span><input type="text" name="source" value="${esc(v.source)}" placeholder="Supplier or twister"></label>
    <label class="field"><span>Notes</span><input type="text" name="notes" value="${esc(v.notes)}"></label></div>
    <p class="err"></p><div class="btns"><button class="btn" value="save">Save</button></div>`;
  };
  openSheet(body(v0), (f) => {
    f.days = f.days || ''; f.length_m = f.length_m || '';
    if (!f.item) return f.kind === 'yarn' ? 'Choose the yarn.' : 'Choose the fabric and loom group.';
    if (!f.start_date) return 'Enter the date.';
    if ((!r || f.start_date !== r.start_date) && f.start_date < minFor(f.kind)) return f.kind === 'yarn' ? 'Yarn receipts can be dated today or later.' : 'Beam receipts can only be entered for a date after the plan date.';
    const q = C.num(f.qty);
    if (!(q > 0)) return 'Enter a quantity above zero.';
    if (f.kind === 'beam' && !Number.isInteger(q)) return 'Enter a whole number of beams.';
    if (f.mode === 'daily' && f.days !== '' && !(C.num(f.days) >= 1)) return 'Days must be 1 or more, or blank for indefinite.';
    if (f.kind === 'beam') { const [bf, bg] = f.item.split('@'); if (!C.num(f.length_m) && !C.beamLen(M, bf, bg)) return 'Enter metres per beam.'; }
    const row = { id: r ? r.id : newId('rc'), kind: f.kind, item: f.item, mode: f.mode, start_date: f.start_date, days: f.mode === 'daily' ? f.days : '', qty: String(q), length_m: f.kind === 'beam' ? f.length_m : '', source: f.source || '', notes: f.notes || '' };
    commit([{ tab: 'PlannerReceipts', row, summary: `${f.kind === 'yarn' ? yn(f.item) : fl(f.item.split('@')[0]) + ' beams'} · ${q}${f.mode === 'daily' ? '/day' : ''} from ${f.start_date}` }]);
  }, (e, f) => {
    if (['kind', 'mode', 'item'].includes(e.target.name)) {
      if (e.target.name === 'kind') { f.item = ''; if (f.start_date < minFor(f.kind)) f.start_date = minFor(f.kind); }
      sheetBody.innerHTML = body({ ...v0, ...f });
    }
  });
}

// ---------- 9. TFO machines ----------
function sidePick(s, field, blank, domId, need) {
  const cur = s.row[field];
  return yarnPick({ kind: field === 'yarn_id' ? 'ty' : 'tnext', id: s.row.id, type: s.t ? s.t.id : '', cur, blank, domId, need, tpmOnly: true,
    title: `M/C ${s.no} side ${s.side}: ${field === 'yarn_id' ? 'running' : 'load next'}` });
}
function scrTfo() {
  const P = S.P, M = S.M;
  const total = M.typeList.reduce((t, x) => t + x.machines * 2, 0);
  let h = `<div class="screen-head"><h2>TFO machines</h2><span class="small">${winTxt()}</span></div>`;
  h += `<div class="grid2">${M.typeList.map((t) => `<div class="card tight">
    <div class="row"><span class="title">${esc(t.name)}</span><span class="small">M/C ${t.from}–${t.to}</span></div>
    <div class="inline"><label>Spindles per side <input type="number" inputmode="numeric" min="1" step="1" id="tt-sp-${t.id}" data-tt="${t.id}" data-f="spindles_per_side" value="${t.spindlesSet ? t.spindles : ''}" placeholder="${t.spindles}"></label>
    <label>Efficiency % <input type="number" inputmode="decimal" min="1" max="100" step="1" id="tt-ef-${t.id}" data-tt="${t.id}" data-f="efficiency" value="${t.eff ?? ''}" placeholder="${M.tfoDefEff}" class="${t.eff ? '' : 'need'}"></label>
    <label>Doff, g per spindle <input type="number" inputmode="numeric" min="1" step="10" id="tt-dg-${t.id}" data-tt="${t.id}" data-f="doff_g_per_spindle" value="${t.doffSet ? t.doffG : ''}" placeholder="${t.doffG}" class="${t.doffSet ? '' : 'need'}"></label></div>
    <div class="small">Doff per side ${kg(C.doffKgPerSide(t.spindles, t.doffG))} kg${t.doffSet ? '' : ` · using ${t.doffG} g until you save a doff size`}${t.eff ? '' : ` · using the unit default ${M.tfoDefEff}%`}</div>
  </div>`).join('')}</div>`;

  const sides = P.sides;
  if (sides.length < total) h += `<div class="note">${sides.length} of ${total} TFO sides are entered. <button class="link" data-act="sides-setup">Set up the missing sides</button>, then pick what each runs and when it was loaded.</div>`;
  const short = P.yarnIds.filter((y) => isTpm(y) && P.bal[y].first != null).sort((a, b) => P.bal[a].first - P.bal[b].first);
  if (short.length) h += `<div class="note bad">Going short: ${short.map((y) => `${esc(yn(y))} from ${dl(P.bal[y].first)} (${kg(P.bal[y].short)} kg)`).join('; ')}.</div>`;

  // TPM warp deadlines
  const wk = [];
  P.looms.forEach((o) => o.events.forEach((ev) => (ev.warp || []).forEach((w) => { if (w.tpm) wk.push({ o, ev, w }); })));
  wk.sort((a, b) => a.w.latestDoff - b.w.latestDoff);
  h += `<div class="section-title"><h3>TPM warp deadlines</h3><span class="small">for new beams</span></div>`;
  h += wk.length ? `<div class="grid2">${wk.map(({ o, ev, w }) => `<div class="card tight ${w.covered === false ? 'bad' : ''}"><div class="row"><span>${esc(yn(w.yarn_id))}</span><b class="n">${kg(w.kg)} kg</b></div>
    <div class="small">Loom ${o.no} → ${esc(ev.to.label)} on ${fd(ev.day)}. Doff by ${fd(w.latestDoff)}, in weaving by ${fd(w.needDay)} · ${w.sideDoffs ?? '–'} side-doff${w.sideDoffs === 1 ? '' : 's'}</div>
    <div>${w.covered == null ? '<span class="pill">after this window</span>' : w.covered ? '<span class="pill ok">covered</span>' : '<span class="pill bad">short</span>'}</div></div>`).join('')}</div>` : `<div class="card tight"><span class="small muted">No new beams with a TPM warp are planned.</span></div>`;

  // loading plan
  h += `<div class="section-title"><h3>Sides doffing with nothing planned to load</h3></div>${strip('tpend', 'side', 'all planned')}`;
  const due = sides.filter((s) => s.ev[0] && s.ev[0].d < P.H).sort((a, b) => a.ev[0].t - b.ev[0].t || a.no - b.no);
  h += `<div class="section-title"><h3>Loading plan: what goes on after each doff</h3></div>`;
  if (!due.length) h += `<div class="card tight"><span class="small muted">No sides doff in this window.</span></div>`;
  for (let d = 0; d < P.H; d++) {
    const g = due.filter((s) => s.ev[0].d === d);
    if (!g.length) continue;
    const pn = g.filter((s) => !s.row.next_yarn_id).length;
    h += `<div class="row"><b>${dl(d)}</b><span class="small">${g.length} side${g.length === 1 ? '' : 's'} · ${kg(g.reduce((t, s) => t + s.kg, 0))} kg ${pn ? `<span class="pill bad">${pn} to plan</span>` : '<span class="pill ok">all planned</span>'}</span></div>`;
    h += `<div class="grid2">${g.map((s) => { const e = s.ev[0], e2 = s.ev[1]; return `<div class="card tight ${s.row.next_yarn_id ? '' : 'warn'}">
      <div class="row"><span class="loomno">M/C ${s.no} side ${esc(s.side)}</span><span class="small">${e.over ? '<span class="pill bad">doff overdue</span>' : 'doffs ' + hm(e.t)}</span></div>
      <div class="yl"><span>${esc(yn(e.yarn_id))}</span><b>${kg(s.kg)} kg</b></div>
      <div class="small">Reaches weaving ${fd(P.D0 + d + 1)}</div>
      <div class="field"><span>Load next</span>${sidePick(s, 'next_yarn_id', 'Choose yarn to load', 'tn-' + s.row.id, !s.row.next_yarn_id)}</div>
      <div class="row"><span class="small">${e2 ? `Next doff ${tAbs(e2.t)} · ${kg(s.kg)} kg` : s.row.next_yarn_id ? (s.nextNoSpeed ? 'No TFO speed for that yarn on this machine' : 'Next doff after this window') : 'Stops after this doff'}</span>
      ${e.d === 0 || e.over ? `<button class="btn quiet small" data-act="doffed" data-id="${s.row.id}">Doffed, reload</button>` : ''}</div>
    </div>`; }).join('')}</div>`;
  }

  // spindles
  const sp = Object.entries(P.spindles).filter(([, s]) => s.req > 0.05 || s.sides);
  h += `<div class="section-title"><h3>Spindles per TPM yarn</h3><span class="small">window average</span></div>
  <div class="tw"><table><thead><tr><th>Yarn</th><th>Need kg/day</th><th>Sides</th><th>Spindles given</th><th>Spindles needed</th><th>Surplus spindles</th><th>Surplus kg/day</th></tr></thead><tbody>
  ${sp.map(([y, s]) => `<tr><td>${esc(yn(y))}</td><td>${kg(s.req)}</td><td>${s.sides}</td><td>${n0(s.given)}</td><td>${s.needed == null ? 'no speed' : n0(s.needed)}</td><td class="${s.surSp < 0 ? 'neg' : ''}">${s.surSp == null ? '–' : (s.surSp > 0 ? '+' : '') + n0(s.surSp)}</td><td class="${s.surKg < -0.05 ? 'neg' : ''}">${(s.surKg > 0 ? '+' : '') + kg(s.surKg)}</td></tr>`).join('') || '<tr><td colspan="7">No TPM yarn in use.</td></tr>'}</tbody></table></div>`;

  // all sides
  h += `<div class="section-title"><h3>All sides: what is running now</h3><span class="small">${sides.length} of ${total}</span></div>`;
  M.typeList.forEach((t) => {
    const ts = sides.filter((s) => s.t && s.t.id === t.id);
    if (!ts.length) return;
    h += `<p class="small"><b>${esc(t.name)}</b></p><div class="grid2">${ts.map((s) => {
      const e = s.ev[0];
      const sp1 = s.row.yarn_id ? C.tfoSpeed(M, t.id, s.row.yarn_id) : null;
      return `<div class="card tight ${s.noSpeed ? 'bad' : ''}">
      <div class="row"><span class="loomno">M/C ${s.no} · ${esc(s.side)}</span><span class="small">${e ? (e.over ? '<span class="pill bad">doff overdue</span>' : `doffs ${e.d < P.H ? dl(e.d) : sd(P.D0 + e.d)} ${hm(e.t)}`) : s.row.yarn_id ? '' : '<span class="pill">empty</span>'}</span></div>
      <div class="field"><span>Running</span>${sidePick(s, 'yarn_id', 'Nothing loaded', 'ty-' + s.row.id)}</div>
      <div class="inline"><label>Loaded <input type="datetime-local" id="tl-${s.row.id}" data-tl="${s.row.id}" value="${esc(String(s.row.loaded_at || '').slice(0, 16))}" class="${s.row.yarn_id && s.noLoad ? 'need' : ''}"></label></div>
      <div class="field"><span>Load next</span>${sidePick(s, 'next_yarn_id', 'Nothing planned', 'tn2-' + s.row.id)}</div>
      <div class="small">${sp1 ? `${sp1.gph.toFixed(2)} g/spindle/h · ${C.hoursPerDoff(t.doffG, sp1.gph).toFixed(0)} h per doff · ${kg(s.kg)} kg` : s.row.yarn_id ? 'No TFO speed for this yarn on this machine type. Add it in the Fabric Database app.' : ''}</div>
    </div>`;
    }).join('')}</div>`;
  });
  return h;
}

// ---------- 10. Stock and deficit ----------
function scrStock() {
  const P = S.P;
  const all = P.yarnIds.slice().sort((a, b) => (P.bal[a].first ?? 99) - (P.bal[b].first ?? 99) || (P.bal[a].cover ?? 999) - (P.bal[b].cover ?? 999));
  const ys = all.filter((y) => !S.tpmOnly || isTpm(y));
  const def = all.filter((y) => P.bal[y].first != null);
  let h = `<div class="screen-head"><h2>Stock and deficit</h2>${tpmSeg()}</div>
  <div class="stats">
    <div class="stat ${def.length ? 'bad' : ''}"><span>Yarns in deficit</span><b>${def.length}</b><span>of ${all.length} yarns</span></div>
    <div class="stat ${def.filter(isTpm).length ? 'bad' : ''}"><span>TPM yarns in deficit</span><b>${def.filter(isTpm).length}</b><span>of ${all.filter(isTpm).length}</span></div>
    <div class="stat"><span>First deficit</span><b>${def.length ? dl(P.bal[def[0]].first) : 'None'}</b><span>${def.length ? esc(yn(def[0])) : 'all yarns covered'}</span></div>
  </div>
  <p class="small">${winTxt()}. Each day shows the closing balance: opening + TFO arrivals + receipts − weft − warp for new beams. Red is a deficit.</p>
  <div class="tw"><table><thead><tr><th>Yarn</th><th>Opening</th>${P.days.map((_, d) => `<th>${dl(d)}</th>`).join('')}<th>Days of cover</th><th>First deficit</th></tr></thead><tbody>
  ${ys.map((y) => { const B = P.bal[y]; return `<tr><td>${esc(yn(y))}${S.tpmOnly ? '' : tpmPill(y)}</td><td>${kg(B.row[0] ? B.row[0].open : 0)}<span class="small">${B.opening ? sd(B.opening.day) : 'no entry'}</span></td>
    ${B.row.map((c) => `<td class="${c.close < -0.05 ? 'neg' : ''}">${Math.abs(c.close) < 0.05 ? '0' : kg(c.close)}<span class="small">${[c.need && 'need ' + kg(c.need), c.arr && 'TFO ' + kg(c.arr), c.rcpt && 'rcpt ' + kg(c.rcpt)].filter(Boolean).map((x) => `<span class="nb">${x}</span>`).join(' · ')}</span></td>`).join('')}
    <td>${B.cover == null ? '–' : B.cover.toFixed(1)}</td><td>${B.first != null ? `<span class="pill bad">${dl(B.first)}</span><span class="small">short ${kg(B.short)} kg</span>` : B.need ? '<span class="pill ok">Covered</span>' : '<span class="small">no need</span>'}</td></tr>`; }).join('') || `<tr><td colspan="${P.H + 4}">No yarns.</td></tr>`}
  </tbody></table></div>`;
  const sp = Object.entries(P.spindles).filter(([, s]) => s.req > 0.05 || s.sides);
  h += `<div class="section-title"><h3>Spindle surplus or deficit, TPM yarns</h3></div>
  <div class="grid2">${sp.map(([y, s]) => `<div class="card tight ${s.surSp < 0 ? 'bad' : ''}"><div class="row"><span class="title">${esc(yn(y))}</span><span class="pill ${s.surSp < 0 ? 'bad' : 'ok'}">${s.surSp == null ? 'no speed' : (s.surSp >= 0 ? '+' : '') + n0(s.surSp) + ' spindles'}</span></div>
    <dl class="kv"><dt>Need, kg/day</dt><dd>${kg(s.req)}</dd><dt>Sides on it</dt><dd>${s.sides} · ${n0(s.given)} spindles</dd><dt>Spindles needed</dt><dd>${s.needed == null ? '–' : n0(s.needed)}</dd><dt>Surplus, kg/day</dt><dd>${(s.surKg > 0 ? '+' : '') + kg(s.surKg)}</dd></dl></div>`).join('')}</div>`;
  return h;
}

// ---------- 11. RPM master ----------
function scrRpm() {
  const P = S.P, M = S.M, D0 = P.days[0];
  const today = (fid) => Object.values(D0.fab).filter((x) => x.f.id === fid).reduce((t, x) => t + x.looms, 0);
  return `<div class="screen-head"><h2>RPM master</h2></div>
  <p class="small">Loom RPM of each Weavelon 2 fabric, as in the Fabrics tab. Single panna looms use the first figure, double panna looms the second. A change here or on any other screen is saved to the fabric, so the Fabric Database app shows it too.</p>
  <div class="tw"><table><thead><tr><th>Fabric</th><th>Single panna</th><th>Double panna</th><th>Looms today</th></tr></thead><tbody>
  ${M.fabricList.map((f) => `<tr><td><b>${esc(f.label)}</b><span class="small">${f.weave} · PPI ${f.ppi ?? '–'}</span></td><td>${rpmInput(f, 1, 'rm')}</td><td>${rpmInput(f, 2, 'rm')}</td><td>${mc(today(f.id)) === '0' ? '–' : mc(today(f.id))}</td></tr>`).join('')}
  </tbody></table></div>`;
}

// ---------- 12. Fabric master and 13. Yarn master (view only) ----------
// No money anywhere here: no cost per pick, price, rates, processing, brokering, VATAV or TPM delta.
const viewOnly = '<p class="note ok">View only. Edit in the Fabric Database app.</p>';
const searchBox = (id, q, ph, label) => `<label class="search page-search"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m10.4 10.4 3.4 3.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><input type="search" id="${id}" value="${esc(q)}" placeholder="${esc(ph)}" aria-label="${esc(label)}" autocomplete="off" spellcheck="false"></label>`;
const den0 = (v) => (v == null ? '–' : Number.isInteger(v) ? String(v) : v.toFixed(1));
// fabrics of Weavelon 2 that use a yarn, with the side
function yarnUse(yid) {
  return S.M.fabricList.flatMap((f) => {
    const sides = [f.warp.some((w) => w.yarn_id === yid) && 'warp', f.weft.some((w) => w.yarn_id === yid) && 'weft'].filter(Boolean);
    return sides.length ? [{ f, sides }] : [];
  });
}
function groupsFor(f) {
  return S.M.groupList.map((g) => {
    const p = C.defPanna(g);
    if (f.dobby && !g.dobby) return { g, ok: false, txt: 'no: dobby fabric needs a dobby loom' };
    if (C.fits(f, g, p)) return { g, ok: true, txt: pannaTxt(p) };
    if (p > 1 && C.fits(f, g, 1)) return { g, ok: true, txt: 'single panna only' };
    return { g, ok: false, txt: 'no: does not fit the reed' };
  });
}

function scrFabricMaster() {
  const M = S.M;
  const card = (f) => {
    const txt = [f.label, f.weave, f.note, ...f.warp.map((w) => yn(w.yarn_id)), ...f.weft.map((w) => yn(w.yarn_id))].join(' ');
    return `<button class="card tight tap" data-act="fm-open" data-id="${f.id}" data-s="${esc(txt.toLowerCase())}">
      <div class="row"><span class="title">${esc(f.label)}</span><span class="pill ${f.dobby ? 'acc' : ''}">${f.weave}</span></div>
      <dl class="kv nw"><dt>PPI · reed · RS</dt><dd>${f.ppi ?? '–'} · ${f.reed ?? '–'} · ${f.rs ?? '–'}″</dd>
      <dt>RPM single / double</dt><dd>${f.rpm1 ? n0(f.rpm1) : '–'} / ${f.rpm2 ? n0(f.rpm2) : '–'}</dd>
      <dt>Shortage warp / weft</dt><dd>${f.wsh}% / ${f.fsh}%</dd></dl></button>`;
  };
  return `<div class="screen-head"><h2>Fabric master</h2><span class="small">${M.fabricList.length} fabrics on ${esc(M.unit.name || 'Weavelon 2')}</span></div>
  ${searchBox('fm-q', S.fq, 'Search fabric, weave or yarn', 'Search fabrics')}
  ${viewOnly}
  <div class="grid2" data-sgroup>${M.fabricList.map(card).join('')}</div>
  <div class="card empty" id="fm-none" hidden>No fabric matches.</div>`;
}
function fabricDetail(fid) {
  const M = S.M, f = M.fabrics[fid];
  if (!f) return;
  const beams = M.groupList.map((g) => ({ g, b: M.beams.find((b) => b.fabric_id === fid && b.group_id === g.id) }));
  const gs = groupsFor(f);
  const today = Object.values(S.P.days[0].fab).filter((x) => x.f.id === fid).reduce((t, x) => t + x.looms, 0);
  openSheet(`${sheetHead(f.label)}
    <p class="small">View only. Edit in the Fabric Database app.</p>
    <dl class="kv"><dt>Weave</dt><dd>${f.weave}</dd>${f.note ? `<dt>Design</dt><dd>${esc(f.note)}</dd>` : ''}
    <dt>PPI</dt><dd>${f.ppi ?? '–'}</dd><dt>Reed</dt><dd>${f.reed ?? '–'}</dd><dt>Reed space</dt><dd>${f.rs ?? '–'}″</dd>${f.greige ? `<dt>Greige width</dt><dd>${f.greige}″</dd>` : ''}
    <dt>Loom RPM, single panna</dt><dd>${f.rpm1 ? n0(f.rpm1) : '–'}</dd><dt>Loom RPM, double panna</dt><dd>${f.rpm2 ? n0(f.rpm2) : '–'}</dd>
    <dt>Warp shortage</dt><dd>${f.wsh}%</dd><dt>Weft shortage</dt><dd>${f.fsh}%</dd><dt>Looms on it today</dt><dd>${today ? mc(today) : '–'}</dd></dl>
    <h3>Warp</h3>
    <div class="tw"><table><thead><tr><th>Yarn</th><th>Ends per panna</th><th>Denier</th></tr></thead><tbody>
    ${f.warp.map((w) => `<tr><td>${esc(yn(w.yarn_id))}${tpmPill(w.yarn_id)}</td><td>${n0(w.ends)}</td><td>${den0(M.yarns[w.yarn_id] && M.yarns[w.yarn_id].den)}</td></tr>`).join('') || '<tr><td colspan="3">No warp yarn.</td></tr>'}</tbody></table></div>
    <h3>Weft</h3>
    <div class="tw"><table><thead><tr><th>Yarn</th><th>Parts</th><th>PPI share</th><th>Denier</th></tr></thead><tbody>
    ${f.weft.map((w) => `<tr><td>${esc(yn(w.yarn_id))}${tpmPill(w.yarn_id)}</td><td>${w.parts ?? '–'}</td><td>${f.ppi ? (f.ppi * w.share).toFixed(1) : '–'} <span class="small">${Math.round(w.share * 100)}%</span></td><td>${den0(M.yarns[w.yarn_id] && M.yarns[w.yarn_id].den)}</td></tr>`).join('') || '<tr><td colspan="4">No weft yarn.</td></tr>'}</tbody></table></div>
    <h3>Loom groups and beam length</h3>
    <div class="list">${gs.map(({ g, ok, txt }) => { const b = beams.find((x) => x.g.id === g.id).b; return `<div class="card tight${ok ? '' : ' off'}"><div class="row"><span class="grow"><b>${esc(g.label)}</b><span class="small" style="display:block">${ok ? 'Runs on it · ' : 'Cannot run · '}${txt.replace(/^no: /, '')}</span></span><span class="small n">${b ? `beam ${n0(b.len)} m` : ok ? 'beam length not set' : ''}</span></div></div>`; }).join('')}</div>`, null);
}

function scrYarnMaster() {
  const M = S.M;
  const all = Object.values(M.yarns).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  const card = (y) => {
    const use = yarnUse(y.id);
    const base = y.base && M.yarns[y.base];
    const twisted = !y.isTpm ? all.filter((t) => t.base === y.id) : [];
    const sp = y.isTpm ? M.typeList.map((t) => ({ t, s: M.speeds[t.id + '|' + y.id], c: C.tfoSpeed(M, t.id, y.id) })) : [];
    const txt = [y.name, y.count, y.unit, y.tpm, y.twist, base ? base.name : '', y.material, ...use.map((u) => u.f.label)].join(' ');
    return `<div class="card tight" data-s="${esc(txt.toLowerCase())}">
      <div class="row"><span class="title">${esc(y.name)}</span>${y.isTpm ? '<span class="pill tpm">TPM</span>' : ''}</div>
      <dl class="kv"><dt>Count</dt><dd>${y.count != null ? `${den0(y.count)} ${esc(y.unit)}` : '–'}${y.den != null && y.unit.toUpperCase() !== 'D' ? ` · ${den0(y.den)} D` : ''}</dd>
      ${y.isTpm ? `<dt>TPM</dt><dd>${y.tpm != null ? n0(y.tpm) : '–'}</dd>` : ''}
      <dt>Twist</dt><dd>${esc(y.twist) || '–'}</dd>
      ${y.isTpm ? `<dt>Base yarn</dt><dd>${base ? esc(base.name) : '–'}</dd>` : twisted.length ? `<dt>Twisted as</dt><dd>${twisted.map((t) => esc(t.name)).join(', ')}</dd>` : ''}
      ${y.material ? `<dt>Material</dt><dd>${esc(y.material)}</dd>` : ''}</dl>
      ${y.isTpm ? `<div><div class="small muted">TFO speed</div><div class="speeds">${sp.map(({ t, s, c }) => `<div>${esc(t.name)}: <b>${s && s.rpm ? `${n0(s.rpm)} RPM${c ? ` · ${c.gph.toFixed(2)} g/spindle/h` : ''}` : 'no speed'}</b></div>`).join('') || '<div class="small">No TFO types.</div>'}</div></div>` : ''}
      <div><div class="small muted">Used in</div><div class="small">${use.length ? use.map((u) => `${esc(u.f.label)} <span class="muted">(${u.sides.join(', ')})</span>`).join(' · ') : 'No Weavelon 2 fabric'}</div></div>
    </div>`;
  };
  const tpm = all.filter((y) => y.isTpm), base = all.filter((y) => !y.isTpm);
  return `<div class="screen-head"><h2>Yarn master</h2><span class="small">${all.length} yarns</span></div>
  ${searchBox('ym-q', S.yq, 'Search, e.g. tpm 1650', 'Search yarns')}
  ${viewOnly}
  <section data-sgroup><div class="section-title"><h3>TPM yarns</h3><span class="small" data-scount>${tpm.length}</span></div><div class="grid2">${tpm.map(card).join('')}</div></section>
  <section data-sgroup><div class="section-title"><h3>Base yarns</h3><span class="small" data-scount>${base.length}</span></div><div class="grid2">${base.map(card).join('')}</div></section>
  <div class="card empty" id="ym-none" hidden>No yarn matches.</div>`;
}
// filter the master lists in place (no re-render, so typing is never interrupted)
function applySearch() {
  const q = S.tab === 'fmaster' ? S.fq : S.tab === 'ymaster' ? S.yq : null;
  if (q == null) return;
  let shown = 0;
  main.querySelectorAll('[data-sgroup]').forEach((grp) => {
    let n = 0;
    grp.querySelectorAll('[data-s]').forEach((el) => { const ok = matches(el.dataset.s, q); el.hidden = !ok; if (ok) n++; });
    grp.hidden = !n;
    const c = grp.querySelector('[data-scount]');
    if (c) c.textContent = n;
    shown += n;
  });
  const none = main.querySelector('#fm-none, #ym-none');
  if (none) none.hidden = shown > 0;
}
document.addEventListener('input', (e) => {
  if (e.target.id === 'fm-q') { S.fq = e.target.value; applySearch(); }
  if (e.target.id === 'ym-q') { S.yq = e.target.value; applySearch(); }
});

// Enter in a production box moves to the next loom
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key !== 'Enter' || !t.dataset || !t.dataset.pr) return;
  e.preventDefault();
  const all = [...main.querySelectorAll('input[data-pr]')];
  const nx = all[all.indexOf(t) + 1];
  if (nx) nx.focus(); else t.blur();
});

// ---------- settings ----------
function openSettings() {
  const smp = PTABS.reduce((t, k) => t + (S.tabs[k] || []).filter((r) => String(r.id).startsWith('smp_')).length, 0);
  const body = `${sheetHead('Settings')}
  <label class="field"><span>Planner key</span><input type="password" name="key" autocomplete="off" value="${esc(conf.key)}" placeholder="Paste the key from Apps Script"></label>
  <label class="field"><span>Apps Script URL</span><input type="url" name="url" value="${esc(conf.url)}"></label>
  <p class="small">${conf.user ? `Signed in as <b>${esc(conf.user)}</b>. Edits are saved under this name.` : 'The key is kept on this phone only.'}${S.loadedAt ? ` Last loaded ${new Date(S.loadedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.` : ''}</p>
  <label class="field"><span>Warping lead time, days</span><input type="number" name="lead" inputmode="numeric" min="0" step="1" value="${lead()}"></label>
  <p class="small">Warp yarn for a new beam is needed this many days before the changeover. For TPM warp the latest doff is one more day earlier.</p>
  <p class="err"></p>
  <div class="btns"><button class="btn" value="save">Save and reload</button></div>
  <div class="card tight"><b>Sample data</b><p class="small">${smp ? `${smp} sample rows are in the Planner tabs.` : 'No sample rows.'}</p>
  <div class="btns">${smp ? '<button class="btn danger small" value="clear-sample" formnovalidate>Clear sample data</button>' : rows('PlannerLooms').length ? '' : '<button class="btn quiet small" value="load-sample" formnovalidate>Load sample data</button>'}</div></div>`;
  openSheet(body, (f, act) => {
    if (act === 'clear-sample') { setTimeout(clearSample, 0); return; }
    if (act === 'load-sample') { setTimeout(loadSample, 0); return; }
    const url = (f.url || '').trim() || DEFAULT_URL;
    if (!/^https:\/\/script\.google\.com\//.test(url)) return 'The URL should start with https://script.google.com/';
    const keyChanged = (f.key || '').trim() !== conf.key || url !== conf.url;
    conf.key = (f.key || '').trim();
    conf.url = url;
    const ld = C.num(f.lead);
    if (ld != null && ld >= 0 && ld !== lead() && S.M) commit([{ tab: 'PlannerSettings', row: { id: 'set_lead_days', key: 'lead_days', value: String(Math.round(ld)) }, summary: `Warping lead time ${Math.round(ld)} days` }]);
    if (keyChanged || !S.loadedAt) reloadAll(); else syncDot();
  });
}
function loadSample() {
  if (rows('PlannerLooms').length) { toast('Looms are already entered. Clear them before loading sample data.', true); return; }
  if (!S.M.fabricList.length) { toast('Load the sheet first (enter your key).', true); return; }
  if (!confirm('Load sample looms, beam stock, yarn stock, receipts and TFO sides into the sheet?')) return;
  const smp = makeSample(S.M, S.date);
  const ch = [];
  Object.entries(smp).forEach(([tab, list]) => list.forEach((row) => ch.push({ tab, row, summary: 'sample data' })));
  commit(ch);
  toast('Sample data added.');
}
function clearSample() {
  const ch = [];
  PTABS.forEach((tab) => (S.tabs[tab] || []).filter((r) => String(r.id).startsWith('smp_')).forEach((r) => ch.push({ tab, op: 'delete', row: r, summary: 'sample data' })));
  if (!ch.length) return;
  if (!confirm(`Delete ${ch.length} sample rows from the sheet? This cannot be undone.`)) return;
  commit(ch);
  toast('Sample data cleared.');
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  switch (a) {
    case 'tab': go(b.dataset.v); return;
    case 'pick': startPick(b); return;
    case 'pd-step': { const cur = S.prodDate && S.prodDate <= S.date ? S.prodDate : C.addDays(S.date, -1); const nx = C.addDays(cur, +b.dataset.v); S.prodDate = nx > S.date ? S.date : nx; render(); return; }
    case 'fab-looms': fabLoomsSheet(b.dataset.f, +b.dataset.p); return;
    case 'fm-open': fabricDetail(id); return;
    case 'win': commit([{ tab: 'PlannerSettings', row: { id: 'set_window', key: 'window', value: b.dataset.v }, summary: `Plan window ${b.dataset.v} days` }]); return;
    case 'tpm': S.tpmOnly = b.dataset.v === '1'; render(); return;
    case 'settings': openSettings(); return;
    case 'loom-add': loomSheet(null); return;
    case 'loom-edit': loomSheet(id); return;
    case 'sample-load': loadSample(); return;
    case 'ro-clear': { const r = rows('PlannerLooms').find((x) => x.id === id); commit([{ tab: 'PlannerLooms', row: { ...r, runout_override: '' }, summary: `Loom ${r.loom_no} run-out back to calculated` }]); return; }
    case 'restart': restartSheet(id, b.dataset.co, b.dataset.from); return;
    case 'bs-add': beamStockSheet(); return;
    case 'bs-del': { const r = rows('PlannerBeamStock').find((x) => x.id === id); const used = S.P.lots['lot:' + id]; if (used && used.used.length && !confirm(`Loom ${used.used.map((u) => u.loom).join(', ')} take beams from this lot. Remove it anyway?`)) return; commit([{ tab: 'PlannerBeamStock', op: 'delete', row: r, summary: `Beam stock ${fl(r.fabric_id)}` }]); return; }
    case 'ys-pick': S.ysDate = b.dataset.v; render(); return;
    case 'rc-add': receiptSheet(null); return;
    case 'rc-edit': receiptSheet(id); return;
    case 'rc-del': { const r = rows('PlannerReceipts').find((x) => x.id === id); if (!confirm('Remove this receipt?')) return; commit([{ tab: 'PlannerReceipts', op: 'delete', row: r, summary: `Receipt ${r.kind} ${r.start_date}` }]); return; }
    case 'sides-setup': {
      const have = new Set(rows('PlannerTfoSides').map((r) => `${C.num(r.machine_no)}${r.side}`));
      const ch = [];
      S.M.typeList.forEach((t) => { for (let m = t.from; m <= t.to; m++) ['A', 'B'].forEach((sd2) => { if (!have.has(`${m}${sd2}`)) ch.push({ tab: 'PlannerTfoSides', row: { id: newId('tf'), machine_no: String(m), side: sd2, tfo_type_id: t.id, yarn_id: '', loaded_at: '', next_yarn_id: '' }, summary: `TFO M/C ${m} side ${sd2} added` }); }); });
      commit(ch); return;
    }
    case 'doffed': {
      const s = S.P.sides.find((x) => x.row.id === id);
      const e0 = s && s.ev[0];
      if (!e0) return;
      const y = s.row.next_yarn_id || s.row.yarn_id;
      commit([{ tab: 'PlannerTfoSides', row: { ...s.row, yarn_id: y, loaded_at: tStr(e0.t) }, summary: `TFO ${s.no}${s.side} doffed, reloaded with ${yn(y)}` }]);
      return;
    }
    default:
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.closest('#sheet')) return;
  const d = t.dataset;
  if (t.id === 'plan-date') { if (t.value) { S.date = t.value; refresh(); } return; }
  if (t.id === 'ys-date') { S.ysDate = t.value || S.date; render(); return; }
  if (t.id === 'prod-date') { if (t.value) { S.prodDate = t.value > S.date ? S.date : t.value; render(); } return; }
  if (d.rpm) {
    const f = S.M.fabrics[d.rpm], field = +d.panna >= 2 ? 'loom_rpm_dp' : 'loom_rpm';
    const v = C.num(t.value);
    if (t.value !== '' && !(v > 0)) { toast('Enter an RPM above zero.', true); render(); return; }
    const src = (S.tabs.Fabrics || []).find((r) => r.id === d.rpm);
    commit([{ tab: 'Fabrics', row: { ...(src || { id: d.rpm }), id: d.rpm, [field]: t.value === '' ? '' : String(Math.round(v)) }, summary: `Loom RPM ${f.label} ${+d.panna >= 2 ? 'double' : 'single'} panna ${t.value || 'cleared'}` }].map((c) => ({ ...c, row: { id: c.row.id, [field]: c.row[field] } })));
    return;
  }
  if (d.ro) {
    const r = rows('PlannerLooms').find((x) => x.id === d.ro);
    const o = S.P.looms.find((x) => x.row.id === d.ro);
    const v = t.value && o && o.runCalc != null && C.dayNum(t.value) === o.runCalc ? '' : t.value;
    commit([{ tab: 'PlannerLooms', row: { ...r, runout_override: v }, summary: `Loom ${r.loom_no} run-out ${v || 'calculated'}` }]);
    return;
  }
  if (d.nx) {
    const o = S.P.looms.find((x) => x.row.id === d.nx);
    const i = +d.i, ev = o.events[i] || null, day = +d.day;
    if (!t.value) { if (ev) commit([{ tab: 'PlannerChangeovers', op: 'delete', row: ev.co, summary: `Loom ${o.no} changeover cleared` }]); return; }
    const base = ev ? { ...ev.co } : { id: newId('co'), loom_no: String(o.no), notes: '' };
    let row;
    if (t.value === 'none') row = { ...base, date: C.dayStr(day), to_fabric_id: '', beam: 'none', beam_length_m: '' };
    else {
      const keep = ev && ev.to && ev.to.id === t.value && ev.co.beam && ev.co.beam !== 'none' ? ev.co.beam : null;
      const g = o.g;
      const lot = Object.values(S.P.lots).find((l) => l.fabric_id === t.value && S.M.groups[l.group_id] && g && S.M.groups[l.group_id].width === g.width && lotLeft(l) > 0 && (l.arrive == null || l.arrive <= day));
      row = { ...base, date: C.dayStr(day), to_fabric_id: t.value, beam: keep || (lot ? lot.key : 'new'), beam_length_m: keep ? base.beam_length_m || '' : '' };
    }
    commit([{ tab: 'PlannerChangeovers', row, summary: `Loom ${o.no} → ${row.beam === 'none' ? 'no beam (idle)' : fl(row.to_fabric_id)} on ${row.date}` }]);
    return;
  }
  if (d.bm) {
    const c = rows('PlannerChangeovers').find((x) => x.id === d.bm);
    commit([{ tab: 'PlannerChangeovers', row: { ...c, beam: t.value, beam_length_m: '' }, summary: `Loom ${c.loom_no} beam ${t.value === 'new' ? 'new beam' : 'from stock'}` }]);
    return;
  }
  if (d.ln) {
    const c = rows('PlannerChangeovers').find((x) => x.id === d.ln);
    commit([{ tab: 'PlannerChangeovers', row: { ...c, beam_length_m: t.value }, summary: `Loom ${c.loom_no} beam length ${t.value || 'default'}` }]);
    return;
  }
  if (d.bs) {
    const r = rows('PlannerBeamStock').find((x) => x.id === d.bs);
    commit([{ tab: 'PlannerBeamStock', row: { ...r, [d.f]: t.value }, summary: `Beam stock ${fl(r.fabric_id)} ${d.f === 'beams' ? 'beams' : 'length'} ${t.value}` }]);
    return;
  }
  if (d.ys) {
    const date = S.ysDate && S.ysDate <= S.date ? S.ysDate : S.date;
    const r = rows('PlannerYarnStock').find((x) => x.date === date && x.yarn_id === d.ys);
    if (t.value === '') { if (r) commit([{ tab: 'PlannerYarnStock', op: 'delete', row: r, summary: `${yn(d.ys)} stock ${date} removed` }]); return; }
    const v = C.num(t.value);
    if (v == null || v < 0) { toast('Enter kg, zero or more.', true); render(); return; }
    commit([{ tab: 'PlannerYarnStock', row: { ...(r || { id: `ys_${date}_${d.ys}` }), date, yarn_id: d.ys, kg: String(v) }, summary: `${yn(d.ys)} ${v} kg on ${date}` }]);
    return;
  }
  if (d.tt) {
    const v = C.num(t.value);
    if (t.value !== '' && !(v > 0)) { toast('Enter a number above zero.', true); render(); return; }
    if (d.f === 'efficiency' && v > 100) { toast('Efficiency is a percentage, up to 100.', true); render(); return; }
    const tt = S.M.tfoTypes[d.tt];
    commit([{ tab: 'TfoTypes', row: { id: d.tt, [d.f]: t.value === '' ? '' : String(v) }, summary: `${tt.name} ${d.f.replace(/_/g, ' ')} ${t.value || 'cleared'}` }]);
    return;
  }
  if (d.tl) saveSide(d.tl, 'loaded_at', t.value);
  if (d.pr) {
    const date = S.prodDate && S.prodDate <= S.date ? S.prodDate : C.addDays(S.date, -1);
    const no = C.num(d.pr);
    const r = rows('PlannerProduction').find((x) => x.date === date && C.num(x.loom_no) === no);
    if (t.value === '') { if (r) commit([{ tab: 'PlannerProduction', op: 'delete', row: r, summary: `Loom ${no} production ${date} removed` }]); return; }
    const v = C.num(t.value);
    if (v == null || v < 0) { toast('Enter metres, zero or more.', true); render(); return; }
    commit([{ tab: 'PlannerProduction', row: { ...(r || { id: newId('pr'), notes: '' }), date, loom_no: String(no), metres: String(v) }, summary: `Loom ${no} ${v} m on ${date}` }]);
  }
});

function saveSide(id, field, value) {
  const r = rows('PlannerTfoSides').find((x) => x.id === id);
  if (!r || (r[field] || '') === (value || '')) return;
  const row = { ...r, [field]: value };
  if (field === 'yarn_id' && value && !r.loaded_at) row.loaded_at = S.date + 'T08:00';
  commit([{ tab: 'PlannerTfoSides', row, summary: `TFO ${r.machine_no}${r.side} ${field === 'yarn_id' ? 'running ' + yn(value) : field === 'loaded_at' ? 'loaded ' + value.replace('T', ' ') : 'next ' + (value ? yn(value) : 'nothing')}` }]);
}

function go(k) {
  S.tab = k;
  try { history.replaceState(null, '', '#' + S.tab); } catch (err) { /* ignore */ }
  render(); window.scrollTo(0, 0);
}

// Keyboard: Esc closes the picker, then a dialog; 1-9 and 0 jump to the first ten screens when no field has focus.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pickerOpen()) { e.preventDefault(); closePicker(); return; }
  if (e.key === 'Escape' && sheet.open) { e.preventDefault(); closeSheet(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || sheet.open || pickerOpen()) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
  if (!/^[0-9]$/.test(e.key)) return;
  const sc = SCREENS[e.key === '0' ? 9 : +e.key - 1];
  if (sc) { e.preventDefault(); go(sc[0]); }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && conf.key && !S.pending && !queue.length && Date.now() - S.loadedAt > 120000) reloadAll();
});

// ---------- start ----------
(function start() {
  const h = location.hash.slice(1);
  if (SCREENS.some(([k]) => k === h)) S.tab = h;
  const c = readCache();
  if (c) { S.tabs = c.tabs; S.cached = true; }
  recompute();
  if (!h && !rows('PlannerLooms').length) S.tab = 'looms';
  render();
  if (conf.key) reloadAll(); else openSettings();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// for checks in the browser console
window.__tfo = { S, C };
