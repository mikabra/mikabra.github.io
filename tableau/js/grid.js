// Build backend-independent grids from the tableau state.
//
// grid = {
//   cols: [{ kind, align, padL, padR }],         paddings in em
//   rows: [[cell | null]],                        null = covered by a span
//   vl:   [style] per column boundary (0..ncols)   'solid' | 'dashed' | null
//   hl:   [[style] per column] per row boundary (0..nrows)
// }
// cell = { runs, colspan, rowspan, align?, shade?, meta? }

import { evaluate, parseViol, strata, intendedWinners, ercs, parseObs } from './model.js';
import { plain, form, parseName, sym, ENSP } from './rich.js';

const PAD = 0.45;

export function fmtNum(x, decimals = 3, fixed = false) {
  if (!Number.isFinite(x)) return '';
  let s;
  if (fixed) s = x.toFixed(decimals);
  else if (Number.isInteger(x)) s = String(x);
  else s = String(parseFloat(x.toFixed(decimals)));
  if (s === '-0' || /^-0\.0*$/.test(s)) s = s.slice(1);
  return s.replace('-', '−');
}

const letter = i => {
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(97 + m) + s; i = Math.floor((i - 1) / 26); }
  return s + '.';
};

// Violation cell text.
function violText(state, n, bang) {
  const o = state.opts;
  if (!n && o.zeroBlank) return bang >= 0 ? '!' : '';
  if (o.violStyle === 'stars' && Number.isInteger(n) && n <= 20) {
    if (bang < 0 || bang >= n) return '*'.repeat(n) + (bang >= n ? '!' : '');
    return '*'.repeat(bang + 1) + '!' + '*'.repeat(n - bang - 1);
  }
  const num = fmtNum(o.negative && n ? -n : n, o.decimals);
  return num + (bang >= 0 ? '!' : '');
}

// The mark (☞ / ☹ / nothing) shown before a candidate.
export function markFor(state, g, k, res) {
  if (k.mark && k.mark !== 'auto') return k.mark === 'none' ? null : k.mark;
  const o = state.opts;
  const win = o.winnerMark;
  if (state.mode === 'me') return o.meMarks && res.winners.has(k.id) ? win : null;
  const designated = g.winner && g.candidates.some(c => c.id === g.winner) ? g.winner : null;
  if (designated) {
    if (k.id === designated) return win;
    if (res.winners.has(k.id) && !res.winners.has(designated)) return o.wrongMark;
    return null;
  }
  return res.winners.has(k.id) ? win : null;
}

function emptyGrid(cols) {
  return { cols, rows: [], vl: Array(cols.length + 1).fill('solid'), hl: [] };
}

function addRow(grid, cells, lineAbove = 'solid') {
  const r = grid.rows.length;
  const row = Array(grid.cols.length).fill(null);
  for (const [ci, cell] of cells) row[ci] = { colspan: 1, rowspan: 1, ...cell };
  grid.rows.push(row);
  grid.hl[r] = Array(grid.cols.length).fill(lineAbove);
  return r;
}

function finish(grid) {
  grid.hl[grid.rows.length] = Array(grid.cols.length).fill('solid');
  return grid;
}

function extrasFor(state) {
  const o = state.opts;
  if (state.mode === 'hg') return o.showH ? ['H'] : [];
  if (state.mode === 'me') return [o.showH && 'H', o.showEH && 'eH', o.showP && 'P', o.showObs && 'Obs'].filter(Boolean);
  return [];
}

function extraHeader(state, x) {
  if (x === 'H') return [{ t: 'H', it: true }];
  if (x === 'eH') return [{ t: 'e' }, { t: state.opts.negative ? 'H' : '−H', sup: true, it: true }];
  if (x === 'P') return [{ t: 'P', it: true }];
  if (x === 'Obs') return plain('Obs.');
  return [];
}

// Build one tableau grid for the given groups (indices into state.groups).
function tableauGrid(state, results, gis, withInputCol) {
  const o = state.opts;
  const cons = state.constraints;
  const extras = extrasFor(state);
  const cols = [];
  if (withInputCol) cols.push({ kind: 'input', align: 'l', padL: PAD, padR: PAD });
  const MARK = cols.length;
  cols.push({ kind: 'mark', align: 'r', padL: PAD, padR: 0.2 });
  cols.push({ kind: 'cand', align: 'l', padL: 0.2, padR: PAD });
  const C0 = cols.length;
  cons.forEach(() => cols.push({ kind: 'con', align: 'c', padL: PAD, padR: PAD }));
  const X0 = cols.length;
  extras.forEach(x => cols.push({ kind: 'extra', extra: x, align: 'c', padL: PAD, padR: PAD }));
  const grid = emptyGrid(cols);

  grid.vl[MARK + 1] = null; // no rule between mark and candidate
  if (state.mode === 'ot') cons.forEach((c, i) => { if (c.tie && i < cons.length - 1) grid.vl[C0 + i + 1] = 'dashed'; });

  // header row
  const head = [];
  if (withInputCol) {
    head.push([0, { runs: form(o.inputHeader), align: 'l' }]);
    head.push([MARK, { runs: form(o.candHeader), colspan: 2, align: 'l' }]);
  } else {
    head.push([MARK, { runs: form(state.groups[gis[0]].input), colspan: 2, align: 'l' }]);
  }
  cons.forEach((c, i) => head.push([C0 + i, { runs: parseName(c.name, o.smallcaps), align: 'c' }]));
  extras.forEach((x, i) => head.push([X0 + i, { runs: extraHeader(state, x), align: 'c' }]));
  addRow(grid, head);

  if (state.mode !== 'ot' && o.showWeights) {
    const w = [[0, { runs: [], colspan: C0 }]];
    cons.forEach((c, i) => w.push([C0 + i, { runs: plain(fmtNum(+c.weight || 0, o.decimals)), align: 'c' }]));
    extras.forEach((_, i) => w.push([X0 + i, { runs: [] }]));
    addRow(grid, w);
  }

  for (const gi of gis) {
    const g = state.groups[gi];
    const res = results[gi];
    g.candidates.forEach((k, ki) => {
      const cells = [];
      if (withInputCol && ki === 0) cells.push([0, { runs: form(g.input), rowspan: g.candidates.length, align: 'l' }]);
      const m = markFor(state, g, k, res);
      const mruns = [];
      if (m) mruns.push(sym(m));
      if (m && o.labels) mruns.push({ t: ENSP });
      if (o.labels) mruns.push({ t: letter(ki) });
      cells.push([MARK, { runs: mruns, align: 'r' }]);
      cells.push([MARK + 1, { runs: form(k.form), align: 'l' }]);
      cons.forEach((c, ci) => {
        const p = parseViol(k.viol[c.id]);
        let bang = -1;
        let shade = false;
        if (state.manual) {
          bang = p.bang;
          shade = !!state.shade[`${k.id}:${c.id}`];
        } else if (state.mode === 'ot') {
          const inf = res.info[ki];
          if (o.fatal && inf.fatal.has(ci)) bang = inf.fatal.get(ci);
          shade = o.shading && ci >= inf.shadeFrom;
        }
        cells.push([C0 + ci, {
          runs: plain(violText(state, p.n, bang)), align: 'c', shade,
          meta: { cand: k.id, con: c.id },
        }]);
      });
      extras.forEach((x, xi) => {
        let t = '';
        const pen = res.pen?.[ki] ?? 0;
        if (x === 'H') t = fmtNum(o.negative ? -pen : pen, o.decimals);
        if (x === 'eH') t = fmtNum(res.eh[ki], o.decimals, true);
        if (x === 'P') t = fmtNum(res.P[ki], o.decimals, true);
        if (x === 'Obs') t = String(k.obs ?? '').trim() === '' ? '' : fmtNum(parseObs(k.obs), o.decimals);
        cells.push([X0 + xi, { runs: plain(t), align: 'c' }]);
      });
      addRow(grid, cells);
    });
  }
  return finish(grid);
}

function comparativeGrid(state, rows, gis, withInputCol) {
  const o = state.opts;
  const cons = state.constraints;
  const cols = [];
  if (withInputCol) cols.push({ kind: 'input', align: 'l', padL: PAD, padR: PAD });
  const P = cols.length;
  cols.push({ kind: 'cand', align: 'l', padL: PAD, padR: PAD });
  const C0 = cols.length;
  cons.forEach(() => cols.push({ kind: 'con', align: 'c', padL: PAD, padR: PAD }));
  const grid = emptyGrid(cols);
  cons.forEach((c, i) => { if (c.tie && i < cons.length - 1) grid.vl[C0 + i + 1] = 'dashed'; });

  const head = [];
  if (withInputCol) {
    head.push([0, { runs: form(o.inputHeader) }]);
    head.push([P, { runs: form(o.candHeader) }]);
  } else {
    head.push([P, { runs: form(state.groups[gis[0]].input) }]);
  }
  cons.forEach((c, i) => head.push([C0 + i, { runs: parseName(c.name, o.smallcaps), align: 'c' }]));
  addRow(grid, head);

  for (const gi of gis) {
    const mine = rows.filter(r => r.gi === gi);
    mine.forEach((r, ri) => {
      const cells = [];
      if (withInputCol && ri === 0) cells.push([0, { runs: form(r.group.input), rowspan: mine.length }]);
      const wi = r.group.candidates.indexOf(r.winner);
      const li = r.group.candidates.indexOf(r.loser);
      const pr = [];
      if (o.labels) pr.push({ t: letter(wi) + ENSP });
      pr.push(...form(r.winner.form), { t: ' ~ ' });
      if (o.labels) pr.push({ t: letter(li) + ENSP });
      pr.push(...form(r.loser.form));
      cells.push([P, { runs: pr }]);
      r.row.forEach((x, ci) => cells.push([C0 + ci, { runs: plain(x === 'e' ? o.compE : x), align: 'c' }]));
      addRow(grid, cells);
    });
  }
  return finish(grid);
}

// All grids for the current view (several when inputs are laid out separately).
export function buildGrids(state) {
  const results = evaluate(state);
  const n = state.groups.length;
  const separate = state.opts.layout === 'separate' || n === 1;
  const sets = separate ? state.groups.map((_, i) => [i]) : [[...Array(n).keys()]];
  if (state.view === 'comparative' && state.mode === 'ot') {
    const rows = ercs(state, results);
    return sets.map(gis => comparativeGrid(state, rows, gis, !separate));
  }
  return sets.map(gis => tableauGrid(state, results, gis, !separate));
}

// For every (row, column) the cell object covering it, and its origin.
export function owners(grid) {
  const R = grid.rows.length;
  const Cn = grid.cols.length;
  const own = Array.from({ length: R }, () => Array(Cn).fill(null));
  grid.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (!cell) return;
    cell.r = r;
    cell.c = c;
    for (let dr = 0; dr < cell.rowspan; dr++)
      for (let dc = 0; dc < cell.colspan; dc++)
        if (own[r + dr]) own[r + dr][c + dc] = cell;
  }));
  return own;
}

// Effective line styles, with lines inside spanned cells removed.
// v[r][b]: vertical boundary b in row r; h[b][c]: horizontal boundary b at column c.
export function effectiveLines(grid) {
  const own = owners(grid);
  const R = grid.rows.length;
  const Cn = grid.cols.length;
  const v = Array.from({ length: R }, (_, r) => Array.from({ length: Cn + 1 }, (_, b) => {
    if (b > 0 && b < Cn && own[r][b - 1] && own[r][b - 1] === own[r][b]) return null;
    return grid.vl[b];
  }));
  const h = Array.from({ length: R + 1 }, (_, b) => Array.from({ length: Cn }, (_, c) => {
    if (b > 0 && b < R && own[b - 1][c] && own[b - 1][c] === own[b][c]) return null;
    return grid.hl[b]?.[c] ?? null;
  }));
  return { v, h, own };
}

export { intendedWinners, strata };
