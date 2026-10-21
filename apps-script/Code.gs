// TFO Planner API: a standalone Apps Script web app on the Fabric Master DB sheet.
// Reads the master tabs, reads and writes the Planner tabs, and adds or changes master rows
// (fabrics, their yarn lines, beam lengths and units; yarns; TFO speeds; TFO type settings)
// through an explicit list of writable columns per tab. No money column is writable.
// Whole fabrics, yarns, speeds and unit links are never deleted here (only in the Fabric Database app);
// removing a yarn line from a fabric or clearing a beam length is part of editing that fabric.
// Master writes are stamped and logged the way the Fabric Database backend does it (backend/Code.gs v8),
// so its Recent changes screen reads them.
// People: the owner (the first key made) adds, renames and removes people from the app's Settings;
// each person has their own key, so every edit carries their name.
// Looms can be switched off (PlannerLooms power_off_from, power_on_date); the column is added on first save.
// Version 3 (21 Oct 2026). Copy of the code deployed in the Apps Script project "TFO Planner API"
// (also the project doc claude/tfo-planner-apps-script.gs.txt).

const SHEET_ID = '1rKatBCfjCtTsCX3tLxGZQ8fA_BMIaghPb8OS7DPxq3M';
const NEW_KEY_NAME = 'Owner'; // change before running makeKey() to create a key for someone else

const MASTER = ['Units', 'LoomGroups', 'Fabrics', 'Assignments', 'FabricYarns', 'Yarns', 'FabricBeams', 'TfoTypes', 'TfoSpeeds'];

const PLANNER = {
  PlannerLooms: ['id', 'unit_id', 'loom_no', 'loom_group_id', 'panna', 'fabric_id', 'beam_balance_m', 'balance_date', 'runout_override', 'notes', 'updated_at', 'updated_by', 'power_off_from', 'power_on_date'],
  PlannerChangeovers: ['id', 'unit_id', 'loom_no', 'date', 'to_fabric_id', 'beam', 'beam_length_m', 'notes', 'updated_at', 'updated_by'],
  PlannerBeamStock: ['id', 'unit_id', 'fabric_id', 'loom_group_id', 'beams', 'length_m', 'notes', 'updated_at', 'updated_by'],
  PlannerYarnStock: ['id', 'unit_id', 'date', 'yarn_id', 'kg', 'updated_at', 'updated_by'],
  PlannerReceipts: ['id', 'unit_id', 'kind', 'item', 'mode', 'start_date', 'days', 'qty', 'length_m', 'source', 'notes', 'updated_at', 'updated_by'],
  PlannerTfoSides: ['id', 'unit_id', 'machine_no', 'side', 'tfo_type_id', 'yarn_id', 'loaded_at', 'next_yarn_id', 'updated_at', 'updated_by'],
  PlannerSettings: ['id', 'unit_id', 'key', 'value', 'updated_at', 'updated_by'],
  PlannerProduction: ['id', 'unit_id', 'date', 'loom_no', 'metres', 'notes', 'updated_at', 'updated_by']
};

// Master tabs the planner may write: the columns, whether new rows may be added, whether rows may be deleted.
const MASTER_RULES = {
  Fabrics: { cols: ['name', 'weave', 'design_note', 'end_use', 'reed', 'ppi', 'reed_space_in', 'greige_width_in', 'warp_shortage_pct', 'weft_shortage_pct', 'loom_rpm', 'loom_rpm_dp'], add: true, del: false },
  FabricYarns: { cols: ['fabric_id', 'side', 'yarn_id', 'ends', 'parts', 'pattern', 'sort'], add: true, del: true },
  FabricBeams: { cols: ['fabric_id', 'loom_group_id', 'beam_length_m'], add: true, del: true },
  Assignments: { cols: ['fabric_id', 'unit_id'], add: true, del: false },
  Yarns: { cols: ['name', 'kind', 'base_yarn_id', 'material', 'form', 'count', 'count_unit', 'filaments', 'lustre', 'tpm', 'twist', 'notes'], add: true, del: false },
  TfoSpeeds: { cols: ['unit_id', 'tfo_type_id', 'yarn_id', 'rpm'], add: true, del: false },
  TfoTypes: { cols: ['efficiency', 'doff_g_per_spindle', 'spindles_per_side'], add: false, del: false }
};

// ---------- run these from the editor ----------

function setup() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  Object.keys(PLANNER).forEach(function (name) {
    const head = PLANNER[name];
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange('A1:Z1000').setNumberFormat('@');
      sh.getRange(1, 1, 1, head.length).setValues([head]);
      sh.setFrozenRows(1);
    } else {
      const have = headers_(sh);
      head.filter(function (h) { return have.indexOf(h) < 0; }).forEach(function (h) {
        sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
      });
    }
  });
  const tt = ss.getSheetByName('TfoTypes');
  if (headers_(tt).indexOf('doff_g_per_spindle') < 0) tt.getRange(1, tt.getLastColumn() + 1).setValue('doff_g_per_spindle');
  Logger.log('Setup done. Planner tabs are ready.');
}

// Makes a key from the editor. The first key ever made is the owner's.
function makeKey() {
  const list = keys_();
  const k = newKey_();
  list[k] = { id: 'k_' + Utilities.getUuid().replace(/-/g, '').slice(0, 10), name: NEW_KEY_NAME, added_at: new Date().toISOString() };
  saveKeys_(list);
  owner_();
  Logger.log('Planner key for ' + NEW_KEY_NAME + ': ' + k);
}

// ---------- web app ----------

function doGet() {
  return json_({ ok: true, app: 'tfo-planner-api', version: 3 });
}

const OWNER_ONLY = { people: 1, addPerson: 1, renamePerson: 1, removePerson: 1 };

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    const who = userForKey_(req.key);
    if (!who) throw new Error('Key not recognised. Check it in Settings, or ask the owner for a new key.');
    if (OWNER_ONLY[req.action] && who.role !== 'owner') throw new Error('Only the owner can change who has access.');
    const base = { ok: true, user: who.name, role: who.role };
    if (req.action === 'load') out = Object.assign(base, { tabs: loadAll_() });
    else if (req.action === 'save') out = Object.assign(base, { saved: save_(req.changes || [], who) });
    else if (req.action === 'people') out = Object.assign(base, { people: listPeople_() });
    else if (req.action === 'addPerson') out = Object.assign(base, { person: locked_(function () { return addPerson_(req.name, who); }), people: listPeople_() });
    else if (req.action === 'renamePerson') { locked_(function () { renamePerson_(req.id, req.name, who); }); out = Object.assign(base, { people: listPeople_() }); }
    else if (req.action === 'removePerson') { locked_(function () { removePerson_(req.id, who); }); out = Object.assign(base, { people: listPeople_() }); }
    else throw new Error('Unknown action');
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return json_(out);
}

function locked_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------- people and keys ----------
// Script property KEYS: { key: { id, name, added_at } } (older keys may hold just the name).
// Script property OWNER_KEY: the owner's key; set to the first key made when missing.

function keys_() {
  let raw;
  try { raw = JSON.parse(PropertiesService.getScriptProperties().getProperty('KEYS') || '{}'); } catch (e) { raw = {}; }
  const out = {};
  Object.keys(raw).forEach(function (k, i) {
    const v = raw[k];
    out[k] = typeof v === 'string' ? { id: 'k_old' + i, name: v, added_at: '' } : v;
  });
  return out;
}

function saveKeys_(list) {
  PropertiesService.getScriptProperties().setProperty('KEYS', JSON.stringify(list));
}

function newKey_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function owner_() {
  const p = PropertiesService.getScriptProperties();
  let o = p.getProperty('OWNER_KEY');
  const list = keys_();
  if (!o || !list[o]) {
    o = Object.keys(list)[0] || '';
    if (o) p.setProperty('OWNER_KEY', o);
  }
  return o;
}

function userForKey_(key) {
  if (!key) return null;
  const list = keys_();
  const v = list[String(key)];
  if (!v) return null;
  return { id: v.id, name: v.name, role: String(key) === owner_() ? 'owner' : 'editor' };
}

function listPeople_() {
  const list = keys_(), o = owner_();
  const all = Object.keys(list).map(function (k) { return { id: list[k].id, name: list[k].name, role: k === o ? 'owner' : 'editor', key: k, added_at: list[k].added_at || '' }; });
  return all.filter(function (p) { return p.role === 'owner'; }).concat(all.filter(function (p) { return p.role !== 'owner'; }));
}

function cleanName_(name, exceptId) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n) throw new Error('Enter a name');
  if (n.length > 40) throw new Error('Keep the name under 40 characters');
  const taken = listPeople_().some(function (p) { return p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase(); });
  if (taken) throw new Error(n + ' is already on the list');
  return n;
}

function keyOfId_(list, id) {
  return Object.keys(list).filter(function (k) { return list[k].id === id; })[0] || '';
}

function addPerson_(name, who) {
  const n = cleanName_(name);
  const list = keys_();
  owner_();
  const k = newKey_();
  list[k] = { id: 'k_' + Utilities.getUuid().replace(/-/g, '').slice(0, 10), name: n, added_at: new Date().toISOString() };
  saveKeys_(list);
  log_([[stamp_(), who.name, 'gave access', 'Access', n, 'TFO Planner', '']]);
  return { id: list[k].id, name: n, role: 'editor', key: k, added_at: list[k].added_at };
}

function renamePerson_(id, name, who) {
  const n = cleanName_(name, id);
  const list = keys_();
  const k = keyOfId_(list, id);
  if (!k) throw new Error('That person is not on the list');
  const old = list[k].name;
  list[k].name = n;
  saveKeys_(list);
  if (old !== n) log_([[stamp_(), id === who.id ? n : who.name, 'renamed', 'Access', n, 'TFO Planner, was ' + old, '']]);
}

function removePerson_(id, who) {
  const list = keys_();
  const k = keyOfId_(list, id);
  if (!k) throw new Error('That person is not on the list');
  if (k === owner_()) throw new Error("The owner's key can't be removed");
  const name = list[k].name;
  delete list[k];
  saveKeys_(list);
  log_([[stamp_(), who.name, 'removed access', 'Access', name, 'TFO Planner', '']]);
}

// ---------- reading ----------

function ss_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function loadAll_() {
  const ss = ss_(), tz = ss.getSpreadsheetTimeZone(), tabs = {};
  MASTER.concat(Object.keys(PLANNER)).forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 1) { tabs[name] = []; return; }
    const v = sh.getDataRange().getValues(), h = v[0].map(String);
    tabs[name] = v.slice(1)
      .filter(function (r) { return r.some(function (c) { return c !== '' && c !== null; }); })
      .map(function (r) {
        const o = {};
        h.forEach(function (k, i) { if (k) o[k] = cell_(r[i], tz); });
        return o;
      });
  });
  return tabs;
}

// ---------- saving ----------

let REQ_ = null; // { user, events, names, gone } for the master change log of one request

function save_(changes, who) {
  return locked_(function () {
    const ss = ss_(), tz = ss.getSpreadsheetTimeZone();
    const now = new Date().toISOString(), when = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
    const cache = {}, log = [];
    REQ_ = { user: who, events: [], names: {}, gone: {}, ss: ss, tz: tz };
    const tab = function (name) {
      if (cache[name]) return cache[name];
      const sh = ss.getSheetByName(name);
      if (!sh) throw new Error('Missing tab ' + name + (PLANNER[name] ? '. Run setup.' : ''));
      let v = sh.getDataRange().getValues();
      // a Planner tab gets any column added since it was made (e.g. power off on PlannerLooms)
      if (PLANNER[name]) {
        const have = v[0].map(String);
        const miss = PLANNER[name].filter(function (h) { return have.indexOf(h) < 0; });
        if (miss.length) {
          sh.getRange(1, have.length + 1, 1, miss.length).setValues([miss]);
          v = sh.getDataRange().getValues();
          v = v.map(function (r, i) { return i === 0 ? r : r.concat(miss.map(function () { return ''; })).slice(0, v[0].length); });
        }
      }
      return (cache[name] = { sh: sh, head: v[0].map(String), rows: v });
    };
    // check every change before writing any, so a bad request writes nothing
    changes.forEach(function (c) {
      const rule = MASTER_RULES[c.tab];
      if (!PLANNER[c.tab] && !rule) throw new Error('Tab not writable: ' + c.tab);
      if (!String((c.row && c.row.id) || c.id || '')) throw new Error('Row without id in ' + c.tab);
      if (c.op === 'delete' && rule && !rule.del) throw new Error(c.tab + ' rows cannot be deleted from the planner. Delete them in the Fabric Database app.');
    });
    changes.forEach(function (c) {
      const t = tab(c.tab), idCol = t.head.indexOf('id');
      const id = String((c.row && c.row.id) || c.id || '');
      let ri = -1;
      for (let i = 1; i < t.rows.length; i++) if (String(t.rows[i][idCol]) === id) { ri = i; break; }
      if (MASTER_RULES[c.tab]) { masterChange_(c, t, ri, id, now); return; }

      if (c.op === 'delete') {
        if (ri > 0) { t.sh.deleteRow(ri + 1); t.rows.splice(ri, 1); }
        log.push([when, who.name, 'deleted', 'Planner', c.tab, c.summary || '', id]);
        return;
      }
      const row = Object.assign({}, c.row, { updated_at: now, updated_by: who.name });
      if (ri < 0) {
        const arr = t.head.map(function (k) { return row[k] === undefined || row[k] === null ? '' : String(row[k]); });
        const r = t.rows.length + 1;
        t.sh.getRange(r, 1, 1, arr.length).setNumberFormat('@').setValues([arr]);
        t.rows.push(arr);
        log.push([when, who.name, 'added', 'Planner', c.tab, c.summary || '', id]);
      } else {
        const arr = t.rows[ri].slice();
        t.head.forEach(function (k, i) { if (row[k] !== undefined) arr[i] = row[k] === null ? '' : String(row[k]); });
        t.sh.getRange(ri + 1, 1, 1, arr.length).setNumberFormat('@').setValues([arr]);
        t.rows[ri] = arr;
        log.push([when, who.name, 'changed', 'Planner', c.tab, c.summary || '', id]);
      }
    });
    log_(log);
    finish_();
    REQ_ = null;
    return changes.length;
  });
}

// A master row: only the tab's writable columns, typed and stamped as the Fabric Database backend does.
// A change writes only the cells that really changed (plus updated_at / updated_by); the rest of the row stays.
function masterChange_(c, t, ri, id, now) {
  const rule = MASTER_RULES[c.tab], head = t.head;
  if (c.op === 'delete') {
    if (ri < 0) return;
    note_(c.tab, 'deleted', rowObj_(head, t.rows[ri]), []);
    t.sh.deleteRow(ri + 1);
    t.rows.splice(ri, 1);
    return;
  }
  const row = c.row || {};
  const at = head.indexOf('updated_at'), by = head.indexOf('updated_by');
  if (ri < 0) {
    if (!rule.add) throw new Error('Row not found in ' + c.tab + ': ' + id);
    const values = head.map(function (h) { return h === 'id' ? id : rule.cols.indexOf(h) >= 0 ? toCell_(h, row[h]) : ''; });
    if (at >= 0) values[at] = now;
    if (by >= 0) values[by] = REQ_.user.name;
    const ca = head.indexOf('created_at'), cb = head.indexOf('created_by');
    if (ca >= 0) values[ca] = now;
    if (cb >= 0) values[cb] = REQ_.user.name;
    t.sh.getRange(t.rows.length + 1, 1, 1, head.length).setValues([values]);
    t.rows.push(values);
    note_(c.tab, 'added', rowObj_(head, values), []);
    return;
  }
  const current = t.rows[ri].slice(), merged = current.slice(), diffs = [], cells = [];
  rule.cols.forEach(function (h) {
    const i = head.indexOf(h);
    if (i < 0 || !(h in row)) return;
    const v = toCell_(h, row[h]);
    if (norm_(h, current[i]) === norm_(h, v)) return;
    diffs.push({ field: h, from: fromCell_(h, current[i]), to: fromCell_(h, v) });
    merged[i] = v;
    cells.push(i);
  });
  if (!diffs.length) return;
  if (at >= 0) { merged[at] = now; cells.push(at); }
  if (by >= 0) { merged[by] = REQ_.user.name; cells.push(by); }
  cells.forEach(function (i) { t.sh.getRange(ri + 1, i + 1).setValue(merged[i]); });
  t.rows[ri] = merged;
  note_(c.tab, 'changed', rowObj_(head, merged), diffs);
}

// ---------- cell types (as the Fabric Database backend) ----------

const NUMERIC = {
  count: 1, filaments: 1, tpm: 1, tpm_delta: 1, rate: 1, cost_per_pick: 1, tfo_default_eff: 1, reed_width_cm: 1, looms: 1, rpm: 1, efficiency: 1,
  reed: 1, ppi: 1, reed_space_in: 1, greige_width_in: 1, warp_shortage_pct: 1, weft_shortage_pct: 1, price: 1, vatav_pct: 1, rfd_shortage_pct: 1,
  processing_charge: 1, brokering_pct: 1, loom_rpm: 1, loom_rpm_dp: 1, loom_eff_pct: 1, ends: 1, parts: 1, sort: 1,
  machines: 1, spindles_per_side: 1, panna: 1, sides: 1, kg_per_day: 1, qty: 1, beam_length_m: 1, doff_g_per_spindle: 1
};
const BOOLEAN = { has_tfo: 1, is_cover: 1 };
const DATE_ONLY = { effective_date: 1, plan_date: 1 };
const STAMPS = { id: 1, updated_at: 1, updated_by: 1, created_at: 1, created_by: 1 };

function fromCell_(h, v) {
  if (v instanceof Date) return DATE_ONLY[h] ? Utilities.formatDate(v, REQ_.tz, 'yyyy-MM-dd') : v.toISOString();
  if (BOOLEAN[h]) return v === true || String(v).toUpperCase() === 'TRUE';
  return v;
}

function toCell_(h, v) {
  if (v === null || v === undefined) return '';
  if (BOOLEAN[h]) return v === true || String(v).toUpperCase() === 'TRUE';
  if (NUMERIC[h]) {
    if (v === '') return '';
    const n = Number(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : String(v);
  }
  return String(v);
}

function norm_(h, v) {
  const x = fromCell_(h, v);
  if (x === null || x === undefined) return '';
  if (NUMERIC[h] && x !== '' && isFinite(Number(x))) return String(Number(x));
  return String(x);
}

function rowObj_(head, values) {
  const obj = {};
  for (let c = 0; c < head.length; c++) if (head[c]) obj[head[c]] = fromCell_(head[c], values[c]);
  if (obj.id !== undefined && obj.id !== null) obj.id = String(obj.id);
  return obj;
}

// ---------- change log (as the Fabric Database backend) ----------
// One line per thing a person did, grouped under the fabric, yarn or unit it belongs to:
// "Divyam changed Natural Crape 67: Loom RPM 1041 → 1050; weft 60/24 VISCOSE 1650 TPM: Pick share 1 → 2".

const LOG_TAB = 'Change log';
const ROOT_OF = {
  FabricYarns: ['Fabrics', 'fabric_id'],
  Assignments: ['Fabrics', 'fabric_id'],
  FabricBeams: ['Fabrics', 'fabric_id'],
  TfoTypes: ['Units', 'unit_id'],
  TfoSpeeds: ['Units', 'unit_id']
};
const KIND = { Fabrics: 'Fabric', Yarns: 'Yarn', Units: 'Unit' };
const ID_REF = { yarn_id: 'Yarns', base_yarn_id: 'Yarns', unit_id: 'Units', tfo_type_id: 'TfoTypes', fabric_id: 'Fabrics', loom_group_id: 'LoomGroups' };
const LABELS = {
  name: 'Name', weave: 'Weave', design_note: 'Design', end_use: 'End use', reed: 'Reed', ppi: 'PPI', reed_space_in: 'RS',
  greige_width_in: 'Greige width', warp_shortage_pct: 'Warp shortage %', weft_shortage_pct: 'Weft shortage %',
  loom_rpm: 'Loom RPM', loom_rpm_dp: 'Loom RPM double panna', notes: 'Notes', kind: 'Kind', base_yarn_id: 'Base yarn',
  material: 'Material', form: 'Form', count: 'Count', count_unit: 'Count unit', filaments: 'Filaments', lustre: 'Lustre',
  tpm: 'TPM', twist: 'Twist', beam_length_m: 'Beam length (m)', side: 'Side', yarn_id: 'Yarn', ends: 'Ends', parts: 'Pick share',
  pattern: 'Pattern', rpm: 'RPM', efficiency: 'Efficiency', tfo_type_id: 'TFO type', unit_id: 'Unit', spindles_per_side: 'Spindles per side',
  doff_g_per_spindle: 'Doff g per spindle', loom_group_id: 'Loom group'
};

function note_(table, action, row, diffs) {
  REQ_.events.push({ table: table, action: action, row: row, diffs: diffs });
  if (action === 'deleted') REQ_.gone[table + ':' + row.id] = label_(table, row);
}

function stamp_() {
  return Utilities.formatDate(new Date(), ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function log_(lines) {
  if (!lines.length) return;
  try {
    const lg = ss_().getSheetByName(LOG_TAB);
    if (lg) lg.getRange(lg.getLastRow() + 1, 1, lines.length, 7).setValues(lines);
  } catch (e) {
    /* the save itself already went through; a missed log line must not undo it */
  }
}

function fabricLabel_(f) {
  const name = String(f.name || '').trim();
  const rs = Number(f.reed_space_in);
  if (f.reed_space_in === '' || f.reed_space_in === null || f.reed_space_in === undefined || !isFinite(rs)) return name;
  const r = String(Math.round(rs));
  const m = name.match(/^(.*?)((?: \(copy\))*)$/);
  const head = m[1];
  const hm = head.match(/^(.*?)\s*-?\s*(\d+(?:\.\d+)?)$/);
  if (hm && hm[1] && (hm[2] === r || Number(hm[2]) === Math.round(rs))) return name;
  return (head + ' ' + r + m[2]).trim();
}

function label_(table, row) {
  if (!row) return '';
  if (table === 'Fabrics') return fabricLabel_(row);
  if (table === 'LoomGroups') return [row.make, row.reed_width_cm ? row.reed_width_cm + ' cm' : '', row.shedding].filter(function (x) { return x; }).join(' ') || 'loom group';
  return String(row.name || row.id || '');
}

function readRows_(table) {
  const sh = REQ_.ss.getSheetByName(table);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues(), head = v[0].map(String);
  return v.slice(1).map(function (r) { return rowObj_(head, r); }).filter(function (o) { return o.id; });
}

function nameOf_(table, id) {
  if (id === '' || id === null || id === undefined) return '';
  const key = table + ':' + id;
  if (REQ_.gone[key]) return REQ_.gone[key];
  if (!REQ_.names[table]) {
    const map = {};
    readRows_(table).forEach(function (r) { map[r.id] = label_(table, r); });
    REQ_.names[table] = map;
  }
  return REQ_.names[table][String(id)] || '';
}

function show_(h, v) {
  if (v === '' || v === null || v === undefined) return 'blank';
  if (BOOLEAN[h]) return v ? 'Yes' : 'No';
  if (ID_REF[h]) return nameOf_(ID_REF[h], v) || String(v);
  const s = String(v);
  return s.length > 40 ? s.slice(0, 39) + '…' : s;
}

function diffText_(d) {
  if (d.field === 'sort' || STAMPS[d.field]) return '';
  return (LABELS[d.field] || d.field.replace(/_/g, ' ')) + ' ' + show_(d.field, d.from) + ' → ' + show_(d.field, d.to);
}

function fieldDiffs_(ev, what) {
  const parts = ev.diffs.map(diffText_).filter(String);
  return parts.length ? what + ': ' + parts.join(', ') : '';
}

function describe_(ev) {
  const r = ev.row, a = ev.action;
  switch (ev.table) {
    case 'FabricYarns': {
      const line = (r.side || 'yarn') + ' ' + (nameOf_('Yarns', r.yarn_id) || 'yarn');
      if (a === 'added') return 'added ' + line;
      if (a === 'deleted') return 'removed ' + line;
      const swapped = ev.diffs.some(function (d) { return d.field === 'yarn_id'; });
      return fieldDiffs_(ev, swapped ? r.side || 'yarn' : line);
    }
    case 'Assignments':
      if (a === 'added') return 'added to ' + (nameOf_('Units', r.unit_id) || 'a unit');
      if (a === 'deleted') return 'removed from ' + (nameOf_('Units', r.unit_id) || 'a unit');
      return '';
    case 'FabricBeams': {
      const fb = 'beam length on ' + (nameOf_('LoomGroups', r.loom_group_id) || 'loom group');
      if (a === 'added') return fb + (r.beam_length_m !== '' ? ' ' + r.beam_length_m + ' m' : '');
      if (a === 'deleted') return fb + ' removed';
      return fieldDiffs_(ev, fb);
    }
    case 'TfoSpeeds': {
      const sp = (nameOf_('Yarns', r.yarn_id) || 'yarn') + ' on ' + (nameOf_('TfoTypes', r.tfo_type_id) || 'TFO');
      if (a === 'added') return 'speed added for ' + sp + (r.rpm !== '' ? ', RPM ' + r.rpm : '');
      if (a === 'deleted') return 'speed removed for ' + sp;
      return fieldDiffs_(ev, sp);
    }
    case 'TfoTypes':
      return fieldDiffs_(ev, 'TFO type ' + r.name);
    default:
      return '';
  }
}

function uniq_(list) {
  const seen = {};
  return list.filter(function (x) {
    if (!x || seen[x]) return false;
    seen[x] = 1;
    return true;
  });
}

// Marks a fabric, yarn or unit as edited when only its yarn lines, links, beams or speeds changed.
function touch_(table, id) {
  const sh = REQ_.ss.getSheetByName(table);
  if (!sh) return;
  const v = sh.getDataRange().getValues(), head = v[0].map(String), idCol = head.indexOf('id');
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][idCol]) !== String(id)) continue;
    const at = head.indexOf('updated_at'), by = head.indexOf('updated_by');
    if (at >= 0) sh.getRange(i + 1, at + 1).setValue(new Date().toISOString());
    if (by >= 0) sh.getRange(i + 1, by + 1).setValue(REQ_.user.name);
    return;
  }
}

function finish_() {
  if (!REQ_ || !REQ_.events.length) return;
  const events = REQ_.events;
  REQ_.events = [];
  REQ_.names = {};
  const groups = [], byKey = {}, deleted = {};
  events.forEach(function (ev) {
    if (KIND[ev.table] && ev.action === 'deleted') deleted[ev.table + ':' + ev.row.id] = 1;
  });
  events.forEach(function (ev) {
    const link = ROOT_OF[ev.table];
    const root = link ? { table: link[0], id: String(ev.row[link[1]] || '') } : { table: ev.table, id: String(ev.row.id) };
    if (!root.id || !KIND[root.table]) return;
    const key = root.table + ':' + root.id;
    if (!byKey[key]) {
      byKey[key] = { root: root, self: null, kids: [] };
      groups.push(byKey[key]);
    }
    if (link) byKey[key].kids.push(ev);
    else byKey[key].self = ev;
  });
  const who = REQ_.user.name, when = stamp_(), lines = [];
  groups.forEach(function (g) {
    const kind = KIND[g.root.table], self = g.self;
    if (self && self.action === 'added') {
      const with_ = g.kids.filter(function (k) { return k.table === 'Assignments'; }).map(describe_);
      lines.push([when, who, 'added', kind, label_(g.root.table, self.row), uniq_(with_).join('; '), g.root.id]);
      return;
    }
    let details = self ? self.diffs.map(diffText_) : [];
    g.kids.forEach(function (k) { details.push(describe_(k)); });
    details = uniq_(details);
    if (!details.length) return;
    lines.push([when, who, 'changed', kind, self ? label_(g.root.table, self.row) : nameOf_(g.root.table, g.root.id) || g.root.id, details.join('; '), g.root.id]);
    if (!self) touch_(g.root.table, g.root.id);
  });
  log_(lines);
}

// ---------- helpers ----------

function headers_(sh) {
  return sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
}

function cell_(c, tz) {
  if (c instanceof Date) {
    return Utilities.formatDate(c, tz, 'HH:mm:ss') === '00:00:00'
      ? Utilities.formatDate(c, tz, 'yyyy-MM-dd')
      : c.toISOString();
  }
  return c;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
