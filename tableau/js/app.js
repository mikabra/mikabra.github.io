// Tableau maker: UI wiring.

import * as M from './model.js';
import { buildGrids, markFor, freezeAuto } from './grid.js';
import { layoutGrid, stackScenes, toSVG, toCanvas, loadFont, embeddedFontCSS } from './render.js';
import { latexCode, typstCode } from './export.js';
import { docsCode, markdownCode } from './docs.js';
import { hasseGraph, layoutHasse, hasseTikz, hasseTypst } from './hasse.js';
import * as IO from './io.js';
import * as IPA from './ipa.js';
import { SYMBOLS } from './rich.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STORE_KEY = 'tableau-maker-state';
let state;
let shadeMode = false;   // 'Shade cells' tool: clicking violation cells toggles shading
let page = 'tableau';    // 'tableau' | 'hasse'

// ---------------------------------------------------------------------------
// History and persistence

const undoStack = [];
const redoStack = [];
let typingTimer = null;

function pushUndo() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}

// Group a burst of keystrokes into one undo step.
function beginTyping() {
  if (!typingTimer) pushUndo();
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => { typingTimer = null; }, 800);
}

function restore(json) {
  state = M.normalize(JSON.parse(json));
  renderAll();
  save();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(state));
  restore(undoStack.pop());
  updateHistoryButtons();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(state));
  restore(redoStack.pop());
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('#undo').disabled = !undoStack.length;
  $('#redo').disabled = !redoStack.length;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }, 300);
}

// Apply a structural change: undo point, re-render everything.
function change(fn, focusSel) {
  pushUndo();
  typingTimer = null;
  fn();
  renderAll();
  save();
  if (focusSel) {
    const el = $(focusSel);
    if (el) { el.focus(); el.select?.(); }
  }
}

// ---------------------------------------------------------------------------
// Lookups

const con = id => state.constraints.find(c => c.id === id);
const group = id => state.groups.find(g => g.id === id);
const cand = id => {
  for (const g of state.groups) {
    const k = g.candidates.find(x => x.id === id);
    if (k) return { g, k };
  }
  return {};
};
const letter = i => String.fromCharCode(97 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');

const move = (arr, i, d) => {
  const j = i + d;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
};

function newCand(form = '') {
  return { id: M.uid('k'), form, viol: {}, obs: '', mark: 'auto' };
}

// ---------------------------------------------------------------------------
// Editor

// Score columns typed by hand (HG/MaxEnt, when not computed automatically).
function typedExtras() {
  const o = state.opts;
  if (state.auto || state.mode === 'ot') return [];
  const shown = { H: o.showH, eH: o.showEH, P: o.showP };
  return (state.mode === 'hg' ? ['H'] : ['H', 'eH', 'P']).filter(x => shown[x]);
}
const EXTRA_LABEL = { H: '<i>H</i>', eH: 'e<sup>−<i>H</i></sup>', P: '<i>P</i>' };

const MARKS = [['hand', '☞'], ['arrow', '→'], ['frown', '☹'], ['bomb', '💣'], ['cross', '✗']];

function markSelect(k, ki) {
  const opts = state.auto ? [['auto', 'Auto'], ['none', '—'], ...MARKS] : [['auto', '—'], ...MARKS];
  const cur = !state.auto && k.mark === 'none' ? 'auto' : k.mark;
  return `<select class="mark-select" data-f="mark" data-k="${k.id}" aria-label="Mark for candidate ${letter(ki)}" title="Mark shown before the candidate">
    ${opts.map(([v, l]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('')}
  </select>`;
}

function renderEditor() {
  const mode = state.mode;
  const cons = state.constraints;
  const auto = state.auto;
  const extras = typedExtras();
  const obsCol = mode === 'me';
  const intendedCol = auto && mode !== 'me';
  const tail = extras.length + (obsCol ? 1 : 0) + 1 + (intendedCol ? 1 : 0); // columns after the constraints, before the row tools
  const nCols = 2 + cons.length + tail + 1;
  const h = [];

  h.push('<thead><tr>');
  h.push('<th scope="col">Input</th><th scope="col">Candidates</th>');
  cons.forEach((c, i) => {
    const tied = mode === 'ot' && c.tie && i < cons.length - 1;
    h.push(`<th scope="col" class="col-con${tied ? ' tied' : ''}">
      <input class="con-name" data-f="con-name" data-c="${c.id}" data-ipa value="${esc(c.name)}" aria-label="Constraint ${i + 1} name" spellcheck="false">
      <div class="con-tools">
        <button type="button" class="ico" data-act="con-left" data-c="${c.id}" title="Move left${mode === 'ot' ? ' (rank higher)' : ''}" aria-label="Move ${esc(c.name)} left"${i === 0 ? ' disabled' : ''}>◀</button>
        ${mode === 'ot' && i < cons.length - 1 ? `<button type="button" class="ico" data-act="tie" data-c="${c.id}" aria-pressed="${c.tie}" title="${c.tie ? 'Unranked with the next constraint (dashed line). Click for a solid line.' : 'Click to leave this and the next constraint unranked (dashed line).'}" aria-label="Unranked with next constraint">┆</button>` : ''}
        <button type="button" class="ico" data-act="con-right" data-c="${c.id}" title="Move right${mode === 'ot' ? ' (rank lower)' : ''}" aria-label="Move ${esc(c.name)} right"${i === cons.length - 1 ? ' disabled' : ''}>▶</button>
        <button type="button" class="ico del" data-act="con-del" data-c="${c.id}" title="Delete constraint" aria-label="Delete ${esc(c.name)}">✕</button>
      </div>
    </th>`);
  });
  extras.forEach(x => h.push(`<th scope="col" class="col-extra">${EXTRA_LABEL[x]}</th>`));
  if (obsCol) h.push('<th scope="col">Observed</th>');
  h.push('<th scope="col">Mark</th>');
  if (intendedCol) h.push('<th scope="col" title="The candidate that should win">Intended</th>');
  h.push('<th class="row-tools"></th></tr>');
  if (mode !== 'ot') {
    h.push('<tr class="row-weights"><th colspan="2" scope="row">Weights</th>');
    cons.forEach((c, i) => h.push(`<td><input type="number" step="any" data-f="weight" data-c="${c.id}" value="${esc(c.weight)}" aria-label="Weight of constraint ${i + 1}"></td>`));
    h.push(`${'<td></td>'.repeat(tail)}<td class="row-tools"></td></tr>`);
  }
  h.push('</thead>');

  state.groups.forEach((g, gi) => {
    h.push(`<tbody data-g="${g.id}">`);
    g.candidates.forEach((k, ki) => {
      h.push(`<tr data-k="${k.id}">`);
      if (ki === 0) {
        h.push(`<td class="cell-input" rowspan="${g.candidates.length + 1}">
          <input class="ipa-field" data-f="input" data-g="${g.id}" data-ipa value="${esc(g.input)}" placeholder="/input/" aria-label="Input ${gi + 1}" spellcheck="false">
          <div class="group-tools">
            <button type="button" class="ico" data-act="group-up" data-g="${g.id}" title="Move input up" aria-label="Move input up"${gi === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="ico" data-act="group-down" data-g="${g.id}" title="Move input down" aria-label="Move input down"${gi === state.groups.length - 1 ? ' disabled' : ''}>↓</button>
            <button type="button" class="ico del" data-act="group-del" data-g="${g.id}" title="Delete this input and its candidates" aria-label="Delete input">✕</button>
          </div>
        </td>`);
      }
      h.push(`<td class="cell-cand"><div class="cand-wrap"><span class="lbl" aria-hidden="true">${letter(ki)}.</span>
        <input class="ipa-field" data-f="cand" data-col="cand" data-k="${k.id}" data-ipa value="${esc(k.form)}" placeholder="[candidate]" aria-label="Candidate ${letter(ki)} for input ${gi + 1}" spellcheck="false"></div></td>`);
      cons.forEach((c, ci) => {
        const tied = mode === 'ot' && c.tie && ci < cons.length - 1;
        h.push(`<td class="cell-v${tied ? ' tied' : ''}" data-k="${k.id}" data-c="${c.id}"><input data-f="v" data-col="${c.id}" data-k="${k.id}" data-c="${c.id}" value="${esc(k.viol[c.id] ?? '')}" aria-label="${esc(c.name)} violations for candidate ${letter(ki)}" autocomplete="off" spellcheck="false"></td>`);
      });
      extras.forEach(x => h.push(`<td class="cell-extra"><input type="text" data-f="extra" data-x="${x}" data-col="x-${x}" data-k="${k.id}" value="${esc(k.extra?.[x] ?? '')}" aria-label="${x} for candidate ${letter(ki)}" spellcheck="false"></td>`));
      if (obsCol) h.push(`<td class="cell-extra"><input type="text" inputmode="decimal" data-f="obs" data-col="obs" data-k="${k.id}" value="${esc(k.obs)}" aria-label="Observed value for candidate ${letter(ki)}" spellcheck="false"></td>`);
      h.push(`<td class="cell-mark">${markSelect(k, ki)}</td>`);
      if (intendedCol) h.push(`<td class="cell-extra"><input type="radio" name="win-${g.id}" data-f="win" data-g="${g.id}" data-k="${k.id}"${g.winner === k.id ? ' checked' : ''} title="Intended winner (click again to clear)" aria-label="Candidate ${letter(ki)} is the intended winner"></td>`);
      h.push(`<td class="row-tools">
        <button type="button" class="ico" data-act="cand-up" data-k="${k.id}" title="Move up" aria-label="Move candidate up"${ki === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="ico" data-act="cand-down" data-k="${k.id}" title="Move down" aria-label="Move candidate down"${ki === g.candidates.length - 1 ? ' disabled' : ''}>↓</button>
        <button type="button" class="ico del" data-act="cand-del" data-k="${k.id}" title="Delete candidate" aria-label="Delete candidate ${letter(ki)}">✕</button>
      </td></tr>`);
    });
    if (!g.candidates.length) {
      h.push(`<tr><td class="cell-input"><input class="ipa-field" data-f="input" data-g="${g.id}" data-ipa value="${esc(g.input)}" aria-label="Input ${gi + 1}"><div class="group-tools"><button type="button" class="ico del" data-act="group-del" data-g="${g.id}" aria-label="Delete input">✕</button></div></td></tr>`);
    }
    h.push(`<tr><td class="add-row" colspan="${nCols - 1}"><button type="button" class="ico" data-act="cand-add" data-g="${g.id}">+ Candidate</button></td></tr>`);
    h.push('</tbody>');
  });
  const ed = $('#editor');
  ed.innerHTML = h.join('');
  ed.classList.toggle('shade-mode', shadeMode && !state.auto);
}

// Reflect evaluation results in the editor (marks, fatal cells, shading).
function decorateEditor(results) {
  state.groups.forEach((g, gi) => {
    const res = results[gi];
    g.candidates.forEach((k, ki) => {
      const tr = $(`#editor tr[data-k="${k.id}"]`);
      if (!tr) return;
      const m = markFor(state, g, k, res);
      tr.classList.toggle('is-winner', m === 'hand' || m === 'arrow');
      tr.classList.toggle('is-wrong', ['frown', 'bomb', 'cross'].includes(m));
      $('.lbl', tr).textContent = (m ? SYMBOLS[m] + ' ' : '') + letter(ki) + '.';
      state.constraints.forEach((c, ci) => {
        const td = $(`td.cell-v[data-c="${c.id}"]`, tr);
        if (!td) return;
        const p = M.parseViol(k.viol[c.id]);
        let fatal = false, shade = false;
        if (!state.auto) {
          fatal = p.bang >= 0;
          shade = !!state.shade[`${k.id}:${c.id}`];
        } else if (state.mode === 'ot') {
          fatal = state.opts.fatal && res.info[ki].fatal.has(ci);
          shade = state.opts.shading && ci >= res.info[ki].shadeFrom;
        }
        td.classList.toggle('is-fatal', fatal);
        td.classList.toggle('is-shaded', shade);
        td.classList.toggle('is-bad', p.bad);
      });
    });
  });
}

function onEditorInput(e) {
  const t = e.target;
  const f = t.dataset.f;
  if (!f || f === 'win' || f === 'mark') return;
  beginTyping();
  if (f === 'con-name') con(t.dataset.c).name = t.value;
  else if (f === 'weight') con(t.dataset.c).weight = parseFloat(t.value) || 0;
  else if (f === 'input') group(t.dataset.g).input = t.value;
  else if (f === 'cand') cand(t.dataset.k).k.form = t.value;
  else if (f === 'v') cand(t.dataset.k).k.viol[t.dataset.c] = t.value;
  else if (f === 'obs') cand(t.dataset.k).k.obs = t.value;
  else if (f === 'extra') { const { k } = cand(t.dataset.k); k.extra = { ...k.extra, [t.dataset.x]: t.value }; }
  scheduleOutputs();
  save();
}

function onEditorClick(e) {
  const t = e.target;
  if (t.matches('input[data-f="win"]')) {
    const g = group(t.dataset.g);
    const id = t.dataset.k;
    change(() => { g.winner = g.winner === id ? null : id; });
    return;
  }
  const b = t.closest('button[data-act]');
  if (!b) return;
  act(b.dataset.act, b.dataset);
}

function act(a, d) {
  const cons = state.constraints;
  switch (a) {
    case 'con-add': {
      const c = { id: M.uid('c'), name: `Con${cons.length + 1}`, weight: 1, tie: false };
      change(() => cons.push(c), `.con-name[data-c="${c.id}"]`);
      break;
    }
    case 'con-del': change(() => {
      const i = cons.findIndex(c => c.id === d.c);
      cons.splice(i, 1);
      if (i > 0 && i === cons.length) cons[i - 1].tie = false;
      for (const g of state.groups) for (const k of g.candidates) delete k.viol[d.c];
    }); break;
    case 'con-left': change(() => move(cons, cons.findIndex(c => c.id === d.c), -1)); break;
    case 'con-right': change(() => move(cons, cons.findIndex(c => c.id === d.c), 1)); break;
    case 'tie': change(() => { const c = con(d.c); c.tie = !c.tie; }); break;
    case 'cand-add': {
      const k = newCand();
      change(() => group(d.g).candidates.push(k), `input[data-f="cand"][data-k="${k.id}"]`);
      break;
    }
    case 'cand-del': change(() => {
      const { g, k } = cand(d.k);
      g.candidates.splice(g.candidates.indexOf(k), 1);
      if (g.winner === k.id) g.winner = null;
    }); break;
    case 'cand-up': case 'cand-down': change(() => {
      const { g, k } = cand(d.k);
      move(g.candidates, g.candidates.indexOf(k), a === 'cand-up' ? -1 : 1);
    }); break;
    case 'group-add': {
      const g = { id: M.uid('g'), input: '', winner: null, candidates: [newCand(), newCand()] };
      change(() => state.groups.push(g), `input[data-f="input"][data-g="${g.id}"]`);
      break;
    }
    case 'group-del': change(() => {
      state.groups.splice(state.groups.findIndex(g => g.id === d.g), 1);
      if (!state.groups.length) state.groups.push({ id: M.uid('g'), input: '', winner: null, candidates: [newCand()] });
    }); break;
    case 'group-up': case 'group-down': change(() =>
      move(state.groups, state.groups.findIndex(g => g.id === d.g), a === 'group-up' ? -1 : 1)); break;
    default: break;
  }
}

// Enter / arrow keys move down and up a column.
function onEditorKey(e) {
  const t = e.target;
  const col = t.dataset.col;
  if (!col || e.altKey || e.ctrlKey || e.metaKey) return;
  let dir = 0;
  if (e.key === 'Enter' || e.key === 'ArrowDown') dir = e.shiftKey && e.key === 'Enter' ? -1 : 1;
  if (e.key === 'ArrowUp') dir = -1;
  if (!dir) return;
  const cells = $$(`#editor [data-col="${CSS.escape(col)}"]`);
  const next = cells[cells.indexOf(t) + dir];
  if (next) { e.preventDefault(); next.focus(); next.select(); }
}

// Paste a block of spreadsheet cells: columns candidate, constraints…, observed.
function onEditorPaste(e) {
  const t = e.target;
  const col = t.dataset.col;
  if (!col) return;
  const text = e.clipboardData.getData('text/plain');
  if (!/[\t\n]/.test(text.trim())) return;
  e.preventDefault();
  const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(r => r.split('\t'));
  const colOrder = ['cand', ...state.constraints.map(c => c.id), ...typedExtras().map(x => `x-${x}`), ...(state.mode === 'me' ? ['obs'] : [])];
  const startCol = colOrder.indexOf(col);
  const allCands = state.groups.flatMap(g => g.candidates);
  const startRow = allCands.findIndex(k => k.id === t.dataset.k);
  if (startCol < 0 || startRow < 0) return;
  change(() => {
    rows.forEach((r, ri) => {
      let k = allCands[startRow + ri];
      if (!k) {
        k = newCand();
        state.groups[state.groups.length - 1].candidates.push(k);
        allCands.push(k);
      }
      r.forEach((val, ci) => {
        const key = colOrder[startCol + ci];
        if (!key) return;
        const v = val.trim();
        if (key === 'cand') k.form = v;
        else if (key === 'obs') k.obs = v;
        else if (key.startsWith('x-')) k.extra = { ...k.extra, [key.slice(2)]: v };
        else k.viol[key] = v === '0' ? '' : v;
      });
    });
  });
}

function onEditorChange(e) {
  const t = e.target;
  if (t.dataset.f === 'mark') change(() => { cand(t.dataset.k).k.mark = t.value; });
}

// ---------------------------------------------------------------------------
// Outputs

let outputsQueued = false;
function scheduleOutputs() {
  if (outputsQueued) return;
  outputsQueued = true;
  requestAnimationFrame(() => { outputsQueued = false; renderOutputs(); });
}

let current = { grids: [], scene: null, hasse: null };

function tableScene() {
  const grids = buildGrids(state);
  const o = state.opts;
  const scenes = grids.map(g => layoutGrid(g, { font: o.font, fontSize: o.fontSize }));
  return { grids, scene: stackScenes(scenes, o.fontSize * 1.5) };
}

function renderOutputs() {
  const results = M.evaluate(state);
  decorateEditor(results);
  const { grids, scene } = tableScene();
  current.grids = grids;
  current.scene = scene;
  const hasRows = state.groups.some(g => g.candidates.length) || state.constraints.length;
  $('#preview').innerHTML = hasRows ? toSVG(scene, { interactive: true }) : '<p class="empty">Add constraints and candidates to see the tableau.</p>';

  const lx = latexCode(grids, state.opts);
  $('#latex-code').value = lx.code;
  const note = $('#latex-note');
  if (lx.unknown.length) {
    note.className = 'note warn';
    note.textContent = `tipa has no command for ${lx.unknown.join(' ')}, so ${lx.unknown.length > 1 ? 'they were' : 'it was'} left as Unicode. Switch “IPA as” to Unicode and compile with XeLaTeX or LuaLaTeX, or replace ${lx.unknown.length > 1 ? 'them' : 'it'}.`;
  } else {
    note.className = 'note';
    note.textContent = state.opts.latexIpa === 'tipa'
      ? 'Compiles with pdfLaTeX. The packages it needs are listed at the top.'
      : 'Compile with XeLaTeX or LuaLaTeX, using a font that has IPA (e.g. Charis SIL or Andika).';
  }
  $('#typst-code').value = typstCode(grids, state.opts);
  $('#md-code').value = markdownCode(grids);
  $('#otsoft-code').value = IO.toOTSoft(state);
  renderMessages(results);
  renderHasse();
}

const ipaSpan = s => `<span class="ipa">${esc(s)}</span>`;

// General notes (always), and the automatic mode's analysis.
function renderMessages(results) {
  const msgs = [];
  const bad = [];
  state.groups.forEach(g => g.candidates.forEach(k => state.constraints.forEach(c => {
    if (M.parseViol(k.viol[c.id]).bad) bad.push(`${ipaSpan(k.viol[c.id])} (${ipaSpan(k.form || '?')}, ${esc(c.name)})`);
  })));
  if (bad.length) msgs.push(['warn', `These cells aren't a number or stars, so they're shown as empty: ${bad.slice(0, 4).join('; ')}${bad.length > 4 ? '…' : ''}`]);
  if (state.opts.comparative && state.mode === 'ot' && !state.auto && state.groups.some(g => !g.candidates.some(k => k.mark === 'hand' || k.mark === 'arrow'))) {
    msgs.push(['warn', 'The comparative tableau pairs the winner with each loser: mark the winner of each input with ☞ in the Mark column.']);
  }
  $('#messages').innerHTML = msgs.map(([cls, html]) => `<p class="${cls}">${html}</p>`).join('');
  $('#analysis').innerHTML = state.auto ? analysis(results).map(([cls, html]) => `<p class="${cls}">${html}</p>`).join('') : '';
}

function analysis(results) {
  const msgs = [];
  if (state.mode !== 'me') {
    let designated = 0;
    state.groups.forEach((g, gi) => {
      if (!g.winner) return;
      const w = g.candidates.find(k => k.id === g.winner);
      if (!w) return;
      designated++;
      if (!results[gi].winners.has(w.id)) {
        const beaters = g.candidates.filter(k => results[gi].winners.has(k.id)).map(k => ipaSpan(k.form));
        msgs.push(['warn', `${ipaSpan(g.input || 'Input ' + (gi + 1))}: the intended winner ${ipaSpan(w.form)} loses to ${beaters.join(', ')}.${state.mode === 'ot' ? ' Try “Rank by RCD”.' : ''}`]);
      } else if (results[gi].winners.size > 1) {
        msgs.push(['warn', `${ipaSpan(g.input || 'Input ' + (gi + 1))}: ${ipaSpan(w.form)} ties with another candidate.`]);
      }
    });
    if (designated && !msgs.some(m => m[0] === 'warn' && m[1].includes('intended winner')))
      msgs.push(['ok', `Every intended winner is optimal under this ${state.mode === 'ot' ? 'ranking' : 'weighting'}.`]);
  } else {
    const anyObs = state.groups.some(g => g.candidates.some(k => M.parseObs(k.obs) > 0));
    if (anyObs) {
      let ll = 0;
      state.groups.forEach((g, gi) => g.candidates.forEach((k, ki) => {
        const o = M.parseObs(k.obs);
        if (o > 0) ll += o * Math.log(Math.max(results[gi].P[ki], 1e-300));
      }));
      msgs.push(['ok', `Log-likelihood of the observed data: ${ll.toFixed(3)}. “Fit weights” looks for the weights that make it as high as possible.`]);
    }
  }
  if (flash) msgs.unshift(flash);
  return msgs;
}

let flash = null;
let flashTimer = null;
function setFlash(cls, html) {
  flash = [cls, html];
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash = null; renderMessages(M.evaluate(state)); }, 9000);
  renderMessages(M.evaluate(state));
}

// The Hasse source actually in use (the entailed rankings are experimental).
const hasseSource = () => (state.opts.hasseSource === 'entailed' && !state.auto ? 'ranking' : state.opts.hasseSource);

function renderHasse() {
  const o = state.opts;
  const src = hasseSource();
  $('#hasse-custom-wrap').hidden = src !== 'custom';
  if ($('#hasse-custom').value !== o.hasseCustom) $('#hasse-custom').value = o.hasseCustom;
  const graph = hasseGraph({ ...state, opts: { ...o, hasseSource: src } });
  const note = $('#hasse-note');
  note.className = graph.error ? 'note warn' : 'note';
  note.textContent = graph.error || ({
    entailed: 'Only the rankings that every winner needs are drawn.',
    ranking: 'Each constraint dominates those to its right in the tableau. Constraints separated by a dashed line sit side by side.',
    custom: '',
  })[src];
  if (!graph.nodes.length) {
    current.hasse = null;
    $('#hasse-preview').innerHTML = '<p class="empty">Nothing to draw yet.</p>';
    $('#hasse-code').value = '';
    return;
  }
  const scene = layoutHasse(graph, { font: o.font, fontSize: o.fontSize, smallcaps: o.smallcaps });
  current.hasse = { graph, scene };
  $('#hasse-preview').innerHTML = toSVG(scene);
  const tab = $('[data-htab][aria-selected="true"]').dataset.htab;
  $('#hasse-code').value = tab === 'tikz' ? hasseTikz(graph, scene, o) : hasseTypst(graph, scene, o);
}

// The tableau's ranking as typed rankings, one line per domination pair.
function rankingLines() {
  const g = hasseGraph({ ...state, opts: { ...state.opts, hasseSource: 'ranking' } });
  const lines = g.edges.map(([a, b]) => `${g.nodes[a].name} >> ${g.nodes[b].name}`);
  const linked = new Set(g.edges.flat());
  g.nodes.forEach((n, i) => { if (!linked.has(i)) lines.push(n.name); });
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Options panel

// `auto: true` options only matter when results are computed automatically.
const OPTS = [
  { key: 'comparative', label: 'Comparative tableau (W, L, e)', type: 'check', modes: ['ot'] },
  { key: 'violStyle', label: 'Show violations as', type: 'select', options: [['stars', 'Stars (*, **)'], ['numbers', 'Numbers (1, 2)']] },
  { key: 'negative', label: 'Negative numbers (−1) for violations', type: 'check', modes: ['hg', 'me'] },
  { key: 'zeroBlank', label: 'Leave zero cells empty', type: 'check' },
  { key: 'labels', label: 'Letter the candidates (a., b., …)', type: 'check' },
  { key: 'showWeights', label: 'Row of weights', type: 'check', modes: ['hg', 'me'] },
  { key: 'showH', label: 'Harmony column (H)', type: 'check', modes: ['hg', 'me'] },
  { key: 'showEH', label: 'e^−H column', type: 'check', modes: ['me'] },
  { key: 'showP', label: 'Probability column (P)', type: 'check', modes: ['me'] },
  { key: 'showObs', label: 'Observed column', type: 'check', modes: ['me'] },
  { key: 'layout', label: 'Several inputs', type: 'select', options: [['combined', 'One table with an input column'], ['separate', 'A separate tableau per input']] },
  { key: 'inputHeader', label: 'Input column heading (one table only)', type: 'text', ipa: true },
  { key: 'candHeader', label: 'Candidate column heading (one table only)', type: 'text', ipa: true },
  { key: 'smallcaps', label: 'Small caps constraint names', type: 'check' },
  { key: 'compE', label: 'Comparative cells with no preference', type: 'select', options: [['e', 'e'], ['', '(blank)']], modes: ['ot'] },
  { key: 'font', label: 'Font', type: 'select', options: [['Charis SIL', 'Charis SIL (serif)'], ['Andika', 'Andika (sans serif)']] },
  { key: 'fontSize', label: 'Font size in the preview and images (px)', type: 'number', min: 8, max: 40 },
  { key: 'decimals', label: 'Decimal places (weights and computed scores)', type: 'number', min: 0, max: 8, modes: ['hg', 'me'] },
  { key: 'fatal', label: 'Mark fatal violations with !', type: 'check', modes: ['ot'], auto: true },
  { key: 'shading', label: 'Shade cells that no longer matter', type: 'check', modes: ['ot'], auto: true },
  { key: 'winnerMark', label: 'Winner mark', type: 'select', options: [['hand', '☞ pointing hand'], ['arrow', '→ arrow']], auto: true },
  { key: 'wrongMark', label: 'Loser that wrongly wins', type: 'select', options: [['frown', '☹ frowning face'], ['bomb', '💣 bomb'], ['cross', '✗ cross']], modes: ['ot', 'hg'], auto: true },
  { key: 'meMarks', label: 'Mark the most probable candidate', type: 'check', modes: ['me'], auto: true },
];

function renderOptions() {
  $('#opt-grid').innerHTML = OPTS.filter(o => (!o.modes || o.modes.includes(state.mode)) && (!o.auto || state.auto)).map(o => {
    const v = state.opts[o.key];
    const label = esc(o.label) + (o.auto ? ' <span class="exp-tag">automatic mode</span>' : '');
    if (o.type === 'check') return `<label class="check"><input type="checkbox" data-opt="${o.key}"${v ? ' checked' : ''}> ${label}</label>`;
    if (o.type === 'select') return `<label>${label}<select data-opt="${o.key}">${o.options.map(([val, l]) => `<option value="${esc(val)}"${String(v) === val ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    if (o.type === 'number') return `<label>${label}<input type="number" data-opt="${o.key}" data-num min="${o.min}" max="${o.max}" value="${esc(v)}"></label>`;
    return `<label>${label}<input type="text" data-opt="${o.key}"${o.ipa ? ' data-ipa class="ipa-field"' : ''} value="${esc(v)}" spellcheck="false"></label>`;
  }).join('');
}

// Every [data-opt] control anywhere on the page edits state.opts.
function syncOptControls() {
  $$('[data-opt]').forEach(el => {
    const v = state.opts[el.dataset.opt];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (document.activeElement !== el) el.value = v;
  });
}

async function onOptInput(e) {
  const el = e.target.closest('[data-opt]');
  if (!el) return;
  const key = el.dataset.opt;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if ('num' in el.dataset || el.type === 'number') {
    v = parseFloat(v);
    if (!Number.isFinite(v)) return;
  }
  if (el.type === 'text' || el.tagName === 'TEXTAREA') beginTyping(); else pushUndo();
  state.opts[key] = v;
  save();
  if (key === 'font') { await loadFont(v); renderChrome(); }
  // options that change which editor columns exist
  if (['showH', 'showEH', 'showP', 'comparative'].includes(key)) renderEditor();
  scheduleOutputs();
}

// ---------------------------------------------------------------------------
// Toolbar, modes, pages

function renderChrome() {
  $$('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === state.mode));
  $$('[data-modes]').forEach(el => {
    if (el.dataset.modes.split(' ').includes(state.mode)) el.removeAttribute('data-hidden-mode');
    else el.setAttribute('data-hidden-mode', '');
  });
  $$('[data-auto-only]').forEach(el => { el.hidden = !state.auto; });
  $$('[data-manual-only]').forEach(el => { el.hidden = state.auto; });
  $('#auto').checked = state.auto;
  if (state.auto) $('#experimental').open = true;
  $('#shade-mode').setAttribute('aria-pressed', shadeMode);
  // the editor's IPA fields use the tableau's font
  document.documentElement.style.setProperty('--ipa', `'${state.opts.font}', 'Noto Sans', serif`);
  const src = $('#source');
  const s = state.source;
  src.hidden = !s?.text;
  if (s?.text) {
    const link = /^https?:\/\//.test(s.url || '') ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener">Read the paper</a>` : '';
    src.innerHTML = `<strong>Source:</strong> ${esc(s.text)}${link}`;
  }
  $('#sigma2').value = state.opts.sigma2;
  $$('[data-page]').forEach(el => {
    if (el.getAttribute('role') === 'tab') el.setAttribute('aria-selected', el.dataset.page === page);
    else el.hidden = el.dataset.page !== page;
  });
}

function renderAll() {
  renderChrome();
  renderEditor();
  renderOptions();
  syncOptControls();
  renderOutputs();
}

// Automatic mode on: marks follow the evaluation, and the ☞ marks become
// the intended winners. Off: freeze what was computed so nothing changes.
function setAuto(on) {
  change(() => {
    if (on) {
      state.groups.forEach(g => {
        const w = g.candidates.find(k => k.mark === 'hand' || k.mark === 'arrow');
        if (w) g.winner = w.id;
        g.candidates.forEach(k => { k.mark = 'auto'; });
      });
      state.auto = true;
    } else {
      freezeAuto(state);
    }
  });
}

function rankByRCD() {
  const all = M.ercs(state);
  const res = M.rcd(all.map(e => e.row), state.constraints.length);
  if (!res.consistent) {
    const stuck = res.stuck.slice(0, 3).map(i => `<span class="ipa">${esc(all[i].winner.form)} ≻ ${esc(all[i].loser.form)}</span>`);
    setFlash('warn', `No ranking makes every intended winner optimal. RCD got stuck on: ${stuck.join(', ')}. A loser may be harmonically bounded, or the winners may need conflicting rankings.`);
    return;
  }
  change(() => {
    const old = state.constraints;
    const next = [];
    res.strata.forEach(st => {
      st.sort((a, b) => a - b).forEach((ci, j) => {
        const c = old[ci];
        c.tie = j < st.length - 1;
        next.push(c);
      });
    });
    state.constraints = next;
  });
  setFlash('ok', `Ranked by RCD into ${res.strata.length} strat${res.strata.length === 1 ? 'um' : 'a'}. RCD puts each constraint as high as it can go, so dashed lines mean the data doesn't rank those constraints.`);
}

function fitWeights() {
  const sigma2 = parseFloat($('#sigma2').value);
  const s2 = Number.isFinite(sigma2) && sigma2 > 0 ? sigma2 : 100000;
  const res = M.fitMaxEnt(state, { sigma2: s2 });
  if (!res) { setFlash('warn', 'Enter observed frequencies in the “Observed” column first.'); return; }
  change(() => {
    state.opts.sigma2 = s2;
    state.constraints.forEach((c, i) => { c.weight = Math.round(res.weights[i] * 1000) / 1000; });
  });
  setFlash('ok', `Fitted weights. Log-likelihood ${res.logLik.toFixed(3)}. The Gaussian prior (σ² = ${s2}) pulls the weights towards 0: a smaller σ² pulls harder. The observed values are treated as counts, so proportions give the prior more influence.`);
}

// ---------------------------------------------------------------------------
// Files, clipboard

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

async function copyText(text, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} to the clipboard`);
  } catch {
    toast('Copying failed. Select the text and copy it yourself.');
  }
}

const pngBlob = scene => new Promise(res => toCanvas(scene, {
  scale: state.opts.pngScale, background: state.opts.pngBg === 'white' ? '#fff' : null,
}).toBlob(res, 'image/png'));

async function svgFile(scene) {
  const css = await embeddedFontCSS(scene);
  return toSVG(scene, { fontCSS: css, background: state.opts.pngBg === 'white' ? '#fff' : null });
}

async function onDownload(kind) {
  if (kind === 'latex') return download('tableau.tex', $('#latex-code').value, 'text/x-tex');
  if (kind === 'typst') return download('tableau.typ', $('#typst-code').value, 'text/plain');
  if (kind === 'otsoft') return download('tableau.txt', $('#otsoft-code').value, 'text/plain');
  if (kind === 'markdown') return download('tableau.md', $('#md-code').value, 'text/markdown');
  if (kind === 'png') return download('tableau.png', await pngBlob(current.scene));
  if (kind === 'svg') return download('tableau.svg', await svgFile(current.scene), 'image/svg+xml');
  if (!current.hasse) return toast('There is no Hasse diagram to download yet.');
  if (kind === 'hasse-png') return download('hasse.png', await pngBlob(current.hasse.scene));
  if (kind === 'hasse-svg') return download('hasse.svg', await svgFile(current.hasse.scene), 'image/svg+xml');
}

// Copy the tableau as a formatted table (HTML) for word processors, with
// tab-separated text as the plain-text alternative.
async function copyDocs() {
  const { html, text } = docsCode(current.grids, state.opts);
  const doc = `<html><body><!--StartFragment-->${html}<!--EndFragment--></body></html>`;
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([doc], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
  } catch {
    // older browsers: copy a rendered, selected copy of the table
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff;color:#000';
    box.innerHTML = html;
    document.body.appendChild(box);
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('copy');
    sel.removeAllRanges();
    box.remove();
    if (!ok) { toast('Copying failed in this browser. Try the image instead.'); return; }
  }
  toast('Table copied: paste it into your document');
}

async function copyPNG() {
  try {
    const blob = await pngBlob(current.scene);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Image copied: paste it into your document');
  } catch {
    toast('This browser can\'t copy images. Download the PNG instead.');
  }
}

async function share() {
  try {
    const hash = await IO.toShareHash(state);
    const url = `${location.origin}${location.pathname}#${hash}`;
    history.replaceState(null, '', `#${hash}`);
    await copyText(url, 'Link copied');
  } catch {
    toast('Couldn\'t make a link in this browser. Use Save instead.');
  }
}

function loadState(s, msg) {
  pushUndo();
  state = M.normalize(s);
  renderAll();
  save();
  if (msg) toast(msg);
}

function openImport() {
  $('#import-text').value = '';
  $('#import-error').textContent = '';
  $('#import-file').value = '';
  $('#import-dialog').showModal();
}

function doImport() {
  const text = $('#import-text').value.trim();
  const err = $('#import-error');
  if (!text) { err.textContent = 'Choose a file or paste something first.'; return; }
  try {
    const s = text.startsWith('{') ? IO.fromJSON(text) : IO.fromOTSoft(text, state.mode);
    $('#import-dialog').close();
    loadState(s, 'Imported');
  } catch (e) {
    err.className = 'note warn';
    err.textContent = `Couldn't read that: ${e.message}`;
  }
}

// ---------------------------------------------------------------------------
// IPA picker

let ipaTarget = null;
let ipaTab = 'cons';

const TABS = [
  ['cons', 'Consonants'], ['vowels', 'Vowels'],
  ...IPA.GROUPS.map(g => [g.id, g.label === 'Other consonants' ? 'Other' : g.label]),
];

function symButton(s, comb = s.k === 'comb') {
  const shown = comb ? `◌${s.c}` : s.c;
  return `<button type="button" class="sym" data-sym="${esc(s.c)}" title="${esc(s.n)}${s.x ? ` · X-SAMPA ${esc(s.x)}` : ''}" aria-label="${esc(s.n)}">${esc(shown)}</button>`;
}

function renderIPA() {
  $('#ipa-tabs').innerHTML = TABS.map(([id, label]) =>
    `<button type="button" role="tab" data-ipatab="${id}" aria-selected="${id === ipaTab}">${label}</button>`).join('');
  let html = '';
  if (ipaTab === 'cons') {
    // one row per manner, front to back of the mouth (the full chart is too
    // wide for the panel; hovering a symbol names its place)
    for (const [manner, cells] of IPA.PULMONIC) {
      const pairs = cells.filter(c => c && c !== '#')
        .map(pair => `<span class="pair">${pair.filter(Boolean).map(s => symButton(s)).join('')}</span>`);
      html += `<div class="ipa-row"><span class="ipa-row-label">${manner}</span><div class="flow">${pairs.join('')}</div></div>`;
    }
    html += '<p class="ipa-sub">Ordered from the lips back to the glottis. In a pair, the second symbol is voiced.</p>';
  } else if (ipaTab === 'vowels') {
    html += '<table class="ipa-chart"><thead><tr><th></th><th scope="col">Front</th><th scope="col">Central</th><th scope="col">Back</th></tr></thead><tbody>';
    for (const [height, cells] of IPA.VOWELS) {
      html += `<tr><th scope="row">${height}</th>`;
      for (let i = 0; i < 6; i += 2) {
        html += `<td><div class="pair">${[cells[i], cells[i + 1]].map(s => (s ? symButton(s) : '<span class="ph"></span>')).join('')}</div></td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table><p class="ipa-sub">Where symbols come in pairs, the one on the right is rounded.</p>';
  } else {
    const g = IPA.GROUPS.find(x => x.id === ipaTab);
    if (g.comb || g.id === 'diacritics') html += '<p class="ipa-sub">Type the symbol first, then click a diacritic to add it.</p>';
    html += `<div class="flow">${g.items.map(s => symButton(s)).join('')}</div>`;
  }
  $('#ipa-body').innerHTML = html;
}

function renderIPAResults() {
  const q = $('#ipa-search').value;
  const res = IPA.search(q, 12);
  $('#ipa-results').innerHTML = res.map((s, i) =>
    `<button type="button" data-sym="${esc(s.c)}"${i === 0 ? ' class="first"' : ''}><span class="glyph">${esc(s.k === 'comb' ? '◌' + s.c : s.c)}</span><span>${esc(s.n)}</span></button>`).join('')
    + (q.trim() && !res.length ? '<p class="ipa-sub">No match. Try a description such as “voiced bilabial”.</p>' : '');
}

function describeTarget(el) {
  if (!el) return 'Click a field in the tableau, then click a symbol.';
  const f = el.dataset.f;
  const what = f === 'cand' ? 'candidate' : f === 'input' ? 'input' : f === 'con-name' ? 'constraint name' : el.id === 'hasse-custom' ? 'rankings' : 'field';
  return `Typing into the ${what}: <span class="ipa">${esc(el.value || '(empty)')}</span>`;
}

function insertSymbol(ch) {
  let el = ipaTarget && document.contains(ipaTarget) ? ipaTarget : null;
  if (!el) el = $('#editor input[data-f="cand"]');
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.focus();
  el.setRangeText(ch, start, end, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  ipaTarget = el;
  $('#ipa-target').innerHTML = describeTarget(el);
}

function initIPA() {
  const panel = $('#ipa');
  renderIPA();
  // keep focus (and the caret) in the text field while clicking symbols
  panel.addEventListener('mousedown', e => {
    if (e.target.closest('button[data-sym], [data-ipatab]')) e.preventDefault();
  });
  panel.addEventListener('click', e => {
    const b = e.target.closest('button[data-sym]');
    if (b) {
      insertSymbol(b.dataset.sym);
      const d = IPA.describe(b.dataset.sym);
      if (d) $('#ipa-name').innerHTML = `<span class="glyph">${esc(d.k === 'comb' ? '◌' + d.c : d.c)}</span> ${esc(d.n)}`;
      return;
    }
    const t = e.target.closest('[data-ipatab]');
    if (t) { ipaTab = t.dataset.ipatab; renderIPA(); }
  });
  panel.addEventListener('mouseover', e => {
    const b = e.target.closest('button[data-sym]');
    if (!b) return;
    const d = IPA.describe(b.dataset.sym);
    if (d) $('#ipa-name').innerHTML = `<span class="glyph">${esc(d.k === 'comb' ? '◌' + d.c : d.c)}</span> ${esc(d.n)}${d.x ? ` · X-SAMPA <code>${esc(d.x)}</code>` : ''}`;
  });
  $('#ipa-search').addEventListener('input', renderIPAResults);
  $('#ipa-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = $('#ipa-results button');
      if (first) {
        insertSymbol(first.dataset.sym);
      }
    }
  });
  document.addEventListener('focusin', e => {
    if (e.target.matches('[data-ipa]')) {
      ipaTarget = e.target;
      $('#ipa-target').innerHTML = describeTarget(e.target);
    }
  });
  document.addEventListener('input', e => {
    if (e.target === ipaTarget) $('#ipa-target').innerHTML = describeTarget(e.target);
  });
  const fab = $('#ipa-fab');
  const setOpen = open => {
    panel.classList.toggle('open', open);
    fab.setAttribute('aria-expanded', open);
    // keep the field being typed into visible above the sheet
    if (open && ipaTarget && document.contains(ipaTarget)) {
      const top = ipaTarget.getBoundingClientRect().top;
      if (top > innerHeight * 0.35 || top < 0) scrollBy({ top: top - innerHeight * 0.2, behavior: 'smooth' });
    }
  };
  fab.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  $('.ipa-close').addEventListener('click', () => setOpen(false));
}

// ---------------------------------------------------------------------------
// Theme toggle (same behaviour as the rest of the site)

// Light unless the visitor has chosen dark with the toggle.
function initTheme() {
  const toggle = $('#theme-toggle');
  const set = dark => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    toggle.setAttribute('aria-pressed', dark);
    $('.label', toggle).textContent = dark ? 'Light' : 'Dark';
  };
  set(document.documentElement.getAttribute('data-theme') === 'dark');
  toggle.addEventListener('click', () => {
    const dark = toggle.getAttribute('aria-pressed') !== 'true';
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
    set(dark);
  });
}

// ---------------------------------------------------------------------------
// Init

async function initialState() {
  if (location.hash.includes('t=')) {
    try {
      const s = await IO.fromShareHash(location.hash.slice(1));
      if (s) return s;
    } catch { toast('That link looks damaged, so your last tableau was opened instead.'); }
  }
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) return M.normalize(JSON.parse(saved));
  } catch { /* ignore */ }
  return IO.EXAMPLES[0].make();
}

async function init() {
  initTheme();
  state = await initialState();

  $('#examples').innerHTML += IO.EXAMPLES.map(x => `<option value="${x.id}">${esc(x.label)}</option>`).join('');
  $('#examples').addEventListener('change', e => {
    const ex = IO.EXAMPLES.find(x => x.id === e.target.value);
    e.target.value = '';
    if (ex) loadState(ex.make(), `Loaded “${ex.label}”. Undo brings back your previous tableau.`);
  });

  const ed = $('#editor');
  // with the 'Shade cells' tool on, clicking a violation cell toggles its shading
  ed.addEventListener('mousedown', e => {
    if (!shadeMode || state.auto) return;
    const td = e.target.closest('td.cell-v');
    if (!td) return;
    e.preventDefault();
    const key = `${td.dataset.k}:${td.dataset.c}`;
    change(() => { state.shade[key] = !state.shade[key]; });
  });
  ed.addEventListener('input', onEditorInput);
  ed.addEventListener('click', onEditorClick);
  ed.addEventListener('keydown', onEditorKey);
  ed.addEventListener('paste', onEditorPaste);
  ed.addEventListener('change', onEditorChange);
  $$('.editor-actions [data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act, b.dataset)));

  $$('[data-mode]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.mode === state.mode) return;
    change(() => {
      M.withModeDefaults(state, b.dataset.mode);
      if (state.mode === 'me') state.groups.forEach(g => { g.winner = null; });
    });
  }));
  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  $('#new').addEventListener('click', () => {
    const s = M.blankState(state.mode);
    s.constraints = [{ id: M.uid('c'), name: 'Con1', weight: 1, tie: false }, { id: M.uid('c'), name: 'Con2', weight: 1, tie: false }];
    s.groups = [{ id: M.uid('g'), input: '', winner: null, candidates: [newCand(), newCand()] }];
    s.opts = { ...state.opts };
    s.source = null;
    loadState(s, 'New tableau. Undo brings back the old one.');
    $('#editor input[data-f="input"]')?.focus();
  });
  $('#import').addEventListener('click', openImport);
  $('#import-go').addEventListener('click', doImport);
  $('#import-file').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (f) $('#import-text').value = await f.text();
  });
  $('#save-json').addEventListener('click', () => download('tableau.json', IO.toJSON(state), 'application/json'));
  $('#share').addEventListener('click', share);
  $('#auto').addEventListener('change', e => setAuto(e.target.checked));
  $('#shade-mode').addEventListener('click', () => {
    shadeMode = !shadeMode;
    renderChrome();
    $('#editor').classList.toggle('shade-mode', shadeMode && !state.auto);
    if (shadeMode) toast('Click violation cells to shade or unshade them. Click “Shade cells” again when you’re done.');
  });
  $$('.pagetabs [data-page]').forEach(b => b.addEventListener('click', () => {
    page = b.dataset.page;
    try { sessionStorage.setItem('tableau-page', page); } catch { /* ignore */ }
    renderChrome();
  }));
  $('#copy-docs').addEventListener('click', copyDocs);
  $('#hasse-fill').addEventListener('click', () => {
    pushUndo();
    state.opts.hasseCustom = rankingLines();
    save();
    renderHasse();
  });
  $('#rcd').addEventListener('click', rankByRCD);
  $('#fit').addEventListener('click', fitWeights);

  // checkboxes and selects fire 'input' too, so this covers every option control
  document.addEventListener('input', e => { if (e.target.closest('[data-opt]')) onOptInput(e); });
  $('#hasse-custom').addEventListener('input', e => {
    beginTyping();
    state.opts.hasseCustom = e.target.value;
    save();
    scheduleOutputs();
  });

  $$('[data-tab]').forEach(b => b.addEventListener('click', () => {
    $$('[data-tab]').forEach(x => x.setAttribute('aria-selected', x === b));
    $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== b.dataset.tab; });
  }));
  $$('[data-htab]').forEach(b => b.addEventListener('click', () => {
    $$('[data-htab]').forEach(x => x.setAttribute('aria-selected', x === b));
    renderHasse();
  }));
  $$('[data-copy]').forEach(b => b.addEventListener('click', () => copyText($(`#${b.dataset.copy}`).value)));
  $$('[data-dl]').forEach(b => b.addEventListener('click', () => onDownload(b.dataset.dl)));
  $('#copy-png').addEventListener('click', copyPNG);

  // preview: click a violation cell to shade it (by hand) or jump to it
  $('#preview').addEventListener('click', e => {
    const r = e.target.closest('rect.hit');
    if (!r) return;
    const key = `${r.dataset.cand}:${r.dataset.con}`;
    if (!state.auto) {
      change(() => { state.shade[key] = !state.shade[key]; });
    } else {
      const el = $(`#editor input[data-f="v"][data-k="${r.dataset.cand}"][data-c="${r.dataset.con}"]`);
      if (el) { el.focus(); el.select(); }
    }
  });

  document.addEventListener('keydown', e => {
    const inField = e.target.matches('input, textarea, select');
    if (!(e.ctrlKey || e.metaKey) || inField) return;
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if (e.key === 'y' || (e.key === 'z' && e.shiftKey) || e.key === 'Z') { e.preventDefault(); redo(); }
  });

  try { if (sessionStorage.getItem('tableau-page') === 'hasse') page = 'hasse'; } catch { /* ignore */ }
  initIPA();
  updateHistoryButtons();
  renderAll();
  await loadFont(state.opts.font);
  renderOutputs();
  document.fonts?.addEventListener?.('loadingdone', scheduleOutputs);
}

init();
