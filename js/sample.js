// Sample starting position for Weavelon 2, built from the real master ids.
// Every row id starts with "smp_" and carries notes "sample" where the tab has a notes column.
import { plan, loomMPerDay, fabricRpm, weftKgPerM, warpKgPerM, tfoSpeed, hoursPerDoff, addDays, dayNum, dayStr } from './calc.js';

const F = {
  nc53: 'f_mvgig63l89g1', nc67: 'f_mvgig63pg5i3', nc74: 'f_mvgne94s8x05', tis64: 'f_mvgig64mgmi8', tisg50: 'f_mvgig64r8ova',
  gs64: 'f_mvgig63tfc5n', gs73: 'f_mvgig63xrhbj', gs41: 'f_mvgig6414tkx', sb70: 'f_mvgig6450w8e', sb54: 'f_mvgig64bn9wd',
  sal54: 'f_mvgig64heavr', ot50: 'f_mvhq3i4rlp91', rt54: 'f_mvgig63hjeal'
};
const G = { p190: 'lg_mvdwlskoejlg', d190: 'lg_w2_190dobby', p280: 'lg_w2_280plain', d280: 'lg_mvdwlskopkjb' };

// loom group -> [fabric, looms]
const LAYOUT = [
  [G.p190, [[F.nc67, 6], [F.nc74, 4], [F.tis64, 6]]],
  [G.d190, [[F.gs64, 8], [F.gs73, 6], [F.sb70, 6], [F.nc53, 4]]],
  [G.p280, [[F.sal54, 6], [F.tisg50, 6], [F.nc53, 6]]],
  [G.d280, [[F.gs41, 4], [F.sb54, 4], [F.ot50, 3], [F.rt54, 3]]]
];

const pad = (n) => String(n).padStart(2, '0');

export function makeSample(M, date) {
  const uid = M.uid;
  let seed = 20261021;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const S = 'sample', by = 'sample';
  const base = { unit_id: uid, updated_at: new Date().toISOString(), updated_by: by };

  // ---- looms: days of beam left spread from under 1 day to about 3 weeks ----
  // Balances were measured three days before the plan date; production since then is entered per loom.
  const bdate = addDays(date, -3);
  const looms = [], production = [];
  let no = 1;
  LAYOUT.forEach(([gid, list]) => {
    const g = M.groups[gid];
    const panna = g && g.width >= 250 ? 2 : 1;
    list.forEach(([fid, n]) => {
      const f = M.fabrics[fid];
      for (let i = 0; i < n; i++) {
        const mday = loomMPerDay(fabricRpm(f, panna), M.loomEff, f.ppi) || 400;
        const daysLeft = 0.6 + rnd() * 19;
        let used = 0;
        for (let k = 0; k < 3; k++) {
          if (no % 11 === 5 && k === 2) continue; // a few looms not entered yet for the last day
          const m = Math.round(mday * (0.88 + rnd() * 0.16) / 10) * 10;
          used += m * (1 + f.wsh / 100);
          production.push({ ...base, id: `smp_pr_${pad(no)}_${k}`, date: addDays(bdate, k), loom_no: String(no), metres: String(m), notes: S });
        }
        const bal = Math.round((daysLeft * mday * (1 + f.wsh / 100) + used) / 10) * 10;
        looms.push({ ...base, id: 'smp_lm_' + pad(no), loom_no: String(no), loom_group_id: gid, panna: String(panna), fabric_id: fid, beam_balance_m: String(bal), balance_date: bdate, runout_override: '', notes: S });
        no++;
      }
    });
  });
  // one loom with its run-out date overwritten
  looms[20].runout_override = addDays(date, 6);

  // ---- beam stock ----
  const beamStock = [
    { ...base, id: 'smp_bs_01', fabric_id: F.gs64, loom_group_id: G.d190, beams: '2', length_m: '5200', notes: S },
    { ...base, id: 'smp_bs_02', fabric_id: F.tis64, loom_group_id: G.p190, beams: '2', length_m: '6400', notes: S },
    { ...base, id: 'smp_bs_03', fabric_id: F.nc53, loom_group_id: G.p280, beams: '1', length_m: '4600', notes: S },
    { ...base, id: 'smp_bs_04', fabric_id: F.sb70, loom_group_id: G.d190, beams: '1', length_m: '9000', notes: S }
  ];

  // ---- receipts: a yarn lot, a daily yarn supply and an outside beam ----
  const receipts = [
    { ...base, id: 'smp_rc_01', kind: 'yarn', item: 'y_mvgf6t827a34', mode: 'oneoff', start_date: addDays(date, 2), days: '', qty: '300', length_m: '', source: 'Outside twister', notes: S },
    { ...base, id: 'smp_rc_02', kind: 'yarn', item: 'y_mvgfrkvq13ya', mode: 'daily', start_date: addDays(date, 1), days: '10', qty: '150', length_m: '', source: 'Sizing supplier', notes: S },
    { ...base, id: 'smp_rc_03', kind: 'beam', item: F.sal54 + '@' + G.p280, mode: 'oneoff', start_date: addDays(date, 2), days: '', qty: '1', length_m: '6000', source: 'Outside sizing', notes: S }
  ];

  // ---- changeovers on looms whose beams run out in the next 7 days ----
  const P0 = plan(M, { looms, production, changeovers: [], beamStock, yarnStock: [], receipts, sides: [] }, { date, days: 7, lead: 1 });
  const D0 = dayNum(date);
  const soon = P0.looms.filter((l) => l.runout != null && l.runout >= D0 + 1 && l.runout < D0 + 7).sort((a, b) => a.runout - b.runout);
  const pick = (pred) => { const i = soon.findIndex(pred); return i < 0 ? null : soon.splice(i, 1)[0]; };
  const changeovers = [];
  const co = (l, to, beam, len, note) => l && changeovers.push({ ...base, id: 'smp_co_' + pad(changeovers.length + 1), loom_no: String(l.no), date: dayStr(l.runout), to_fabric_id: to, beam, beam_length_m: len ? String(len) : '', notes: note ? S + ' · ' + note : S });
  co(pick((l) => l.row.loom_group_id === G.d280 && l.runout >= D0 + 4), F.ot50, 'new', 3400, 'TPM warp beam');
  co(pick((l) => l.row.loom_group_id === G.d280 && l.runout >= D0 + 3), F.rt54, 'new', 4500, 'TPM warp beam');
  co(pick((l) => l.row.loom_group_id === G.d190), F.gs64, 'lot:smp_bs_01', '', '');
  co(pick((l) => l.row.loom_group_id === G.p190), '', 'none', '', 'loom idle');
  co(pick((l) => l.row.loom_group_id === G.p280 && l.runout >= D0 + 2), F.sal54, 'rcpt:smp_rc_03', '', 'outside beam');
  co(pick((l) => l.row.loom_group_id === G.p190), F.nc67, 'new', 5400, '');

  // ---- TFO sides, shared out by weft need ----
  const P1 = plan(M, { looms, production, changeovers, beamStock, yarnStock: [], receipts, sides: [] }, { date, days: 7, lead: 1 });
  const tpm = P1.yarnIds.filter((y) => M.yarns[y].isTpm);
  const need = Object.fromEntries(tpm.map((y) => [y, P1.bal[y] ? P1.bal[y].avg : 0]));
  const old = M.typeList.find((t) => !t.isNew), neu = M.typeList.find((t) => t.isNew);
  const sides = [];
  const slots = [];
  M.typeList.forEach((t) => { for (let m = t.from; m <= t.to; m++) ['A', 'B'].forEach((s) => slots.push({ m, s, t })); });
  // what each side gets: old machines cover every yarn; new machines only yarns they have a speed for
  const left = { ...need };
  const order = [];
  slots.forEach((sl) => {
    const opts = tpm.filter((y) => tfoSpeed(M, sl.t.id, y));
    opts.sort((a, b) => (left[b] || 0) - (left[a] || 0));
    const y = opts[0];
    order.push({ ...sl, y });
    const sp = tfoSpeed(M, sl.t.id, y);
    left[y] = (left[y] || 0) - sl.t.spindles * sp.kgSpindleDay;
  });
  order.forEach((o, i) => {
    const sp = tfoSpeed(M, o.t.id, o.y);
    const hpd = hoursPerDoff(o.t.doffG, sp.gph);
    const back = Math.round(rnd() * hpd * 0.95 + 4);
    const t0 = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), 8) - back * 36e5);
    const loaded = t0.toISOString().slice(0, 13) + ':00';
    const nextBlank = i % 9 === 4;
    sides.push({ ...base, id: `smp_tf_${pad(o.m)}${o.s}`, machine_no: String(o.m), side: o.s, tfo_type_id: o.t.id, yarn_id: o.y, loaded_at: loaded, next_yarn_id: nextBlank ? '' : o.y });
  });

  // ---- yarn stock for every yarn in use: two to five days of need, a few TPM yarns kept low ----
  const P2 = plan(M, { looms, production, changeovers, beamStock, yarnStock: [], receipts, sides }, { date, days: 7, lead: 1 });
  const yarnStock = P2.yarnIds.map((y, i) => {
    const b = P2.bal[y];
    const day = b ? Math.max(b.avg, (b.row[0] && b.row[0].need) || 0) : 0;
    const low = M.yarns[y].isTpm && i % 3 === 0;
    const kg = day ? Math.round(day * (low ? 0.8 : 2 + rnd() * 3) / 10) * 10 : Math.round(50 + rnd() * 150);
    return { ...base, id: 'smp_ys_' + y, date, yarn_id: y, kg: String(kg) };
  });

  const settings = [
    { ...base, id: 'set_window', key: 'window', value: '7' },
    { ...base, id: 'set_lead_days', key: 'lead_days', value: '1' }
  ];

  return {
    PlannerLooms: looms, PlannerChangeovers: changeovers, PlannerBeamStock: beamStock, PlannerYarnStock: yarnStock,
    PlannerReceipts: receipts, PlannerTfoSides: sides, PlannerSettings: settings, PlannerProduction: production
  };
}
