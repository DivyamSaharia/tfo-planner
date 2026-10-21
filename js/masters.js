// Fabric and yarn master editing: the rows the planner writes to the shared master tabs.
// Pure functions, no DOM: run in the browser and in node tests.
// Rules copied from the Fabric Database app (repo fabric-master, branch source: src/store.js saveFabric,
// duplicateForRs, saveYarn, saveSpeed; src/planner.js beamSlots), so both apps keep the same masters:
// - ids: prefix + Date.now base 36 + 4 random chars (f_, l_, a_, fb_, y_, sp_)
// - fabric names stored without the RS (shown as name + RS rounded), first letter of each word capitalised
// - FabricYarns: warp lines carry ends, weft lines parts (pick share) and pattern; sort = 1, 2, 3 in order
// - beam length slots: one per make + reed width; a dobby fabric sees dobby groups only; any other fabric
//   shares one field per width and the value is saved to the plain and the dobby group of that width
// - the server stamps updated_at / updated_by (and created_at / created_by on new Fabrics rows)
// No money: the planner never writes price, rates, VATAV, finish, processing, brokering or TPM delta.

export const UNIT_ID = 'u_mvdwlskosl2i';

// Columns the planner may write, per tab. The Apps Script holds the same list and refuses anything else.
export const WRITABLE = {
  Fabrics: ['name', 'weave', 'design_note', 'end_use', 'reed', 'ppi', 'reed_space_in', 'greige_width_in', 'warp_shortage_pct', 'weft_shortage_pct', 'loom_rpm', 'loom_rpm_dp'],
  FabricYarns: ['fabric_id', 'side', 'yarn_id', 'ends', 'parts', 'pattern', 'sort'],
  FabricBeams: ['fabric_id', 'loom_group_id', 'beam_length_m'],
  Assignments: ['fabric_id', 'unit_id'],
  Yarns: ['name', 'kind', 'base_yarn_id', 'material', 'form', 'count', 'count_unit', 'filaments', 'lustre', 'tpm', 'twist', 'notes'],
  TfoSpeeds: ['unit_id', 'tfo_type_id', 'yarn_id', 'rpm'],
  TfoTypes: ['efficiency', 'doff_g_per_spindle', 'spindles_per_side']
};
// Money columns in the master: never shown, never written by the planner.
export const MONEY = ['price', 'vatav_pct', 'finish', 'rfd_shortage_pct', 'processing_charge', 'brokering_pct', 'tpm_delta', 'rate', 'cost_per_pick'];

export const WEAVES = ['Plain', 'Cam', 'Dobby'];
// stored weave as the Fabric Database app writes it: Plain, Cam or Dobby
export const weaveOf = (v) => WEAVES.find((w) => w.toLowerCase() === String(v || '').trim().toLowerCase()) || 'Plain';

export const num = (v) => {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
export const newId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const T = (tabs, n) => (tabs && tabs[n]) || [];
const s = (v) => (v == null ? '' : String(v).trim());
const pick = (row, cols) => Object.fromEntries(cols.filter((c) => row[c] !== undefined).map((c) => [c, row[c] == null ? '' : String(row[c])]));

// First letter of each word capitalised, the rest lower case ("natural CRAPE" -> "Natural Crape").
export const titleCase = (v) => s(v).replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s\-(/])([a-z])/g, (m, a, b) => a + b.toUpperCase());

// Drops a trailing RS from a name ("Natural Crape 53" with RS 52.5 -> "Natural Crape"), as the Fabric Database app does.
export function stripRs(name, rs) {
  const n = s(name);
  const r = num(rs);
  if (r === null) return n;
  const m = n.match(/^(.*?)\s*-?\s*(\d+(?:\.\d+)?)$/);
  return m && m[1] && (m[2] === String(Math.round(r)) || Number(m[2]) === Math.round(r)) ? m[1].trim() : n;
}
// Name + RS rounded; a name already ending in its RS is not doubled; " (copy)" stays at the end.
export function fabricLabel(f) {
  const name = s(f && f.name);
  const rs = num(f && f.reed_space_in);
  if (rs === null) return name;
  const m = name.match(/^(.*?)((?: \(copy\))*)$/);
  return stripRs(m[1], rs) !== m[1].trim() ? name : `${m[1]} ${Math.round(rs)}${m[2]}`.trim();
}

// ---------- beam length slots (Weavelon 2 only) ----------

// [{ key, label, groupIds, width }]; dobby fabric: dobby groups only; others: one slot per make + width
export function beamSlots(weave, tabs, unitId = UNIT_ID) {
  const dobbyOnly = /^dobby$/i.test(s(weave));
  const slots = [];
  T(tabs, 'LoomGroups').filter((g) => g.unit_id === unitId).forEach((g) => {
    if (dobbyOnly && !/^dobby$/i.test(s(g.shedding))) return;
    const width = num(g.reed_width_cm);
    const key = `${s(g.make).toLowerCase()}|${width ?? ''}`;
    let slot = slots.find((x) => x.key === key);
    if (!slot) slots.push((slot = { key, width, label: [s(g.make), width ? `${width} cm` : ''].filter(Boolean).join(' · ') || 'Loom group', groupIds: [], sheds: [] }));
    slot.groupIds.push(g.id);
    slot.sheds.push(/^dobby$/i.test(s(g.shedding)) ? 'dobby' : 'plain');
  });
  return slots.sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
}

// beam length per loom group of a saved fabric: { groupId: metres }
export function beamsOf(tabs, fabricId) {
  const m = {};
  T(tabs, 'FabricBeams').filter((b) => b.fabric_id === fabricId && num(b.beam_length_m) !== null).forEach((b) => { m[b.loom_group_id] = num(b.beam_length_m); });
  return m;
}
// the value shown in a slot: the first of its groups that has a length
export const slotValue = (slot, beams) => {
  const g = slot.groupIds.find((x) => beams[x] !== undefined && beams[x] !== '' && beams[x] !== null);
  return g ? beams[g] : '';
};

// ---------- editor state ----------

// What the fabric editor starts from. Shortage defaults to 10% for a new fabric (his convention).
export function fabricDraft(tabs, fabricId) {
  const f = fabricId ? T(tabs, 'Fabrics').find((x) => x.id === fabricId) : null;
  if (!f) {
    return { id: '', name: '', weave: 'Plain', design_note: '', end_use: '', reed: '', ppi: '', reed_space_in: '', greige_width_in: '', warp_shortage_pct: '10', weft_shortage_pct: '10', loom_rpm: '', loom_rpm_dp: '',
      lines: [{ id: '', side: 'warp', yarn_id: '', ends: '' }, { id: '', side: 'weft', yarn_id: '', parts: '1', pattern: '' }], beams: {} };
  }
  const d = { id: f.id };
  WRITABLE.Fabrics.forEach((c) => { d[c] = f[c] == null ? '' : String(f[c]); });
  d.weave = weaveOf(f.weave);
  d.lines = T(tabs, 'FabricYarns').filter((l) => l.fabric_id === f.id).sort((a, b) => (num(a.sort) ?? 0) - (num(b.sort) ?? 0))
    .map((l) => ({ id: l.id, side: l.side === 'weft' ? 'weft' : 'warp', yarn_id: l.yarn_id || '', ends: s(l.ends), parts: s(l.parts), pattern: s(l.pattern) }));
  d.beams = beamsOf(tabs, f.id);
  return d;
}

// ---------- checks ----------

const NUM_FIELDS = { ppi: 'Pick (PPI)', reed: 'Reed', reed_space_in: 'Reed space', greige_width_in: 'Greige width', warp_shortage_pct: 'Warp shortage', weft_shortage_pct: 'Weft shortage', loom_rpm: 'Loom RPM single panna', loom_rpm_dp: 'Loom RPM double panna' };

// Errors that stop a save. Only the name is required, as in the Fabric Database app; numbers must be numbers.
export function fabricErrors(d) {
  if (!s(d.name)) return 'Add a quality name first.';
  for (const [k, label] of Object.entries(NUM_FIELDS)) {
    if (s(d[k]) !== '' && (num(d[k]) === null || num(d[k]) < 0)) return `${label} must be a number.`;
  }
  for (const l of d.lines || []) {
    if (!l.yarn_id) continue;
    if (l.side === 'warp' && s(l.ends) !== '' && (num(l.ends) === null || num(l.ends) < 0)) return 'Warp ends must be a number.';
    if (l.side === 'weft' && s(l.parts) !== '' && (num(l.parts) === null || num(l.parts) < 0)) return 'Weft pick share must be a number.';
  }
  for (const v of Object.values(d.beams || {})) if (s(v) !== '' && (num(v) === null || num(v) <= 0)) return 'Beam length must be metres above zero.';
  return '';
}

// Another fabric (any unit) with the same name, RS and weave. Returns its label or ''.
export function duplicateFabric(tabs, d) {
  const name = stripRs(titleCase(d.name), d.reed_space_in).toLowerCase();
  const rs = num(d.reed_space_in);
  const weave = weaveOf(d.weave);
  const hit = T(tabs, 'Fabrics').find((f) => f.id !== d.id && stripRs(f.name, f.reed_space_in).toLowerCase() === name && num(f.reed_space_in) === rs && weaveOf(f.weave) === weave);
  return hit ? `${fabricLabel(hit)} (${weaveOf(hit.weave)})` : '';
}

export function duplicateYarn(tabs, name, exceptId) {
  const n = s(name).replace(/\s+/g, ' ').toLowerCase();
  const hit = T(tabs, 'Yarns').find((y) => y.id !== exceptId && s(y.name).replace(/\s+/g, ' ').toLowerCase() === n);
  return hit ? s(hit.name) : '';
}

// ---------- fabric save ----------

// Changes for a fabric save: [{ tab, op, row, summary }]. New fabric: Fabrics + FabricYarns + FabricBeams
// + an Assignments row for Weavelon 2. Lines left out are deleted; beam lengths are only touched on
// Weavelon 2 loom groups (other units' beams stay as they are).
export function fabricChanges(tabs, d, { unitId = UNIT_ID, extraUnits = [] } = {}) {
  const isNew = !d.id;
  const id = d.id || newId('f');
  const name = stripRs(titleCase(d.name), d.reed_space_in);
  const weave = weaveOf(d.weave);
  const frow = { id, ...pick({ ...d, name, weave }, WRITABLE.Fabrics) };
  WRITABLE.Fabrics.forEach((c) => { if (frow[c] === undefined) frow[c] = ''; else frow[c] = s(frow[c]); });
  const label = fabricLabel({ name, reed_space_in: d.reed_space_in });
  const ch = [{ tab: 'Fabrics', op: 'upsert', row: frow, summary: `${isNew ? 'Added' : 'Edited'} fabric ${label}` }];

  // yarn lines: only lines with a yarn, numbered 1, 2, 3 in order
  const keep = (d.lines || []).filter((l) => l.yarn_id).map((l, i) => {
    const row = { id: l.id || newId('l'), fabric_id: id, side: l.side === 'weft' ? 'weft' : 'warp', yarn_id: l.yarn_id, ends: '', parts: '', pattern: '', sort: String(i + 1) };
    if (row.side === 'warp') row.ends = s(l.ends);
    else { row.parts = s(l.parts); row.pattern = s(l.pattern); }
    return row;
  });
  const keepIds = new Set(keep.map((l) => l.id));
  keep.forEach((row) => ch.push({ tab: 'FabricYarns', op: 'upsert', row, summary: `${label} ${row.side} line` }));
  if (!isNew) T(tabs, 'FabricYarns').filter((l) => l.fabric_id === id && !keepIds.has(l.id)).forEach((l) => ch.push({ tab: 'FabricYarns', op: 'delete', row: { id: l.id }, summary: `${label} ${l.side} line removed` }));

  // Weavelon 2 assignment (and, for a copy, the source fabric's other units)
  const have = new Set(T(tabs, 'Assignments').filter((a) => a.fabric_id === id).map((a) => a.unit_id));
  [unitId, ...extraUnits].filter((u, i, a) => u && a.indexOf(u) === i && !have.has(u)).forEach((u) => ch.push({ tab: 'Assignments', op: 'upsert', row: { id: newId('a'), fabric_id: id, unit_id: u }, summary: `${label} added to unit` }));

  // beam lengths on this unit's loom groups, one value per slot saved to every group in it
  const slots = beamSlots(weave, tabs, unitId);
  const unitGroups = new Set(T(tabs, 'LoomGroups').filter((g) => g.unit_id === unitId).map((g) => g.id));
  const old = T(tabs, 'FabricBeams').filter((b) => b.fabric_id === id && unitGroups.has(b.loom_group_id));
  const beams = d.beams || {};
  const want = [];
  slots.forEach((slot) => {
    const v = num(slotValue(slot, beams));
    if (v === null) return;
    slot.groupIds.forEach((g) => want.push({ g, v }));
  });
  const keepB = new Set();
  want.forEach(({ g, v }) => {
    const o = old.find((b) => b.loom_group_id === g);
    const row = { id: o ? o.id : newId('fb'), fabric_id: id, loom_group_id: g, beam_length_m: String(v) };
    keepB.add(row.id);
    if (!o || num(o.beam_length_m) !== v) ch.push({ tab: 'FabricBeams', op: 'upsert', row, summary: `${label} beam length ${v} m` });
  });
  old.filter((b) => !keepB.has(b.id)).forEach((b) => ch.push({ tab: 'FabricBeams', op: 'delete', row: { id: b.id }, summary: `${label} beam length removed` }));
  // beams of a copy on other units' groups
  (d.otherBeams || []).forEach((b) => ch.push({ tab: 'FabricBeams', op: 'upsert', row: { id: newId('fb'), fabric_id: id, loom_group_id: b.loom_group_id, beam_length_m: String(b.beam_length_m) }, summary: `${label} beam length ${b.beam_length_m} m` }));
  return { id, label, changes: ch };
}

// "Duplicate for new RS": warp ends and greige width scale with RS, everything else is copied
// (money columns stay blank; they are filled in the Fabric Database app). Name as the Fabric Database app:
// the stored name without its RS, or "<name> (copy)" if that name + new RS already exists.
export function rsCopy(tabs, fabricId, newRs, unitId = UNIT_ID) {
  const src = fabricDraft(tabs, fabricId);
  const oldRs = num(src.reed_space_in);
  const rs = num(newRs);
  if (!oldRs || !rs || rs <= 0) return null;
  const k = rs / oldRs;
  const base = stripRs(src.name, oldRs);
  const shown = fabricLabel({ name: base, reed_space_in: rs }).toLowerCase();
  const taken = T(tabs, 'Fabrics').some((f) => fabricLabel(f).toLowerCase() === shown || s(f.name).toLowerCase() === shown);
  const width = num(src.greige_width_in);
  const unitGroups = new Set(T(tabs, 'LoomGroups').filter((g) => g.unit_id === unitId).map((g) => g.id));
  const d = {
    ...src, id: '', name: taken ? `${base} (copy)` : base, reed_space_in: String(rs),
    greige_width_in: width === null ? src.greige_width_in : String(Math.round(width * k * 100) / 100),
    lines: src.lines.map((l) => ({ ...l, id: '', ends: l.side === 'warp' && num(l.ends) !== null ? String(Math.round(num(l.ends) * k)) : l.ends })),
    otherBeams: T(tabs, 'FabricBeams').filter((b) => b.fabric_id === fabricId && !unitGroups.has(b.loom_group_id) && num(b.beam_length_m) !== null)
  };
  const extraUnits = T(tabs, 'Assignments').filter((a) => a.fabric_id === fabricId).map((a) => a.unit_id);
  const warp = src.lines.filter((l) => l.side === 'warp').map((l, i) => ({ yarn_id: l.yarn_id, from: num(l.ends), to: num(d.lines.filter((x) => x.side === 'warp')[i].ends) }));
  return { draft: d, extraUnits, oldRs, newRs: rs, warp, label: fabricLabel({ name: d.name, reed_space_in: rs }) };
}

// ---------- yarn save ----------

export function yarnDraft(tabs, yarnId, kind = 'base') {
  const y = yarnId ? T(tabs, 'Yarns').find((x) => x.id === yarnId) : null;
  const d = { id: y ? y.id : '' };
  WRITABLE.Yarns.forEach((c) => { d[c] = y && y[c] != null ? String(y[c]) : ''; });
  if (!y) { d.kind = kind === 'tpm' ? 'tpm' : 'base'; d.count_unit = 'D'; d.twist = 'S/Z'; }
  d.kind = String(d.kind).toLowerCase() === 'tpm' ? 'tpm' : 'base';
  d.count_unit = d.count_unit || 'D';
  d.speeds = {};
  if (y) T(tabs, 'TfoSpeeds').filter((sp) => sp.yarn_id === y.id).forEach((sp) => { d.speeds[sp.tfo_type_id] = s(sp.rpm); });
  return d;
}

export function yarnErrors(tabs, d, unitId = UNIT_ID) {
  if (!s(d.name)) return 'Add a name first.';
  if (d.kind === 'tpm' && !d.base_yarn_id) return 'Choose the base yarn.';
  for (const [k, label] of [['count', 'Count'], ['tpm', 'TPM'], ['filaments', 'Filaments']]) {
    if (s(d[k]) !== '' && (num(d[k]) === null || num(d[k]) <= 0)) return `${label} must be a number above zero.`;
  }
  if (d.kind === 'tpm') {
    for (const [tt, v] of Object.entries(d.speeds || {})) {
      if (s(v) !== '' && !(num(v) > 0)) return 'TFO RPM must be a number above zero.';
      const had = T(tabs, 'TfoSpeeds').some((sp) => sp.yarn_id === d.id && sp.tfo_type_id === tt && sp.unit_id === unitId && num(sp.rpm) !== null);
      if (s(v) === '' && had) return 'A TFO speed cannot be removed here. Remove it in the Fabric Database app.';
    }
  }
  return '';
}

// Changes for a yarn save: the Yarns row and, for a TPM yarn, one TfoSpeeds row per Weavelon 2 TFO type
// with an RPM (already x2, stored as entered). A base yarn clears base yarn, TPM and twist, as in the Fabric Database app.
export function yarnChanges(tabs, d, unitId = UNIT_ID) {
  const isNew = !d.id;
  const id = d.id || newId('y');
  const tpm = d.kind === 'tpm';
  const row = { id };
  WRITABLE.Yarns.forEach((c) => { row[c] = s(d[c]); });
  row.name = s(d.name).replace(/\s+/g, ' ');
  row.kind = tpm ? 'tpm' : 'base';
  row.count_unit = row.count_unit || 'D';
  if (!tpm) { row.base_yarn_id = ''; row.tpm = ''; row.twist = ''; }
  const ch = [{ tab: 'Yarns', op: 'upsert', row, summary: `${isNew ? 'Added' : 'Edited'} yarn ${row.name}` }];
  if (tpm) {
    Object.entries(d.speeds || {}).forEach(([tt, v]) => {
      const rpm = num(v);
      if (rpm === null) return;
      const old = T(tabs, 'TfoSpeeds').find((sp) => sp.yarn_id === id && sp.tfo_type_id === tt && sp.unit_id === unitId);
      if (old && num(old.rpm) === rpm) return;
      ch.push({ tab: 'TfoSpeeds', op: 'upsert', row: { id: old ? old.id : newId('sp'), unit_id: unitId, tfo_type_id: tt, yarn_id: id, rpm: String(rpm) }, summary: `${row.name} TFO RPM ${rpm}` });
    });
  }
  return { id, changes: ch };
}

// ---------- access ----------
// The setup message the owner sends on WhatsApp when giving someone a key (as the Fabric Database app does).
export const APP_URL = 'https://divyamsaharia.github.io/tfo-planner/';
export function inviteText(person, url, appUrl = APP_URL) {
  return [
    `Hanuman TFO Planner: access for ${person.name}`,
    '',
    '1. Open this link in Safari on iPhone, or Chrome on a laptop:',
    appUrl,
    '2. On iPhone: Share, then Add to Home Screen, and open the app from the icon.',
    '3. Settings opens by itself (or tap the gear). Paste this into Planner key:',
    '',
    person.key,
    '',
    '4. Check Apps Script URL is this one, then tap Save and reload:',
    url,
    '',
    'Your edits are saved under your name. Keep this key to yourself.'
  ].join('\n');
}
export const whatsappLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
