// Minimal in-memory stand-ins for the Apps Script services apps-script/Code.gs uses. Test-only.
// Adapted from the Fabric Database app's backend/mockGas.js.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

class Range {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) { const line = []; for (let c = 0; c < this.cols; c++) line.push(this.sheet.cell(this.row + r, this.col + c)); out.push(line); }
    return out;
  }
  setValues(v) { v.forEach((line, r) => line.forEach((x, c) => this.sheet.put(this.row + r, this.col + c, x))); return this; }
  setValue(x) { this.sheet.put(this.row, this.col, x); this.sheet.cellWrites++; return this; }
  setNumberFormat() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; this.cellWrites = 0; }
  getName() { return this.name; }
  cell(r, c) { return this.data[r - 1] && this.data[r - 1][c - 1] !== undefined ? this.data[r - 1][c - 1] : ''; }
  put(r, c, v) { while (this.data.length < r) this.data.push([]); const row = this.data[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
  getRange(r, c, rows = 1, cols = 1) {
    if (typeof r === 'string') return new Range(this, 1, 1, 1000, 26);
    return new Range(this, r, c, rows, cols);
  }
  getLastRow() { for (let i = this.data.length; i > 0; i--) if (this.data[i - 1].some((v) => v !== '' && v != null)) return i; return 0; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.reduce((k, v, i) => (v !== '' && v !== undefined ? i + 1 : k), 0)), 0); }
  getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  setFrozenRows() {}
  insertSheet() {}
  deleteRow(r) { this.data.splice(r - 1, 1); }
  // test helper: rows as objects
  objects() { const [h, ...rest] = this.data; return rest.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? '']))); }
}

export function loadCodeGs(file) {
  const sheets = [];
  const props = {};
  const ss = {
    getSheets: () => sheets,
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.push(s); return s; },
    getSpreadsheetTimeZone: () => 'Asia/Kolkata'
  };
  const ctx = {
    SpreadsheetApp: { openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, _tz, fmt) => (String(fmt) === 'HH:mm:ss' ? d.toISOString().slice(11, 19) : String(fmt).includes('HH') ? d.toISOString().slice(0, 19).replace('T', ' ') : d.toISOString().slice(0, 10))
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType() { return this; }, getContent() { return s; } }) },
    Logger: { log() {} },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  // a tab with a header and rows (objects)
  const addTab = (name, head, rows = []) => { const s = ss.insertSheet(name); s.put(1, 1, ''); s.data = [head.slice(), ...rows.map((r) => head.map((h) => (r[h] === undefined ? '' : r[h])))]; return s; };
  return { ctx, ss, props, post, addTab };
}
