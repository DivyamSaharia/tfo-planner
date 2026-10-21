// node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { tabs as fixture } from './master-fixture.mjs';
import { WRITABLE, MONEY, UNIT_ID, beamSlots, fabricDraft, fabricChanges, fabricErrors, duplicateFabric, duplicateYarn, rsCopy, yarnDraft, yarnChanges, yarnErrors, stripRs, fabricLabel, titleCase } from '../js/masters.js';
import { buildMaster } from '../js/calc.js';

const tabs = () => JSON.parse(JSON.stringify(fixture));
const G190P = 'lg_mvdwlskoejlg', G190D = 'lg_w2_190dobby', G280P = 'lg_w2_280plain', G280D = 'lg_mvdwlskopkjb';
const byTab = (ch, tab, op = 'upsert') => ch.filter((c) => c.tab === tab && c.op === op);

// every row the planner writes holds only id and that tab's writable columns: never a money column
function onlyWritable(ch) {
  for (const c of ch) {
    const cols = Object.keys(c.row).filter((k) => k !== 'id');
    if (c.op === 'delete') { assert.deepEqual(cols, [], `${c.tab} delete sends only the id`); continue; }
    for (const k of cols) assert.ok(WRITABLE[c.tab].includes(k), `${c.tab}.${k} is not writable`);
    for (const m of MONEY) assert.ok(!(m in c.row), `${c.tab} row carries money column ${m}`);
  }
}

function newFabric(over = {}) {
  const d = fabricDraft(tabs(), '');
  Object.assign(d, { name: 'butter crepe', ppi: '84', reed_space_in: '60', reed: '120' }, over);
  d.lines = [{ id: '', side: 'warp', yarn_id: 'y_mvgfrkvq13ya', ends: '8000' }, { id: '', side: 'weft', yarn_id: 'y_mvgf6t827a34', parts: '1', pattern: '' }];
  return d;
}

test('a new fabric gets Fabrics, FabricYarns and an Assignments row for Weavelon 2', () => {
  const t = tabs();
  const { id, label, changes } = fabricChanges(t, newFabric());
  assert.match(id, /^f_[0-9a-z]+$/);
  assert.equal(label, 'Butter Crepe 60');
  const f = byTab(changes, 'Fabrics')[0].row;
  assert.equal(f.name, 'Butter Crepe', 'stored title case and without the RS');
  assert.equal(f.weave, 'Plain');
  assert.equal(f.warp_shortage_pct, '10');
  const a = byTab(changes, 'Assignments');
  assert.equal(a.length, 1);
  assert.equal(a[0].row.unit_id, UNIT_ID);
  assert.equal(a[0].row.fabric_id, id);
  assert.match(a[0].row.id, /^a_/);
  const ls = byTab(changes, 'FabricYarns').map((c) => c.row);
  assert.deepEqual(ls.map((l) => [l.side, l.sort, l.ends, l.parts]), [['warp', '1', '8000', ''], ['weft', '2', '', '1']]);
  assert.ok(ls.every((l) => l.fabric_id === id && /^l_/.test(l.id)));
  onlyWritable(changes);
});

test('the new fabric shows in the planner master after a save', () => {
  const t = tabs();
  const { id, changes } = fabricChanges(t, newFabric());
  changes.forEach((c) => (t[c.tab] = t[c.tab] || []).push(c.row));
  const M = buildMaster(t);
  assert.equal(M.fabrics[id].label, 'Butter Crepe 60');
  assert.equal(M.fabrics[id].warp[0].ends, 8000);
});

test('a name typed with its RS is stored without it', () => {
  assert.equal(stripRs('Natural Crape 53', 52.5), 'Natural Crape');
  assert.equal(fabricLabel({ name: 'Natural Crape', reed_space_in: 52.5 }), 'Natural Crape 53');
  assert.equal(titleCase('natural  CRAPE'), 'Natural Crape');
  const { changes } = fabricChanges(tabs(), newFabric({ name: 'Butter Crepe 60' }));
  assert.equal(byTab(changes, 'Fabrics')[0].row.name, 'Butter Crepe');
});

test('a plain fabric beam length saves to both the plain and the dobby group of that width', () => {
  const t = tabs();
  const slots = beamSlots('Plain', t);
  assert.deepEqual(slots.map((x) => x.width), [190, 280]);
  assert.deepEqual(slots[0].groupIds.sort(), [G190D, G190P].sort());
  const d = newFabric({ beams: { [G190P]: '6500', [G190D]: '6500' } });
  const { changes } = fabricChanges(t, d);
  const b = byTab(changes, 'FabricBeams').map((c) => c.row);
  assert.deepEqual(b.map((r) => r.loom_group_id).sort(), [G190D, G190P].sort());
  assert.ok(b.every((r) => r.beam_length_m === '6500' && /^fb_/.test(r.id)));
  onlyWritable(changes);
});

test('a dobby fabric sees dobby groups only and gets no plain-group beam', () => {
  const t = tabs();
  const slots = beamSlots('Dobby', t);
  assert.deepEqual(slots.map((x) => x.groupIds), [[G190D], [G280D]]);
  // a stale plain value in the editor must not be written
  const d = newFabric({ weave: 'Dobby', beams: { [G190P]: '5000', [G190D]: '5000', [G280P]: '4000' } });
  const { changes } = fabricChanges(t, d);
  const b = byTab(changes, 'FabricBeams').map((c) => c.row.loom_group_id);
  assert.deepEqual(b, [G190D]);
});

test('changing a fabric to dobby drops its plain-group beams on save', () => {
  const t = tabs();
  t.FabricBeams.push({ id: 'fb_x', fabric_id: 'f_mvgig63l89g1', loom_group_id: G190P, beam_length_m: '7000' }, { id: 'fb_y', fabric_id: 'f_mvgig63l89g1', loom_group_id: G190D, beam_length_m: '7000' });
  const d = fabricDraft(t, 'f_mvgig63l89g1');
  assert.deepEqual(d.beams, { [G190P]: 7000, [G190D]: 7000 });
  d.weave = 'Dobby';
  const { changes } = fabricChanges(t, d);
  assert.deepEqual(byTab(changes, 'FabricBeams', 'delete').map((c) => c.row.id), ['fb_x']);
  assert.equal(byTab(changes, 'FabricBeams').length, 0, 'unchanged dobby beam is not rewritten');
});

test('editing a fabric: removed yarn line deleted, no second assignment, other columns untouched', () => {
  const t = tabs();
  t.Fabrics[2].price = '52';
  t.FabricYarns.forEach((l, i) => { l.id = 'l' + i; });
  const d = fabricDraft(t, 'f_mvgig64heavr');
  assert.equal(d.lines.length, 3);
  d.lines = d.lines.filter((l, i) => i !== 2);
  d.loom_rpm = '1010';
  const { changes } = fabricChanges(t, d);
  assert.equal(byTab(changes, 'Assignments').length, 0);
  assert.equal(byTab(changes, 'FabricYarns', 'delete').length, 1);
  assert.equal(byTab(changes, 'Fabrics')[0].row.loom_rpm, '1010');
  onlyWritable(changes);
});

test('fabric checks: name required, numbers must be numbers, duplicate warning', () => {
  assert.equal(fabricErrors({ ...newFabric(), name: ' ' }), 'Add a quality name first.');
  assert.match(fabricErrors({ ...newFabric(), ppi: 'abc' }), /Pick \(PPI\) must be a number/);
  assert.equal(fabricErrors(newFabric()), '');
  const t = tabs();
  assert.equal(duplicateFabric(t, { id: '', name: 'natural crape 67', reed_space_in: '67', weave: 'Plain' }), 'Natural Crape 67 (Plain)');
  assert.equal(duplicateFabric(t, { id: '', name: 'Natural Crape', reed_space_in: '67', weave: 'Dobby' }), '');
  assert.equal(duplicateFabric(t, { id: 'f_mvgig63pg5i3', name: 'Natural Crape', reed_space_in: '67', weave: 'Plain' }), '', 'not a duplicate of itself');
});

test('duplicate for new RS scales warp ends and greige width, copies beams and units', () => {
  const t = tabs();
  t.Fabrics[2].greige_width_in = '50';
  t.FabricBeams.push({ id: 'fb_z', fabric_id: 'f_mvgig63l89g1', loom_group_id: G190P, beam_length_m: '6000' });
  const c = rsCopy(t, 'f_mvgig63l89g1', 63);
  assert.equal(c.label, 'Natural Crape 63');
  assert.equal(c.draft.lines.find((l) => l.side === 'warp').ends, String(Math.round(7000 * 63 / 52.5)));
  assert.equal(c.draft.greige_width_in, '60');
  const { changes } = fabricChanges(t, c.draft, { extraUnits: c.extraUnits });
  assert.equal(byTab(changes, 'Assignments').length, 1);
  assert.deepEqual(byTab(changes, 'FabricBeams').map((x) => x.row.loom_group_id).sort(), [G190D, G190P].sort(), 'the 190 cm length fills its plain and dobby groups');
  assert.equal(byTab(changes, 'Fabrics')[0].row.name, 'Natural Crape');
  onlyWritable(changes);
  // RS that already exists gets "(copy)"
  assert.equal(rsCopy(t, 'f_mvgig63l89g1', 67).draft.name, 'Natural Crape (copy)');
});

test('new TPM yarn with TFO speeds per Weavelon 2 type, RPM stored as entered (already x2)', () => {
  const t = tabs();
  const d = yarnDraft(t, '', 'tpm');
  Object.assign(d, { name: '60/24 VISCOSE 1200 TPM', base_yarn_id: 'y_mvgf6t8195rf', count: '64', tpm: '1200' });
  d.speeds = { tt_mvdwlskof702: '20000', tt_mvdwlskor31b: '' };
  assert.equal(yarnErrors(t, d), '');
  const { id, changes } = yarnChanges(t, d);
  assert.match(id, /^y_/);
  const sp = byTab(changes, 'TfoSpeeds').map((c) => c.row);
  assert.equal(sp.length, 1);
  assert.deepEqual([sp[0].unit_id, sp[0].tfo_type_id, sp[0].yarn_id, sp[0].rpm], [UNIT_ID, 'tt_mvdwlskof702', id, '20000']);
  assert.equal(byTab(changes, 'Yarns')[0].row.kind, 'tpm');
  onlyWritable(changes);
  changes.forEach((c) => t[c.tab].push(c.row));
  const M = buildMaster(t);
  assert.equal(M.speeds['tt_mvdwlskof702|' + id].rpm, 20000);
});

test('yarn checks: base yarn needed for TPM, duplicate name, speeds cannot be removed here', () => {
  const t = tabs();
  const d = yarnDraft(t, '', 'tpm');
  d.name = 'X';
  assert.equal(yarnErrors(t, d), 'Choose the base yarn.');
  assert.equal(duplicateYarn(t, ' 60/08  1109 tpm '), '60/08 1109 TPM');
  assert.equal(duplicateYarn(t, '60/08 1109 TPM', 'y_mvdvpxsy37ao'), '');
  const e = yarnDraft(t, 'y_mvdvpxsy37ao');
  assert.equal(e.speeds.tt_mvdwlskof702, '20000');
  e.speeds.tt_mvdwlskof702 = '';
  assert.match(yarnErrors(t, e), /Fabric Database app/);
});

test('a base yarn clears base yarn, TPM and twist', () => {
  const t = tabs();
  const d = yarnDraft(t, '');
  Object.assign(d, { name: '30 VSF', count: '30', count_unit: 'Ne', tpm: '500', twist: 'S', base_yarn_id: 'y_mvdvoz3rmung', speeds: { tt_mvdwlskof702: '20000' } });
  const { changes } = yarnChanges(t, d);
  const y = byTab(changes, 'Yarns')[0].row;
  assert.deepEqual([y.kind, y.base_yarn_id, y.tpm, y.twist, y.count_unit], ['base', '', '', '', 'Ne']);
  assert.equal(byTab(changes, 'TfoSpeeds').length, 0);
  onlyWritable(changes);
});

test('a TPM yarn with no count takes its base yarn denier', () => {
  const t = tabs();
  t.Yarns.push({ id: 'y_new', name: '60/08 900 TPM', kind: 'tpm', base_yarn_id: 'y_mvdvoz3rmung', count: '', count_unit: 'D', tpm: '900' });
  assert.equal(buildMaster(t).yarns.y_new.den, 60);
});

test('WhatsApp setup message carries the app link, URL and key', async () => {
  const { inviteText, whatsappLink, APP_URL } = await import('../js/masters.js');
  const t = inviteText({ name: 'Ishaan', key: 'abc123' }, 'https://script.google.com/macros/s/X/exec');
  assert.match(t, /access for Ishaan/);
  assert.ok(t.includes(APP_URL) && t.includes('abc123') && t.includes('https://script.google.com/macros/s/X/exec'));
  const l = whatsappLink(t);
  assert.ok(l.startsWith('https://wa.me/?text=Hanuman%20TFO%20Planner'));
  assert.equal(decodeURIComponent(l.split('text=')[1]), t);
});
