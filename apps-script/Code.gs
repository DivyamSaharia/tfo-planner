// TFO Planner API: a standalone Apps Script web app on the Fabric Master DB sheet.
// Reads the master tabs, reads and writes the Planner tabs, and writes back only
// loom RPM on Fabrics and efficiency / doff size / spindles on TfoTypes.
// Copy of the code deployed in the Apps Script project (also the project doc claude/tfo-planner-apps-script.gs.txt).

const SHEET_ID = '1rKatBCfjCtTsCX3tLxGZQ8fA_BMIaghPb8OS7DPxq3M';
const NEW_KEY_NAME = 'Owner'; // change before running makeKey() to create a key for someone else

const MASTER = ['Units', 'LoomGroups', 'Fabrics', 'Assignments', 'FabricYarns', 'Yarns', 'FabricBeams', 'TfoTypes', 'TfoSpeeds'];

const PLANNER = {
  PlannerLooms: ['id', 'unit_id', 'loom_no', 'loom_group_id', 'panna', 'fabric_id', 'beam_balance_m', 'balance_date', 'runout_override', 'notes', 'updated_at', 'updated_by'],
  PlannerChangeovers: ['id', 'unit_id', 'loom_no', 'date', 'to_fabric_id', 'beam', 'beam_length_m', 'notes', 'updated_at', 'updated_by'],
  PlannerBeamStock: ['id', 'unit_id', 'fabric_id', 'loom_group_id', 'beams', 'length_m', 'notes', 'updated_at', 'updated_by'],
  PlannerYarnStock: ['id', 'unit_id', 'date', 'yarn_id', 'kg', 'updated_at', 'updated_by'],
  PlannerReceipts: ['id', 'unit_id', 'kind', 'item', 'mode', 'start_date', 'days', 'qty', 'length_m', 'source', 'notes', 'updated_at', 'updated_by'],
  PlannerTfoSides: ['id', 'unit_id', 'machine_no', 'side', 'tfo_type_id', 'yarn_id', 'loaded_at', 'next_yarn_id', 'updated_at', 'updated_by'],
  PlannerSettings: ['id', 'unit_id', 'key', 'value', 'updated_at', 'updated_by'],
  PlannerProduction: ['id', 'unit_id', 'date', 'loom_no', 'metres', 'notes', 'updated_at', 'updated_by']
};

const MASTER_WRITABLE = {
  Fabrics: ['loom_rpm', 'loom_rpm_dp'],
  TfoTypes: ['efficiency', 'doff_g_per_spindle', 'spindles_per_side']
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

function makeKey() {
  const p = PropertiesService.getScriptProperties();
  const keys = JSON.parse(p.getProperty('KEYS') || '{}');
  const k = Utilities.getUuid().replace(/-/g, '');
  keys[k] = NEW_KEY_NAME;
  p.setProperty('KEYS', JSON.stringify(keys));
  Logger.log('Planner key for ' + NEW_KEY_NAME + ': ' + k);
}

// ---------- web app ----------

function doGet() {
  return json_({ ok: true, app: 'tfo-planner-api' });
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    const who = checkKey_(req.key);
    if (req.action === 'load') out = { ok: true, user: who, tabs: loadAll_() };
    else if (req.action === 'save') out = { ok: true, user: who, saved: save_(req.changes || [], who) };
    else throw new Error('Unknown action');
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return json_(out);
}

function checkKey_(key) {
  const keys = JSON.parse(PropertiesService.getScriptProperties().getProperty('KEYS') || '{}');
  if (!key || !keys[key]) throw new Error('Key not recognised');
  return keys[key];
}

function loadAll_() {
  const ss = SpreadsheetApp.openById(SHEET_ID), tz = ss.getSpreadsheetTimeZone(), tabs = {};
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

function save_(changes, who) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID), tz = ss.getSpreadsheetTimeZone();
    const now = new Date().toISOString(), stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
    const cache = {}, log = [];
    const tab = function (name) {
      if (cache[name]) return cache[name];
      const sh = ss.getSheetByName(name);
      if (!sh) throw new Error('Missing tab ' + name + '. Run setup.');
      const v = sh.getDataRange().getValues();
      return (cache[name] = { sh: sh, head: v[0].map(String), rows: v });
    };
    changes.forEach(function (c) {
      const isPlanner = !!PLANNER[c.tab], allowed = MASTER_WRITABLE[c.tab];
      if (!isPlanner && !allowed) throw new Error('Tab not writable: ' + c.tab);
      const t = tab(c.tab), idCol = t.head.indexOf('id');
      const id = String((c.row && c.row.id) || c.id || '');
      if (!id) throw new Error('Row without id in ' + c.tab);
      let ri = -1;
      for (let i = 1; i < t.rows.length; i++) if (String(t.rows[i][idCol]) === id) { ri = i; break; }

      if (c.op === 'delete') {
        if (!isPlanner) throw new Error('Rows cannot be deleted from ' + c.tab);
        if (ri > 0) { t.sh.deleteRow(ri + 1); t.rows.splice(ri, 1); }
        log.push([stamp, who, 'deleted', 'Planner', c.tab, c.summary || '', id]);
        return;
      }

      const row = Object.assign({}, c.row, { updated_at: now, updated_by: who });
      if (ri < 0) {
        if (!isPlanner) throw new Error('Row not found in ' + c.tab + ': ' + id);
        const arr = t.head.map(function (k) { return row[k] === undefined || row[k] === null ? '' : String(row[k]); });
        const r = t.rows.length + 1;
        t.sh.getRange(r, 1, 1, arr.length).setNumberFormat('@').setValues([arr]);
        t.rows.push(arr);
        log.push([stamp, who, 'added', 'Planner', c.tab, c.summary || '', id]);
      } else if (isPlanner) {
        const arr = t.rows[ri].slice();
        t.head.forEach(function (k, i) { if (row[k] !== undefined) arr[i] = row[k] === null ? '' : String(row[k]); });
        t.sh.getRange(ri + 1, 1, 1, arr.length).setNumberFormat('@').setValues([arr]);
        t.rows[ri] = arr;
        log.push([stamp, who, 'changed', 'Planner', c.tab, c.summary || '', id]);
      } else {
        // master tab: write only the permitted cells, leave the rest of the row untouched
        allowed.concat(['updated_at', 'updated_by']).forEach(function (k) {
          const i = t.head.indexOf(k);
          if (i < 0 || row[k] === undefined) return;
          t.sh.getRange(ri + 1, i + 1).setValue(row[k] === null ? '' : row[k]);
          t.rows[ri][i] = row[k];
        });
        log.push([stamp, who, 'changed', c.tab === 'Fabrics' ? 'Fabric' : 'TFO type', c.tab, c.summary || '', id]);
      }
    });
    if (log.length) {
      const lg = ss.getSheetByName('Change log');
      if (lg) lg.getRange(lg.getLastRow() + 1, 1, log.length, 7).setValues(log);
    }
    return changes.length;
  } finally {
    lock.releaseLock();
  }
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
