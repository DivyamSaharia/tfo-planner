// node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { gPerSpindleHour, hoursPerDoff, doffKgPerSide, loomMPerDay, denier, buildMaster, plan, warpKgPerM, weftKgPerM, fits, dayNum, receiptInfo, beamBalance } from '../js/calc.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ± ${tol}`);

test('TFO delivery, old machine: 60/08 1109 TPM, 62 D, 20,000 RPM (already x2), 80%', () => {
  const g = gPerSpindleHour(20000, 1109, 62, 80);
  close(g, 5.96, 0.005, 'g per spindle per hour');
  close(hoursPerDoff(900, g), 151, 0.5, 'hours per 900 g doff');
});

test('TFO delivery, new machine: 18,000 RPM, 70%, 600 g doff', () => {
  const g = gPerSpindleHour(18000, 1109, 62, 70);
  close(hoursPerDoff(600, g), 128, 0.5, 'hours per 600 g doff');
});

test('doff kg per side = 252 x doff g / 1000', () => {
  close(doffKgPerSide(252, 900), 226.8, 1e-9, 'old');
  close(doffKgPerSide(252, 600), 151.2, 1e-9, 'new');
});

test('loom metres per day', () => {
  close(loomMPerDay(1041, 93, 80), 1041 * 1440 * 0.93 / (80 * 39.37), 1e-9, 'm/day');
});

test('denier from Ne', () => {
  close(denier({ count: '60', count_unit: 'Ne' }), 88.58, 0.01, '60 Ne');
  assert.equal(denier({ count: '62', count_unit: 'D' }), 62);
});

const tabs = {
  Units: [{ id: 'u1', name: 'Weavelon 2', loom_eff_pct: '93', tfo_default_eff: '85' }],
  LoomGroups: [
    { id: 'g190p', unit_id: 'u1', reed_width_cm: '190', shedding: 'Plain', looms: '16' },
    { id: 'g280d', unit_id: 'u1', reed_width_cm: '280', shedding: 'Dobby', looms: '14' }
  ],
  Yarns: [
    { id: 'y08', name: '60/08 1109 TPM', kind: 'tpm', count: '62', count_unit: 'D', tpm: '1109' },
    { id: 'ysz', name: '60/24 SIZED', kind: 'base', count: '60', count_unit: 'D' },
    { id: 'yj', name: 'Jari', kind: 'base', count: '88', count_unit: 'D' }
  ],
  Fabrics: [
    { id: 'fo', name: 'organza twill', weave: 'Dobby', ppi: '80', reed_space_in: '50', warp_shortage_pct: '10', weft_shortage_pct: '10', loom_rpm: '1004', loom_rpm_dp: '700' },
    { id: 'ft', name: 'Tissue', weave: 'Plain', ppi: '74', reed_space_in: '64', warp_shortage_pct: '10', weft_shortage_pct: '10', loom_rpm: '975' }
  ],
  Assignments: [{ fabric_id: 'fo', unit_id: 'u1' }, { fabric_id: 'ft', unit_id: 'u1' }],
  FabricYarns: [
    { fabric_id: 'fo', side: 'warp', yarn_id: 'y08', ends: '4896', sort: '1' },
    { fabric_id: 'fo', side: 'weft', yarn_id: 'y08', parts: '1', sort: '2' },
    { fabric_id: 'ft', side: 'warp', yarn_id: 'ysz', ends: '5728', sort: '1' },
    { fabric_id: 'ft', side: 'weft', yarn_id: 'y08', parts: '37', sort: '2' },
    { fabric_id: 'ft', side: 'weft', yarn_id: 'yj', parts: '37', sort: '3' }
  ],
  FabricBeams: [{ fabric_id: 'fo', loom_group_id: 'g280d', beam_length_m: '3400' }],
  TfoTypes: [
    { id: 'tnew', unit_id: 'u1', name: 'New machines (13-16)', machines: '4', spindles_per_side: '252', efficiency: '70' },
    { id: 'told', unit_id: 'u1', name: 'Old machines (1-12)', machines: '12', spindles_per_side: '', efficiency: '80' }
  ],
  TfoSpeeds: [
    { unit_id: 'u1', tfo_type_id: 'told', yarn_id: 'y08', rpm: '20000' },
    { unit_id: 'u1', tfo_type_id: 'tnew', yarn_id: 'y08', rpm: '18000' }
  ]
};

test('master: machine numbers, defaults, weft shares, labels', () => {
  const M = buildMaster(tabs, 'u1');
  assert.equal(M.typeList[0].id, 'told');
  assert.equal(M.typeForMachine(12).id, 'told');
  assert.equal(M.typeForMachine(13).id, 'tnew');
  assert.equal(M.tfoTypes.told.spindles, 252);
  assert.equal(M.tfoTypes.told.doffG, 900);
  assert.equal(M.tfoTypes.tnew.doffG, 600);
  assert.equal(M.fabrics.fo.label, 'Organza Twill 50');
  assert.deepEqual(M.fabrics.ft.weft.map((w) => w.share), [0.5, 0.5]);
  assert.ok(fits(M.fabrics.fo, M.groups.g280d, 2));
  assert.ok(!fits(M.fabrics.fo, M.groups.g190p, 1), 'dobby fabric not on a plain loom');
  assert.ok(!fits(M.fabrics.ft, M.groups.g280d, 2), 'two 64" panels do not fit 280 cm');
});

test('Organza Twill 280 cm beam: 3,400 m needs about 252 kg of 60/08 1109 TPM, two old-machine side-doffs', () => {
  const M = buildMaster(tabs, 'u1');
  const kg = warpKgPerM(M, M.fabrics.fo, 2)[0].kg * 3400;
  close(kg, 252.3, 0.2, 'warp kg');
  assert.equal(Math.ceil(kg / doffKgPerSide(252, 900)), 2);
});

test('weft kg per metre splits PPI by parts and covers both pannas', () => {
  const M = buildMaster(tabs, 'u1');
  const w = weftKgPerM(M, M.fabrics.ft, 1);
  close(w[0].kg, 74 * 0.5 * 64 * 62 / 9e6 * 1.1, 1e-9, 'TPM weft');
  const w2 = weftKgPerM(M, M.fabrics.fo, 2);
  close(w2[0].kg, 80 * 100 * 62 / 9e6 * 1.1, 1e-9, 'double panna');
});

test('plan: run-out, changeover half day, warp dated lead time before, TPM latest doff, TFO arrival next day', () => {
  const M = buildMaster(tabs, 'u1');
  const mday = loomMPerDay(700, 93, 80);
  const rate = mday * 1.1;
  const st = {
    looms: [
      { loom_no: '60', loom_group_id: 'g280d', panna: '2', fabric_id: 'fo', beam_balance_m: String(rate * 4.5), balance_date: '2026-10-21' },
      { loom_no: '61', loom_group_id: 'g280d', panna: '2', fabric_id: 'fo', beam_balance_m: String(rate * 2.2), balance_date: '2026-10-21' }
    ],
    changeovers: [
      { loom_no: '60', date: '2026-10-25', to_fabric_id: 'fo', beam: 'new', beam_length_m: '' },
      { loom_no: '61', date: '2026-10-23', to_fabric_id: '', beam: 'none' }
    ],
    beamStock: [], yarnStock: [{ date: '2026-10-20', yarn_id: 'y08', kg: '1000' }], receipts: [],
    sides: [{ machine_no: '1', side: 'A', tfo_type_id: 'told', yarn_id: 'y08', loaded_at: '2026-10-20T00:00', next_yarn_id: 'y08' }]
  };
  const P = plan(M, st, { date: '2026-10-21', days: 7, lead: 1 });
  const L60 = P.looms.find((l) => l.no === 60);
  assert.equal(L60.runout, dayNum('2026-10-25'));
  const ev = L60.events[0];
  assert.equal(ev.kind, 'new');
  assert.equal(ev.len, 3400, 'beam length from FabricBeams');
  const w = ev.warp[0];
  assert.equal(w.needDay, dayNum('2026-10-24'));
  assert.equal(w.latestDoff, dayNum('2026-10-23'));
  assert.equal(w.sideDoffs, 2);
  // loom 61: half a day on 23 Oct, then idle
  const d23 = P.days[2];
  assert.equal(d23.idle, 0.5);
  assert.equal(P.days[3].idle, 1);
  // warp booked on 24 Oct (day 3)
  close(P.days[3].warp.y08, w.kg, 1e-6, 'warp booked on need day');
  // TFO: loaded 20 Oct 00:00, 151 h doff -> 26 Oct 07:00 -> day 5; arrives day 6
  const s = P.sides[0];
  assert.equal(s.ev[0].d, 5);
  close(P.days[6].arr.y08, 226.8, 1e-6, 'arrives next day');
  // opening stock from the latest entry on or before the plan date
  assert.equal(P.bal.y08.row[0].open, 1000);
});

test('receipts: daily average, indefinite, and fully received', () => {
  const D0 = dayNum('2026-10-21');
  const r = receiptInfo({ kind: 'yarn', mode: 'daily', start_date: '2026-10-22', days: '', qty: '50' }, D0);
  assert.equal(r.on(D0), 0); assert.equal(r.on(D0 + 1), 50); assert.equal(r.on(D0 + 30), 50); assert.equal(r.done, false);
  const r2 = receiptInfo({ kind: 'yarn', mode: 'daily', start_date: '2026-10-10', days: '5', qty: '50' }, D0);
  assert.equal(r2.done, true);
  const r3 = receiptInfo({ kind: 'yarn', mode: 'oneoff', start_date: '2026-10-23', qty: '300' }, D0);
  assert.equal(r3.on(D0 + 2), 300); assert.equal(r3.on(D0 + 3), 0);
});

// ---------- beam balance from production ----------
const prodLoom = (no, bal, date, extra = {}) => ({ loom_no: String(no), loom_group_id: 'g280d', panna: '2', fabric_id: 'fo', beam_balance_m: String(bal), balance_date: date, ...extra });

test('beam balance: loom with no production keeps its entered balance and forecasts from the balance date', () => {
  const b = beamBalance('3000', '2026-10-18', [], 10);
  assert.equal(b.cur, 3000); assert.equal(b.last, null); assert.equal(b.entries, 0);
  assert.equal(b.start, dayNum('2026-10-18'));
  const M = buildMaster(tabs, 'u1');
  const rate = loomMPerDay(700, 93, 80) * 1.1;
  const P = plan(M, { looms: [prodLoom(60, 3000, '2026-10-18')], production: [] }, { date: '2026-10-21', days: 7 });
  const L = P.looms[0];
  assert.equal(L.cur, 3000);
  assert.equal(L.runCalc, dayNum('2026-10-18') + Math.floor(3000 / rate));
  close(L.balToday, 3000 - rate * 3, 1e-6, 'balance today runs on from the balance date');
});

test('beam balance: three days of production, metres x (1 + warp shortage), forecast from the day after the last entry', () => {
  const prods = [
    { loom_no: '60', date: '2026-10-18', metres: '400' },
    { loom_no: '60', date: '2026-10-19', metres: '380' },
    { loom_no: '60', date: '2026-10-20', metres: '0' }
  ];
  const b = beamBalance('3000', '2026-10-18', prods, 10);
  close(b.cur, 3000 - 780 * 1.1, 1e-9, 'current balance');
  assert.equal(b.last, dayNum('2026-10-20'));
  assert.equal(b.start, dayNum('2026-10-21'));
  assert.equal(b.entries, 3);
  const M = buildMaster(tabs, 'u1');
  const rate = loomMPerDay(700, 93, 80) * 1.1;
  const P = plan(M, { looms: [prodLoom(60, 3000, '2026-10-18')], production: prods }, { date: '2026-10-21', days: 7 });
  const L = P.looms[0];
  close(L.cur, 3000 - 858, 1e-9, 'plan uses the current balance');
  assert.equal(L.runCalc, dayNum('2026-10-21') + Math.floor((3000 - 858) / rate));
  close(L.balToday, 3000 - 858, 1e-9, 'no forecast use before the plan date');
  // an overridden run-out date still wins
  const P2 = plan(M, { looms: [prodLoom(60, 3000, '2026-10-18', { runout_override: '2026-10-23' })], production: prods }, { date: '2026-10-21', days: 7 });
  assert.equal(P2.looms[0].runout, dayNum('2026-10-23'));
});

test('beam balance: production dated before the balance date is ignored', () => {
  const prods = [
    { loom_no: '60', date: '2026-10-16', metres: '500' },
    { loom_no: '60', date: '2026-10-17', metres: '500' },
    { loom_no: '61', date: '2026-10-19', metres: '500' }
  ];
  const M = buildMaster(tabs, 'u1');
  const P = plan(M, { looms: [prodLoom(60, 3000, '2026-10-18')], production: prods }, { date: '2026-10-21', days: 7 });
  const L = P.looms[0];
  assert.equal(L.cur, 3000);
  assert.equal(L.prod.last, null);
  assert.equal(L.prod.start, dayNum('2026-10-18'));
});

test('same-day yarn receipt counts in that day\'s stock', () => {
  const M = buildMaster(tabs, 'u1');
  const P = plan(M, { looms: [], yarnStock: [{ date: '2026-10-21', yarn_id: 'yj', kg: '10' }], receipts: [{ id: 'r1', kind: 'yarn', item: 'yj', mode: 'oneoff', start_date: '2026-10-21', qty: '40' }] }, { date: '2026-10-21', days: 3 });
  assert.equal(P.recs[0].done, false);
  assert.equal(P.bal.yj.row[0].rcpt, 40);
  assert.equal(P.bal.yj.row[0].close, 50);
});

test('power off: no yarn and no beam used while off; run-out moves later by the off days', () => {
  const M = buildMaster(tabs, 'u1');
  const rate = loomMPerDay(700, 93, 80) * 1.1;
  const run = { date: '2026-10-21', days: 7 };
  const on = plan(M, { looms: [prodLoom(60, 3000, '2026-10-21')], production: [] }, run);
  // off on 22 and 23 Oct, back on 24 Oct
  const off = plan(M, { looms: [prodLoom(60, 3000, '2026-10-21', { power_off_from: '2026-10-22', power_on_date: '2026-10-24' })], production: [] }, run);
  const n = Math.floor(3000 / rate);
  assert.equal(on.looms[0].runCalc, dayNum('2026-10-21') + n);
  assert.equal(off.looms[0].runCalc, dayNum('2026-10-21') + n + 2);
  assert.ok(on.days[1].weft.y08 > 0);
  assert.equal(off.days[1].weft.y08 || 0, 0, 'no weft on an off day');
  assert.equal(off.days[2].weft.y08 || 0, 0);
  close(off.days[3].weft.y08, on.days[3].weft.y08, 1e-9, 'back on: full weft again');
  assert.deepEqual(off.days[1].offLooms, [60]);
  assert.equal(Object.keys(off.days[1].fab).length, 0, 'not counted as running');
  assert.equal(off.looms[0].offToday, false);
});

test('power off with no back-on date: off from that day for the whole window, beam never runs out', () => {
  const M = buildMaster(tabs, 'u1');
  const P = plan(M, { looms: [prodLoom(60, 3000, '2026-10-18', { power_off_from: '2026-10-20' })], production: [] }, { date: '2026-10-21', days: 5 });
  const L = P.looms[0];
  const rate = loomMPerDay(700, 93, 80) * 1.1;
  assert.equal(L.runCalc, null);
  assert.ok(L.offToday && L.offForGood);
  close(L.balToday, 3000 - rate * 2, 1e-6, 'beam used only on the two days before power off');
  assert.ok(P.days.every((d) => d.off === 1 && !d.weft.y08));
});
