// Talks to the TFO Planner Apps Script web app. Body is JSON sent as text/plain (no CORS preflight).
export const DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbyvlnZwwa7GYkmeRaMrjxCW9zwEfMPLaFcku5OKT32lbcK0MOnuJ1acfuLgt1mz-fVoiQ/exec';

const LS = { url: 'tfo.url', key: 'tfo.key', cache: 'tfo.cache', user: 'tfo.user', role: 'tfo.role' };
const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } };

export const conf = {
  get url() { return get(LS.url) || DEFAULT_URL; },
  set url(v) { set(LS.url, v && v !== DEFAULT_URL ? v : null); },
  get key() { return get(LS.key) || ''; },
  set key(v) { set(LS.key, v || null); },
  get user() { return get(LS.user) || ''; },
  set user(v) { set(LS.user, v || null); },
  get role() { return get(LS.role) || ''; },
  set role(v) { set(LS.role, v || null); }
};

export function readCache() {
  try { const c = JSON.parse(get(LS.cache) || 'null'); return c && c.tabs ? c : null; } catch (e) { return null; }
}
export function writeCache(tabs) {
  try { set(LS.cache, JSON.stringify({ at: new Date().toISOString(), tabs })); } catch (e) { /* too big or blocked */ }
}

async function post(body) {
  if (!conf.key) throw new Error('Enter your planner key in Settings.');
  let res;
  try {
    res = await fetch(conf.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: conf.key, ...body }), redirect: 'follow' });
  } catch (e) {
    throw new Error('Could not reach the sheet. Check the connection.');
  }
  const text = await res.text();
  let out;
  try { out = JSON.parse(text); } catch (e) { throw new Error('The script did not answer with data. Check the Apps Script URL in Settings.'); }
  if (!out.ok) throw new Error(out.error || 'The sheet refused the request.');
  if (out.user) conf.user = out.user;
  if (out.role) conf.role = out.role;
  return out;
}

export const load = () => post({ action: 'load' });
export const save = (changes) => post({ action: 'save', changes });

// People with access (owner only): each person has their own key, so every edit carries their name.
export const people = {
  list: () => post({ action: 'people' }).then((o) => o.people),
  add: (name) => post({ action: 'addPerson', name }),
  rename: (id, name) => post({ action: 'renamePerson', id, name }).then((o) => o.people),
  remove: (id) => post({ action: 'removePerson', id }).then((o) => o.people)
};
