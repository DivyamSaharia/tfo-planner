// Searchable picker (same look as the Fabric Database app's SearchPicker).
// Tap the field: a sheet opens with a search box; several words, all must match ("tpm 1650").
// Keyboard: type to filter, Up/Down to move, Enter to choose, Esc or Close to cancel.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHEV = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SEARCH = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m10.4 10.4 3.4 3.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

// all words must appear in the text
export const matches = (text, q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean).every((t) => String(text).toLowerCase().includes(t));

// the field that opens the picker; attrs are data-* attributes that tell the app what to save
export function pickBtn({ label, text, empty, id, attrs = {}, need = false }) {
  const data = Object.entries(attrs).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<button type="button" class="pick-btn${empty ? ' empty' : ''}${need ? ' need' : ''}"${id ? ` id="${esc(id)}"` : ''} data-act="pick"${data} aria-haspopup="dialog" aria-label="${esc(label)}${empty ? '' : ': ' + esc(text)}"><span>${esc(text)}</span>${CHEV}</button>`;
}

let dlg, state = null;

function ensure() {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'picker';
  dlg.className = 'picker';
  dlg.innerHTML = `<div class="pick-wrap">
    <div class="sheet-head"><h2 id="pick-title"></h2><button type="button" class="btn quiet small" data-pclose>Close</button></div>
    <label class="search">${SEARCH}<input type="search" id="pick-q" autocomplete="off" enterkeyhint="done" spellcheck="false"></label>
    <div class="pick-list" id="pick-list" role="listbox"></div>
  </div>`;
  document.body.appendChild(dlg);
  const q = dlg.querySelector('#pick-q');
  q.addEventListener('input', () => { state.active = 0; draw(); });
  q.addEventListener('keydown', (e) => {
    const opts = [...dlg.querySelectorAll('.pick-opt')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!opts.length) return;
      state.active = (state.active + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
      mark(opts);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = opts[state.active] || opts[0];
      if (o) choose(o.dataset.pv);
    }
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-pclose]')) { closePicker(); return; }
    const o = e.target.closest('.pick-opt');
    if (o) choose(o.dataset.pv);
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closePicker(); });
  return dlg;
}

function mark(opts) {
  opts.forEach((o, i) => o.classList.toggle('act', i === state.active));
  const a = opts[state.active];
  if (a) { a.scrollIntoView({ block: 'nearest' }); dlg.querySelector('#pick-q').setAttribute('aria-activedescendant', a.id); }
}

function draw() {
  const q = dlg.querySelector('#pick-q').value;
  let n = 0, html = '';
  if (state.blank && !q.trim()) html += `<div><button type="button" class="pick-opt muted${state.value === '' ? ' on' : ''}" id="po-${n++}" data-pv="" role="option">${esc(state.blank)}</button></div>`;
  state.groups.forEach((g) => {
    const hits = g.options.filter((o) => matches(o.label + ' ' + (o.search || ''), q));
    if (!hits.length) return;
    html += `<div>${g.group ? `<div class="pick-group">${esc(g.group)}</div>` : ''}${hits.map((o) => `<button type="button" class="pick-opt${o.value === state.value ? ' on' : ''}" id="po-${n++}" data-pv="${esc(o.value)}" role="option"><span>${esc(o.label)}</span>${o.note ? `<span class="pick-note">${esc(o.note)}</span>` : ''}</button>`).join('')}</div>`;
  });
  if (!n) html = `<div class="pick-none">No match for “${esc(q)}”</div>`;
  const list = dlg.querySelector('#pick-list');
  list.innerHTML = html;
  mark([...list.querySelectorAll('.pick-opt')]);
}

function choose(v) {
  const s = state;
  closePicker();
  s.onPick(v);
}

export const pickerOpen = () => !!(dlg && dlg.open);

export function closePicker() {
  if (!dlg || !dlg.open) return;
  const back = state && state.back;
  dlg.close();
  state = null;
  if (back && back.isConnected) back.focus({ preventScroll: true });
}

// groups: [{ group, options: [{ value, label, note, search }] }]; blank: label for "none" (optional)
export function openPicker({ title, value = '', groups, blank = '', onPick, back }) {
  ensure();
  state = { value: value || '', groups, blank, onPick, back, active: 0 };
  dlg.querySelector('#pick-title').textContent = title;
  const q = dlg.querySelector('#pick-q');
  q.value = '';
  q.placeholder = 'Search, e.g. tpm 1650';
  q.setAttribute('aria-label', 'Search ' + title);
  draw();
  // start on the current choice
  const opts = [...dlg.querySelectorAll('.pick-opt')];
  const i = opts.findIndex((o) => o.dataset.pv === state.value);
  if (i >= 0) state.active = i;
  if (!dlg.open) dlg.showModal();
  mark(opts);
  // a phone without a keyboard should not pop one up straight away
  if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) q.focus();
}
