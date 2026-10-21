// node --test test/  —  apps-script/Code.gs against an in-memory sheet
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGs } from './gas-mock.mjs';
import { fabricChanges, fabricDraft, yarnDraft, yarnChanges, MONEY } from '../js/masters.js';

const FILE = new URL('../apps-script/Code.gs', import.meta.url).pathname;
const U = 'u_mvdwlskosl2i';
// master columns as the Fabric Database app's schema (src/schema.js)
const HEAD = {
  Units: ['id', 'name', 'type', 'cost_per_pick', 'has_tfo', 'tfo_default_eff', 'loom_eff_pct', 'notes', 'updated_at', 'updated_by'],
  LoomGroups: ['id', 'unit_id', 'make', 'reed_width_cm', 'shedding', 'looms', 'updated_at', 'updated_by'],
  Fabrics: ['id', 'name', 'weave', 'design_note', 'end_use', 'reed', 'ppi', 'reed_space_in', 'greige_width_in', 'warp_shortage_pct', 'weft_shortage_pct', 'price', 'vatav_pct', 'finish', 'rfd_shortage_pct', 'processing_charge', 'brokering_pct', 'loom_rpm', 'loom_rpm_dp', 'loom_eff_pct', 'notes', 'created_at', 'updated_at', 'updated_by', 'created_by'],
  FabricYarns: ['id', 'fabric_id', 'side', 'yarn_id', 'ends', 'parts', 'pattern', 'sort', 'updated_at', 'updated_by'],
  Assignments: ['id', 'fabric_id', 'unit_id', 'updated_at', 'updated_by'],
  FabricBeams: ['id', 'fabric_id', 'loom_group_id', 'beam_length_m', 'updated_at', 'updated_by'],
  Yarns: ['id', 'name', 'kind', 'base_yarn_id', 'material', 'form', 'count', 'count_unit', 'filaments', 'lustre', 'tpm', 'twist', 'tpm_delta', 'notes', 'updated_at', 'updated_by'],
  TfoTypes: ['id', 'unit_id', 'name', 'machines', 'spindles_per_side', 'efficiency', 'updated_at', 'updated_by', 'doff_g_per_spindle'],
  TfoSpeeds: ['id', 'unit_id', 'tfo_type_id', 'yarn_id', 'rpm', 'efficiency', 'updated_at', 'updated_by']
};

function setup() {
  const g = loadCodeGs(FILE);
  g.addTab('Units', HEAD.Units, [{ id: U, name: 'Weavelon 2', cost_per_pick: 0.23, loom_eff_pct: 93 }]);
  g.addTab('LoomGroups', HEAD.LoomGroups, [{ id: 'g190p', unit_id: U, make: 'Toyota', reed_width_cm: 190, shedding: 'Plain' }, { id: 'g190d', unit_id: U, make: 'Toyota', reed_width_cm: 190, shedding: 'Dobby' }]);
  g.addTab('Fabrics', HEAD.Fabrics, [{ id: 'f1', name: 'Natural Crape', weave: 'Plain', ppi: 80, reed_space_in: 67, price: 52, vatav_pct: 2, loom_rpm: 1041, warp_shortage_pct: 10, weft_shortage_pct: 10, created_by: 'Owner' }]);
  g.addTab('FabricYarns', HEAD.FabricYarns, [{ id: 'l1', fabric_id: 'f1', side: 'warp', yarn_id: 'yb', ends: 9000, sort: 1 }, { id: 'l2', fabric_id: 'f1', side: 'weft', yarn_id: 'yt', parts: 1, sort: 2 }, { id: 'l3', fabric_id: 'f1', side: 'weft', yarn_id: 'yb', parts: 1, sort: 3 }]);
  g.addTab('Assignments', HEAD.Assignments, [{ id: 'a1', fabric_id: 'f1', unit_id: U }]);
  g.addTab('FabricBeams', HEAD.FabricBeams, []);
  g.addTab('Yarns', HEAD.Yarns, [{ id: 'yb', name: '60/24 VISCOSE', kind: 'base', count: 60, count_unit: 'D' }, { id: 'yt', name: '60/24 VISCOSE 1650 TPM', kind: 'tpm', base_yarn_id: 'yb', count: 65, tpm: 1650, tpm_delta: 60 }]);
  g.addTab('TfoTypes', HEAD.TfoTypes, [{ id: 'tt1', unit_id: U, name: 'Old machines (1-12)', machines: 12, efficiency: 80 }]);
  g.addTab('TfoSpeeds', HEAD.TfoSpeeds, [{ id: 's1', unit_id: U, tfo_type_id: 'tt1', yarn_id: 'yt', rpm: 20000 }]);
  g.addTab('Change log', ['When', 'Who', 'Action', 'Type', 'Item', 'Details', 'Ref']);
  g.ctx.setup();
  g.ctx.makeKey();
  const key = Object.keys(JSON.parse(g.props.KEYS))[0];
  const tabs = g.post({ key, action: 'load' }).tabs;
  return { ...g, key, tabs, sh: (n) => g.ss.getSheetByName(n), log: () => g.ss.getSheetByName('Change log').objects() };
}

test('load: the first key is the owner', () => {
  const g = setup();
  const r = g.post({ key: g.key, action: 'load' });
  assert.equal(r.ok, true);
  assert.equal(r.user, 'Owner');
  assert.equal(r.role, 'owner');
  assert.equal(r.tabs.Fabrics[0].price, 52, 'master tabs load as they are');
  assert.equal(g.post({ key: 'nope', action: 'load' }).ok, false);
});

test('a new fabric from the planner: typed cells, stamps, Weavelon 2 link, no money, logged as the Fabric Database does', () => {
  const g = setup();
  const d = fabricDraft(g.tabs, '');
  Object.assign(d, { name: 'butter crepe', ppi: '84', reed_space_in: '60', beams: { g190p: '6500', g190d: '6500' } });
  d.lines = [{ id: '', side: 'warp', yarn_id: 'yb', ends: '8000' }, { id: '', side: 'weft', yarn_id: 'yt', parts: '1', pattern: '' }];
  const { id, changes } = fabricChanges(g.tabs, d);
  const r = g.post({ key: g.key, action: 'save', changes });
  assert.equal(r.ok, true, r.error);
  const f = g.sh('Fabrics').objects().find((x) => x.id === id);
  assert.equal(f.name, 'Butter Crepe');
  assert.equal(f.ppi, 84, 'numbers stored as numbers, like the Fabric Database backend');
  assert.equal(f.created_by, 'Owner');
  assert.equal(f.updated_by, 'Owner');
  assert.ok(f.created_at);
  for (const m of MONEY) if (m in f) assert.equal(f[m], '', `${m} left blank`);
  assert.deepEqual(g.sh('Assignments').objects().filter((a) => a.fabric_id === id).map((a) => a.unit_id), [U]);
  assert.equal(g.sh('FabricYarns').objects().filter((l) => l.fabric_id === id).length, 2);
  assert.deepEqual(g.sh('FabricBeams').objects().map((b) => [b.loom_group_id, b.beam_length_m]).sort(), [['g190d', 6500], ['g190p', 6500]]);
  const fl = g.log().filter((l) => l.Type === 'Fabric');
  assert.equal(fl.length, 1, 'one line for the whole fabric');
  assert.deepEqual([fl[0].Who, fl[0].Action, fl[0].Item, fl[0].Details, fl[0].Ref], ['Owner', 'added', 'Butter Crepe 60', 'added to Weavelon 2', id]);
});

test('editing a fabric: only changed cells, money untouched, yarn line removed, one change-log line', () => {
  const g = setup();
  const d = fabricDraft(g.tabs, 'f1');
  d.loom_rpm = '1050';
  d.lines = d.lines.filter((l) => l.id !== 'l3');
  const { changes } = fabricChanges(g.tabs, d);
  // even if a money column slipped into the row, it is not written
  changes[0].row.price = '99';
  const r = g.post({ key: g.key, action: 'save', changes });
  assert.equal(r.ok, true, r.error);
  const f = g.sh('Fabrics').objects()[0];
  assert.equal(f.loom_rpm, 1050);
  assert.equal(f.price, 52);
  assert.equal(f.vatav_pct, 2);
  assert.equal(f.created_by, 'Owner');
  assert.deepEqual(g.sh('FabricYarns').objects().map((l) => l.id), ['l1', 'l2']);
  const fl = g.log().filter((l) => l.Type === 'Fabric');
  assert.equal(fl.length, 1);
  assert.equal(fl[0].Action, 'changed');
  assert.equal(fl[0].Item, 'Natural Crape 67');
  assert.match(fl[0].Details, /Loom RPM 1041 → 1050/);
  assert.match(fl[0].Details, /removed weft 60\/24 VISCOSE/);
});

test('a save that changes nothing writes nothing', () => {
  const g = setup();
  const { changes } = fabricChanges(g.tabs, fabricDraft(g.tabs, 'f1'));
  const before = g.sh('Fabrics').cellWrites;
  g.post({ key: g.key, action: 'save', changes });
  assert.equal(g.sh('Fabrics').cellWrites, before);
  assert.equal(g.log().filter((l) => l.Type === 'Fabric').length, 0);
});

test('masters cannot be deleted from the planner, and a refused request writes nothing', () => {
  const g = setup();
  for (const [tab, id] of [['Fabrics', 'f1'], ['Yarns', 'yb'], ['Assignments', 'a1'], ['TfoSpeeds', 's1'], ['TfoTypes', 'tt1']]) {
    const r = g.post({ key: g.key, action: 'save', changes: [{ tab: 'Fabrics', op: 'upsert', row: { id: 'f1', loom_rpm: '1' } }, { tab, op: 'delete', row: { id } }] });
    assert.equal(r.ok, false, tab);
    assert.match(r.error, /Fabric Database app/);
  }
  assert.equal(g.sh('Fabrics').objects()[0].loom_rpm, 1041);
  assert.equal(g.sh('Yarns').objects().length, 2);
  const r = g.post({ key: g.key, action: 'save', changes: [{ tab: 'YarnRates', op: 'upsert', row: { id: 'r1', rate: 1 } }] });
  assert.match(r.error, /not writable/);
});

test('a new TPM yarn with a TFO speed: Yarn added, speed logged under the unit, TPM delta left blank', () => {
  const g = setup();
  const d = yarnDraft(g.tabs, '', 'tpm');
  Object.assign(d, { name: '60/24 VISCOSE 1200 TPM', base_yarn_id: 'yb', tpm: '1200', speeds: { tt1: '20000' } });
  const { id, changes } = yarnChanges(g.tabs, d);
  const r = g.post({ key: g.key, action: 'save', changes });
  assert.equal(r.ok, true, r.error);
  const y = g.sh('Yarns').objects().find((x) => x.id === id);
  assert.deepEqual([y.kind, y.tpm, y.tpm_delta, y.updated_by], ['tpm', 1200, '', 'Owner']);
  const sp = g.sh('TfoSpeeds').objects().find((s) => s.yarn_id === id);
  assert.equal(sp.rpm, 20000, 'RPM stored as entered (already x2)');
  const log = g.log();
  assert.ok(log.some((l) => l.Type === 'Yarn' && l.Action === 'added' && l.Item === '60/24 VISCOSE 1200 TPM'));
  const u = log.find((l) => l.Type === 'Unit');
  assert.equal(u.Item, 'Weavelon 2');
  assert.match(u.Details, /speed added for 60\/24 VISCOSE 1200 TPM on Old machines \(1-12\), RPM 20000/);
  assert.equal(g.sh('Units').objects()[0].updated_by, 'Owner', 'the unit is marked as edited');
});

test('TFO type settings still save and planner tabs still work', () => {
  const g = setup();
  const r = g.post({ key: g.key, action: 'save', changes: [{ tab: 'TfoTypes', op: 'upsert', row: { id: 'tt1', efficiency: '75', doff_g_per_spindle: '900' } }, { tab: 'PlannerSettings', op: 'upsert', row: { id: 'set_window', unit_id: U, key: 'window', value: '5' }, summary: 'Plan window 5 days' }] });
  assert.equal(r.ok, true, r.error);
  const t = g.sh('TfoTypes').objects()[0];
  assert.deepEqual([t.efficiency, t.doff_g_per_spindle, t.name], [75, 900, 'Old machines (1-12)']);
  assert.equal(g.sh('PlannerSettings').objects()[0].value, '5');
  assert.ok(g.log().some((l) => l.Type === 'Planner' && l.Details === 'Plan window 5 days'));
});

test('people: the owner adds, renames and removes; each key saves under its own name', () => {
  const g = setup();
  const add = g.post({ key: g.key, action: 'addPerson', name: 'Ishaan' });
  assert.equal(add.ok, true, add.error);
  const k2 = add.person.key;
  assert.equal(add.people.length, 2);
  assert.equal(add.people[0].role, 'owner');
  assert.equal(g.post({ key: g.key, action: 'addPerson', name: 'ishaan' }).ok, false, 'no two people with one name');
  const ed = g.post({ key: k2, action: 'load' });
  assert.deepEqual([ed.user, ed.role], ['Ishaan', 'editor']);
  assert.equal(g.post({ key: k2, action: 'people' }).ok, false, 'editors cannot see keys');
  g.post({ key: k2, action: 'save', changes: [{ tab: 'Fabrics', op: 'upsert', row: { id: 'f1', loom_rpm: '1060' } }] });
  assert.equal(g.sh('Fabrics').objects()[0].updated_by, 'Ishaan');
  assert.equal(g.post({ key: g.key, action: 'renamePerson', id: add.person.id, name: 'Ishaan Bhai' }).ok, true);
  assert.equal(g.post({ key: k2, action: 'load' }).user, 'Ishaan Bhai');
  const owner = g.post({ key: g.key, action: 'people' }).people[0];
  assert.equal(g.post({ key: g.key, action: 'removePerson', id: owner.id }).ok, false);
  assert.equal(g.post({ key: g.key, action: 'removePerson', id: add.person.id }).ok, true);
  assert.equal(g.post({ key: k2, action: 'load' }).ok, false, 'removed key stops working');
  assert.ok(g.log().some((l) => l.Type === 'Access' && l.Action === 'gave access' && l.Item === 'Ishaan'));
});

test('keys made by the earlier script (name only) keep working; the first is the owner', () => {
  const g = loadCodeGs(FILE);
  g.props.KEYS = JSON.stringify({ aaa: 'Owner', bbb: 'Brother' });
  assert.equal(g.post({ key: 'aaa', action: 'people' }).people.length, 2);
  assert.equal(g.post({ key: 'bbb', action: 'people' }).ok, false);
  const p = g.post({ key: 'aaa', action: 'people' }).people;
  assert.deepEqual(p.map((x) => [x.name, x.role]), [['Owner', 'owner'], ['Brother', 'editor']]);
});

test('a Planner tab made before power off gets the new columns on its first save', () => {
  const g = setup();
  const old = ['id', 'unit_id', 'loom_no', 'loom_group_id', 'panna', 'fabric_id', 'beam_balance_m', 'balance_date', 'runout_override', 'notes', 'updated_at', 'updated_by'];
  g.ss.getSheets().splice(g.ss.getSheets().indexOf(g.sh('PlannerLooms')), 1);
  g.addTab('PlannerLooms', old, [{ id: 'lm1', unit_id: U, loom_no: '1', notes: 'x' }]);
  const r = g.post({ key: g.key, action: 'save', changes: [{ tab: 'PlannerLooms', op: 'upsert', row: { id: 'lm1', unit_id: U, loom_no: '1', power_off_from: '2026-10-22', power_on_date: '' } }] });
  assert.equal(r.ok, true, r.error);
  const row = g.sh('PlannerLooms').objects()[0];
  assert.equal(row.power_off_from, '2026-10-22');
  assert.equal(row.notes, 'x', 'other cells kept');
});
