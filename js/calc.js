// TFO Planner calculations. Pure functions, no DOM: run in the browser and in node tests.
// Rules follow "TFO Planner for Weavelon 2: how it works". TFO RPM in TfoSpeeds is already x2.

export const UNIT_ID = 'u_mvdwlskosl2i';
export const DEF_SPINDLES = 252;

// ---------- small helpers ----------

export const num = (v) => {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

export const titleCase = (s) => String(s || '').trim().toLowerCase().replace(/(^|[\s\-(/])([a-z])/g, (m, a, b) => a + b.toUpperCase());

// days since epoch for 'YYYY-MM-DD' (or the date part of 'YYYY-MM-DDTHH:MM')
export const dayNum = (s) => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null;
};
export const dayStr = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
export const addDays = (s, k) => dayStr(dayNum(s) + k);

// hours of a 'YYYY-MM-DDTHH:MM' (or date-only) time after 00:00 of day d0
export const hoursFrom = (s, d0) => {
  const d = dayNum(s);
  if (d == null) return null;
  const m = /T(\d{1,2}):(\d{2})/.exec(String(s)) || / (\d{1,2}):(\d{2})/.exec(String(s));
  return (d - d0) * 24 + (m ? +m[1] + +m[2] / 60 : 0);
};

const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
const push = (o, k, v) => { (o[k] = o[k] || []).push(v); };

// ---------- formulas ----------

export function denier(y) {
  if (!y) return null;
  const c = num(y.count);
  if (!c) return null;
  const u = String(y.count_unit || 'D').trim().toLowerCase();
  if (u === 'ne') return 5315 / c;
  if (u === 'nm') return 9000 / c;
  if (u === 'tex') return c * 9;
  if (u === 'dtex') return c * 0.9;
  return c;
}

// loom (beam) metres per loom per day
export const loomMPerDay = (rpm, effPct, ppi) => (rpm && effPct && ppi ? (rpm * 1440 * effPct / 100) / (ppi * 39.37) : null);

// TFO delivery, g per spindle per hour. rpm is as recorded (already x2).
export const gPerSpindleHour = (rpm, tpm, den, effPct) => (rpm && tpm && den && effPct ? rpm / tpm * 60 * den / 9000 * effPct / 100 : null);
export const hoursPerDoff = (doffG, gph) => (doffG && gph ? doffG / gph : null);
export const doffKgPerSide = (spindles, doffG) => (spindles || DEF_SPINDLES) * (doffG || 0) / 1000;

export const defPanna = (g) => (g && g.width >= 250 ? 2 : 1);

// ---------- master ----------

export function buildMaster(tabs, unitId = UNIT_ID) {
  const T = (n) => (tabs && tabs[n]) || [];
  const unit = T('Units').find((u) => u.id === unitId) || T('Units').find((u) => /weavelon\s*2/i.test(u.name)) || { id: unitId, name: 'Weavelon 2' };
  const uid = unit.id;

  const groups = {};
  T('LoomGroups').filter((g) => g.unit_id === uid).forEach((g) => {
    const width = num(g.reed_width_cm);
    const dobby = /dobby/i.test(g.shedding || '');
    groups[g.id] = { id: g.id, width, dobby, shedding: dobby ? 'Dobby' : 'Plain', looms: num(g.looms), make: g.make || '', label: `${width} cm ${dobby ? 'dobby' : 'plain'}` };
  });
  const groupList = Object.values(groups).sort((a, b) => a.width - b.width || a.dobby - b.dobby);

  const yarns = {};
  T('Yarns').forEach((y) => {
    yarns[y.id] = {
      id: y.id, name: y.name, kind: y.kind, isTpm: String(y.kind).toLowerCase() === 'tpm' || num(y.tpm) > 0, den: denier(y), tpm: num(y.tpm), base: y.base_yarn_id || '',
      count: num(y.count), unit: String(y.count_unit || 'D').trim() || 'D', twist: y.twist || '', material: y.material || '', filaments: num(y.filaments)
    };
  });

  // a TPM yarn with no count of its own takes its base yarn's denier (as the Fabric Database app does)
  Object.values(yarns).forEach((y) => { if (y.den == null && y.base && yarns[y.base] && yarns[y.base].den != null) y.den = yarns[y.base].den; });

  const assigned = new Set(T('Assignments').filter((a) => a.unit_id === uid).map((a) => a.fabric_id));
  const lines = {};
  T('FabricYarns').forEach((l) => push(lines, l.fabric_id, l));
  const fabrics = {};
  T('Fabrics').filter((f) => assigned.has(f.id)).forEach((f) => {
    const ls = (lines[f.id] || []).slice().sort((a, b) => (num(a.sort) || 0) - (num(b.sort) || 0));
    const warp = ls.filter((l) => l.side === 'warp' && l.yarn_id).map((l) => ({ yarn_id: l.yarn_id, ends: num(l.ends) || 0 }));
    const wl = ls.filter((l) => l.side === 'weft' && l.yarn_id);
    const parts = wl.map((l) => num(l.parts));
    const known = parts.filter((p) => p > 0);
    const avg = known.length ? known.reduce((s, p) => s + p, 0) / known.length : 1;
    const filled = parts.map((p) => (p > 0 ? p : avg));
    const tot = filled.reduce((s, p) => s + p, 0) || 1;
    const weft = wl.map((l, i) => ({ yarn_id: l.yarn_id, share: filled[i] / tot, parts: parts[i] }));
    const rs = num(f.reed_space_in);
    fabrics[f.id] = {
      id: f.id, name: titleCase(f.name), rs, ppi: num(f.ppi), dobby: /dobby/i.test(f.weave || ''), weave: /dobby/i.test(f.weave || '') ? 'Dobby' : 'Plain',
      wsh: num(f.warp_shortage_pct) ?? 0, fsh: num(f.weft_shortage_pct) ?? 0,
      rpm1: num(f.loom_rpm), rpm2: num(f.loom_rpm_dp), warp, weft, note: f.design_note || '', endUse: f.end_use || '', rawWeave: f.weave || '',
      reed: num(f.reed), greige: num(f.greige_width_in),
      label: `${titleCase(f.name)}${rs ? ' ' + Math.round(rs) : ''}`
    };
  });
  const fabricList = Object.values(fabrics).sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));

  // TFO types: old machines first, machine numbers given out in that order (1-12 old, 13-16 new)
  const typesRaw = T('TfoTypes').filter((t) => t.unit_id === uid);
  const isNewName = (n) => /new|13/i.test(n || '');
  typesRaw.sort((a, b) => isNewName(a.name) - isNewName(b.name) || String(a.name).localeCompare(b.name));
  let mno = 1;
  const tfoTypes = {};
  const typeList = typesRaw.map((t) => {
    const isNew = isNewName(t.name);
    const machines = num(t.machines) || 0;
    const o = {
      id: t.id, name: t.name, isNew, machines, from: mno, to: mno + machines - 1,
      spindles: num(t.spindles_per_side) || DEF_SPINDLES, spindlesSet: num(t.spindles_per_side) != null,
      eff: num(t.efficiency), doffG: num(t.doff_g_per_spindle) || (isNew ? 600 : 900), doffSet: num(t.doff_g_per_spindle) != null
    };
    mno += machines;
    tfoTypes[t.id] = o;
    return o;
  });
  const typeForMachine = (n) => typeList.find((t) => n >= t.from && n <= t.to) || typeList[typeList.length - 1];

  const speeds = {};
  T('TfoSpeeds').filter((s) => s.unit_id === uid || !s.unit_id).forEach((s) => {
    speeds[s.tfo_type_id + '|' + s.yarn_id] = { rpm: num(s.rpm), eff: num(s.efficiency) };
  });

  const beams = T('FabricBeams').map((b) => ({ fabric_id: b.fabric_id, group_id: b.loom_group_id, len: num(b.beam_length_m) })).filter((b) => b.len);

  return {
    unit, uid, loomEff: num(unit.loom_eff_pct) || 93, tfoDefEff: num(unit.tfo_default_eff) || 85,
    groups, groupList, yarns, fabrics, fabricList, tfoTypes, typeList, typeForMachine, speeds, beams
  };
}

export const fabricRpm = (f, panna) => (f ? (panna >= 2 ? f.rpm2 : f.rpm1) : null);

// can fabric f run on loom group g at this panna? dobby only on dobby; panels must fit the reed
export function fits(f, g, panna) {
  if (!f || !g) return false;
  if (f.dobby && !g.dobby) return false;
  if (f.rs && g.width) return f.rs * panna <= g.width / 2.54 + 0.5;
  return true;
}

// weft kg per loom metre for each weft yarn, weft shortage included; reed space covers every panna
export function weftKgPerM(M, f, panna) {
  if (!f || !f.ppi || !f.rs) return [];
  return f.weft.map((w) => {
    const y = M.yarns[w.yarn_id];
    const den = y && y.den;
    return { yarn_id: w.yarn_id, kg: den ? f.ppi * w.share * f.rs * panna * den / 9000 / 1000 * (1 + f.fsh / 100) : 0, missing: !den };
  });
}

// warp kg per loom metre for each warp yarn, warp shortage included; ends are per panna
export function warpKgPerM(M, f, panna) {
  if (!f) return [];
  return f.warp.map((w) => {
    const y = M.yarns[w.yarn_id];
    const den = y && y.den;
    return { yarn_id: w.yarn_id, kg: den ? w.ends * panna * den / 9000 / 1000 * (1 + f.wsh / 100) : 0, missing: !den };
  });
}

// default beam length for a fabric on a loom group: that group, else any group of the same width
export function beamLen(M, fabricId, groupId) {
  const g = M.groups[groupId];
  const exact = M.beams.find((b) => b.fabric_id === fabricId && b.group_id === groupId);
  if (exact) return exact.len;
  const same = M.beams.find((b) => b.fabric_id === fabricId && M.groups[b.group_id] && g && M.groups[b.group_id].width === g.width);
  return same ? same.len : null;
}

export function tfoSpeed(M, typeId, yarnId) {
  const s = M.speeds[typeId + '|' + yarnId];
  const t = M.tfoTypes[typeId];
  const y = M.yarns[yarnId];
  if (!s || !s.rpm || !y) return null;
  const eff = s.eff || (t && t.eff) || M.tfoDefEff;
  const gph = gPerSpindleHour(s.rpm, y.tpm, y.den, eff);
  return gph ? { rpm: s.rpm, eff, gph, kgSpindleDay: gph * 24 / 1000 } : null;
}

// ---------- beam balance from production ----------

// The entered balance is at the start of its balance date. Production dated on or after that date
// uses metres x (1 + warp shortage); earlier entries are ignored. The forecast starts the day after
// the last production entry, or on the balance date when there is none.
// prods: [{ date | day, metres }] for one loom
export function beamBalance(bal, balanceDate, prods, wshPct) {
  const bdate = typeof balanceDate === 'number' ? balanceDate : dayNum(balanceDate);
  const k = 1 + (num(wshPct) || 0) / 100;
  let used = 0, last = null, entries = 0, metres = 0;
  (prods || []).forEach((p) => {
    const d = p.day ?? dayNum(p.date);
    const m = num(p.metres);
    if (d == null || m == null || bdate == null || d < bdate) return;
    used += m * k; metres += m; entries++;
    if (last == null || d > last) last = d;
  });
  const b = num(bal);
  return { cur: b == null ? null : b - used, used, metres, entries, last, start: last != null ? last + 1 : bdate };
}

// ---------- power off ----------

// A loom switched off from power_off_from until the day before power_on_date (blank = until switched back on).
// While off it uses no yarn and no beam, so its run-out moves later by the days it stands off.
export function powerOff(L) {
  const from = dayNum(L && L.power_off_from);
  if (from == null) return null;
  const on = dayNum(L.power_on_date);
  return { from, on: on != null && on > from ? on : null };
}
export const isOff = (po, day) => !!po && day >= po.from && (po.on == null || day < po.on);
// the day reached after n running days counted from day `start`, skipping days the loom is off;
// null when the loom is off for good before the beam is used up
export function runEnd(start, n, po) {
  if (start == null || n == null) return null;
  if (!po || n <= 0) return start + Math.max(n, 0);
  if (po.on == null) return po.from >= start + n ? start + n : null;
  // an off spell that begins before the beam is used up pushes the end out by its off days from start on
  if (po.from >= start + n) return start + n;
  return start + n + Math.max(0, po.on - Math.max(po.from, start));
}
// running days between day a (inclusive) and day b (exclusive)
export const onDays = (a, b, po) => {
  if (b <= a) return 0;
  if (!po) return b - a;
  const offEnd = po.on == null ? b : Math.min(po.on, b);
  return (b - a) - Math.max(0, offEnd - Math.max(po.from, a));
};

// ---------- plan ----------

// st: { looms, changeovers, beamStock, yarnStock, receipts, sides, production } as row objects (Planner tabs)
// opts: { date: 'YYYY-MM-DD', days: 3|5|7, lead: warping lead time in days }
export function plan(M, st, opts) {
  const H = opts.days || 7;
  const lead = opts.lead ?? 1;
  const D0 = dayNum(opts.date);
  const days = [...Array(H)].map((_, d) => ({
    d, day: D0 + d, weft: {}, warp: {}, warpLooms: {}, runWarp: {}, fab: {}, idle: 0, off: 0, offLooms: [], pend: [], doff: {}, doffSides: {}, arr: {}, rcpt: {}, tpend: []
  }));
  const flags = { noRpm: new Set(), noLen: new Set(), noFabric: [] };

  // ---- beam lots (stock and beam receipts) ----
  const lots = {};
  (st.beamStock || []).forEach((b) => {
    lots['lot:' + b.id] = {
      key: 'lot:' + b.id, src: 'stock', row: b, fabric_id: b.fabric_id, group_id: b.loom_group_id,
      beams: Math.max(0, Math.round(num(b.beams) || 0)), len: num(b.length_m) || beamLen(M, b.fabric_id, b.loom_group_id), arrive: null, used: []
    };
  });
  const recs = (st.receipts || []).map((r) => receiptInfo(r, D0));
  recs.filter((r) => r.kind === 'beam' && !r.done).forEach((r) => {
    const [fid, gid] = String(r.row.item || '').split('@');
    const count = r.mode === 'daily' ? Math.round((r.qty || 0) * (r.days || H)) : Math.round(r.qty || 0);
    lots['rcpt:' + r.row.id] = {
      key: 'rcpt:' + r.row.id, src: 'receipt', row: r.row, fabric_id: fid, group_id: gid, beams: count,
      len: num(r.row.length_m) || beamLen(M, fid, gid), arrive: Math.max(r.start, D0), used: []
    };
  });

  // ---- looms ----
  const coBy = {}, prodBy = {};
  (st.changeovers || []).forEach((c) => push(coBy, String(num(c.loom_no)), c));
  (st.production || []).forEach((p) => push(prodBy, String(num(p.loom_no)), p));
  const looms = (st.looms || []).slice().sort((a, b) => num(a.loom_no) - num(b.loom_no)).map((L) => {
    const g = M.groups[L.loom_group_id];
    const panna = num(L.panna) || defPanna(g);
    const f = M.fabrics[L.fabric_id] || null;
    const rpm = fabricRpm(f, panna);
    const mday = f ? loomMPerDay(rpm, M.loomEff, f.ppi) : null;
    if (f && !mday) flags.noRpm.add(f.id + '|' + panna);
    const bal = num(L.beam_balance_m);
    const bdate = dayNum(L.balance_date) ?? D0;
    const prod = beamBalance(bal, bdate, prodBy[String(num(L.loom_no))], f ? f.wsh : 0);
    const curBal = prod.cur == null ? null : Math.max(0, prod.cur);
    const rate = mday && f ? mday * (1 + f.wsh / 100) : null;
    const po = powerOff(L);
    const runCalc = f && rate && curBal != null ? runEnd(prod.start, Math.floor(curBal / rate), po) : null;
    const ovr = dayNum(L.runout_override);
    const runRaw = ovr ?? runCalc;
    const balToday = curBal != null && rate ? Math.max(0, curBal - rate * onDays(prod.start, D0, po)) : curBal;
    const o = { row: L, no: num(L.loom_no), g, panna, f, rpm, mday, bal, bdate, cur: curBal, prod, overRun: prod.cur != null && prod.cur < 0, balToday, runCalc, ovr, runout: runRaw, overdue: runRaw != null && runRaw < D0, events: [], segs: [], po, offToday: isOff(po, D0), offForGood: !!po && po.on == null && po.from <= D0 };

    const cos = (coBy[String(o.no)] || []).filter((c) => {
      const cd = dayNum(c.date);
      return cd != null && (cd > bdate || (runRaw != null && runRaw <= bdate));
    }).sort((a, b) => dayNum(a.date) - dayNum(b.date));

    let cur = { start: -Infinity, end: f ? (runRaw == null ? null : Math.max(runRaw, D0)) : null, f, panna, mday, rpm, first: true };
    o.segs.push(cur);
    for (const co of cos) {
      let eday;
      if (cur.f) { if (cur.end == null) break; eday = cur.end; } else { eday = Math.max(dayNum(co.date), D0); }
      cur.end = eday;
      const toNone = co.beam === 'none' || !co.to_fabric_id;
      const nf = toNone ? null : M.fabrics[co.to_fabric_id] || null;
      const ev = { co, day: eday, from: cur.f, to: nf, kind: toNone ? 'none' : String(co.beam || 'new').startsWith('lot:') || String(co.beam || '').startsWith('rcpt:') ? 'lot' : 'new', overdue: cur.first && o.overdue };
      let len = null;
      if (nf) {
        if (ev.kind === 'lot') {
          const lot = lots[co.beam];
          ev.lot = lot || null;
          if (lot) { lot.used.push({ loom: o.no, day: eday, co }); len = num(co.beam_length_m) || lot.len; ev.lotLate = lot.arrive != null && lot.arrive > eday; }
          else ev.lotMissing = true;
        } else {
          len = num(co.beam_length_m) || beamLen(M, nf.id, L.loom_group_id);
        }
        ev.len = len;
        if (!len) flags.noLen.add(o.no);
        if (ev.kind === 'new' && len) {
          const wk = warpKgPerM(M, nf, panna);
          const need = eday - lead;
          ev.warp = wk.map((w) => {
            const y = M.yarns[w.yarn_id];
            return { yarn_id: w.yarn_id, kg: w.kg * len, needDay: need, latestDoff: need - 1, tpm: !!(y && y.isTpm), overdue: need < D0 };
          });
          ev.warp.forEach((w) => {
            const di = Math.max(w.needDay - D0, 0);
            if (di < H) { add(days[di].warp, w.yarn_id, w.kg); push(days[di].warpLooms, w.yarn_id, o.no); }
          });
        }
      }
      o.events.push(ev);
      const nrpm = fabricRpm(nf, panna);
      const nmday = nf ? loomMPerDay(nrpm, M.loomEff, nf.ppi) : null;
      if (nf && !nmday) flags.noRpm.add(nf.id + '|' + panna);
      const nend = nf && nmday && len ? runEnd(eday, Math.floor(len / (nmday * (1 + nf.wsh / 100))), po) : null;
      cur = { start: eday, end: nend, f: nf, panna, mday: nmday, rpm: nrpm, co };
      o.segs.push(cur);
    }
    // a beam that runs out with nothing chosen to follow it
    o.open = cur.f && cur.end != null ? cur.end : null;
    if (!f && !cos.length) flags.noFabric.push(o.no);

    // ---- day by day ----
    for (let d = 0; d < H; d++) {
      const day = D0 + d, D = days[d];
      if (isOff(po, day)) { D.off += 1; D.offLooms.push(o.no); continue; } // switched off: no yarn, no beam
      let used = 0;
      for (const s of o.segs) {
        let share = 0;
        if (day > s.start && (s.end == null || day < s.end)) share = 1;
        else if (day === s.start || day === s.end) share = 0.5;
        if (s.end != null && s.start === s.end && day === s.start) share = 0; // zero-length beam
        if (!share) continue;
        if (s.end === day && s === cur && day === o.open) { D.pend.push(o.no); }
        used += share;
        if (!s.f) { D.idle += share; continue; }
        const k = s.f.id + '|' + s.panna;
        const fr = D.fab[k] || (D.fab[k] = { f: s.f, panna: s.panna, rpm: s.rpm, mday: s.mday, looms: 0, plain: 0, dobby: 0, weft: {}, warp: {}, list: [] });
        fr.looms += share;
        fr.list.push({ no: o.no, id: L.id, share });
        if (g && g.dobby) fr.dobby += share; else fr.plain += share;
        if (!s.mday) continue;
        weftKgPerM(M, s.f, s.panna).forEach((w) => { const v = share * s.mday * w.kg; add(D.weft, w.yarn_id, v); add(fr.weft, w.yarn_id, v); });
        warpKgPerM(M, s.f, s.panna).forEach((w) => { const v = share * s.mday * w.kg; add(D.runWarp, w.yarn_id, v); add(fr.warp, w.yarn_id, v); });
      }
      if (used < 1 && day >= (o.open ?? Infinity)) D.idle += 1 - used; // ran out with no next fabric
    }
    return o;
  });

  // ---- receipts ----
  recs.filter((r) => r.kind === 'yarn').forEach((r) => {
    for (let d = 0; d < H; d++) { const q = r.on(D0 + d); if (q) add(days[d].rcpt, r.row.item, q); }
  });

  // ---- TFO sides ----
  const sides = (st.sides || []).slice().sort((a, b) => num(a.machine_no) - num(b.machine_no) || String(a.side).localeCompare(b.side)).map((s) => {
    const no = num(s.machine_no);
    const t = M.tfoTypes[s.tfo_type_id] || M.typeForMachine(no);
    const o = { row: s, no, side: s.side, t, kg: t ? doffKgPerSide(t.spindles, t.doffG) : 0, ev: [], noSpeed: false };
    if (!t || !s.yarn_id) return o;
    let tt = hoursFrom(s.loaded_at, D0);
    let y = s.yarn_id;
    if (tt == null) { o.noLoad = true; return o; }
    for (let i = 0; i < 60 && y; i++) {
      const sp = tfoSpeed(M, t.id, y);
      if (!sp) { if (i === 0) o.noSpeed = true; else o.nextNoSpeed = true; break; }
      const hpd = hoursPerDoff(t.doffG, sp.gph);
      tt += hpd;
      const over = tt < 0;
      if (over) tt = 0;
      const d = Math.floor(tt / 24);
      o.ev.push({ t: tt, d, yarn_id: y, over, hpd, kg: o.kg });
      if (d >= H) break;
      add(days[d].doff, y, o.kg); push(days[d].doffSides, y, `${no}${s.side}`);
      if (d + 1 < H) add(days[d + 1].arr, y, o.kg);
      if (!s.next_yarn_id) { days[d].tpend.push(`${no}${s.side}`); break; }
      y = s.next_yarn_id;
    }
    return o;
  });

  // ---- yarn stock opening ----
  const opening = {};
  (st.yarnStock || []).forEach((r) => {
    const d = dayNum(r.date);
    if (d == null || d > D0) return;
    const cur = opening[r.yarn_id];
    if (!cur || d > cur.day || (d === cur.day && String(r.updated_at || '') > String(cur.row.updated_at || ''))) opening[r.yarn_id] = { day: d, kg: num(r.kg) || 0, row: r };
  });

  // ---- yarns in play ----
  const ys = new Set();
  Object.values(M.fabrics).forEach((f) => { f.warp.forEach((w) => ys.add(w.yarn_id)); f.weft.forEach((w) => ys.add(w.yarn_id)); });
  Object.keys(M.speeds).forEach((k) => ys.add(k.split('|')[1]));
  Object.keys(opening).forEach((y) => ys.add(y));
  recs.filter((r) => r.kind === 'yarn').forEach((r) => ys.add(r.row.item));
  sides.forEach((s) => { if (s.row.yarn_id) ys.add(s.row.yarn_id); if (s.row.next_yarn_id) ys.add(s.row.next_yarn_id); });
  const yarnIds = [...ys].filter((y) => M.yarns[y]);

  // ---- balances ----
  const bal = {};
  yarnIds.forEach((y) => {
    let b = opening[y] ? opening[y].kg : 0, first = null, cover = null, need = 0, low = 0;
    const row = [];
    for (let d = 0; d < H; d++) {
      const D = days[d];
      const wf = D.weft[y] || 0, wp = D.warp[y] || 0, a = D.arr[y] || 0, r = D.rcpt[y] || 0;
      const open = b, n = wf + wp;
      b = open + a + r - n;
      need += n;
      if (b < -0.05 && first == null) { first = d; cover = d + (n ? Math.max(open + a + r, 0) / n : 0); }
      low = Math.min(low, b);
      row.push({ open, arr: a, rcpt: r, weft: wf, warp: wp, need: n, close: b });
    }
    if (first == null && need > 0) cover = H + b / (need / H);
    bal[y] = { row, first, cover, need, avg: need / H, short: -low, opening: opening[y] || null };
  });

  // ---- spindles per TPM yarn ----
  const spindles = {};
  yarnIds.filter((y) => M.yarns[y].isTpm).forEach((y) => {
    const on = sides.filter((s) => s.row.yarn_id === y && s.t);
    let given = 0, cap = 0;
    on.forEach((s) => { const sp = tfoSpeed(M, s.t.id, y); if (sp) { given += s.t.spindles; cap += s.t.spindles * sp.kgSpindleDay; } });
    let kgps = given ? cap / given : null;
    if (!kgps) { const t = M.typeList.find((t) => tfoSpeed(M, t.id, y)); if (t) kgps = tfoSpeed(M, t.id, y).kgSpindleDay; }
    const req = bal[y] ? bal[y].avg : 0;
    const needed = kgps ? req / kgps : null;
    spindles[y] = { sides: on.length, given, cap, req, kgps, needed, surSp: needed == null ? null : given - needed, surKg: cap - req };
  });

  // ---- TPM warp beams: covered or short ----
  looms.forEach((o) => o.events.forEach((ev) => (ev.warp || []).forEach((w) => {
    const sideKg = sidesKgFor(M, sides, w.yarn_id);
    w.sideDoffs = sideKg && w.tpm ? Math.ceil(w.kg / sideKg - 1e-9) : null;
    w.sideKg = sideKg;
    const di = Math.max(w.needDay - D0, 0);
    if (di < H && bal[w.yarn_id]) w.covered = bal[w.yarn_id].row[di].close >= -0.05;
    else w.covered = null;
  })));

  return { D0, H, lead, days, looms, lots, recs, sides, opening, yarnIds, bal, spindles, flags };
}

// doff kg of a side that would twist this yarn: a side already on it, else the first type with a speed
function sidesKgFor(M, sides, y) {
  const s = sides.find((s) => s.row.yarn_id === y && s.t);
  if (s) return s.kg;
  const t = M.typeList.find((t) => tfoSpeed(M, t.id, y)) || M.typeList[0];
  return t ? doffKgPerSide(t.spindles, t.doffG) : null;
}

// a receipt: when it arrives, whether it is fully received by the plan date
export function receiptInfo(r, D0) {
  const start = dayNum(r.start_date);
  const mode = r.mode === 'daily' ? 'daily' : 'oneoff';
  const qty = num(r.qty) || 0;
  const daysN = num(r.days);
  const last = mode === 'oneoff' ? start : daysN ? start + daysN - 1 : null;
  const done = start != null && last != null && last < D0;
  const on = (day) => {
    if (start == null) return 0;
    if (mode === 'oneoff') return day === start ? qty : 0;
    return day >= start && (last == null || day <= last) ? qty : 0;
  };
  return { row: r, kind: r.kind === 'beam' ? 'beam' : 'yarn', mode, start, qty, days: daysN, last, done, on };
}
