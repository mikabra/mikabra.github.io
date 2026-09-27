// Tables for word processors (HTML for the clipboard) and Markdown, both
// with Unicode IPA.

import { effectiveLines } from './grid.js';
import { ENSP } from './rich.js';

const escHTML = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Small caps are synthesized (capitals at a smaller size), because Google
// Docs has no small caps and Word's handling of font-variant is patchy.
function scHTML(text) {
  return text.split(/([a-z]+)/).map((part, i) => (i % 2
    ? `<span style="font-size:78%">${part.toUpperCase()}</span>`
    : escHTML(part))).join('');
}

function runsHTML(runs) {
  return runs.map(r => {
    let s = r.sc ? scHTML(r.t) : escHTML(r.t);
    if (r.it) s = `<i>${s}</i>`;
    if (r.sub) s = `<sub>${s}</sub>`;
    if (r.sup) s = `<sup>${s}</sup>`;
    return s;
  }).join('');
}

const BORDER = { solid: '1px solid #000', dashed: '1px dashed #000' };
const ALIGN = { l: 'left', r: 'right', c: 'center' };

function gridHTML(grid, font) {
  const { v, h } = effectiveLines(grid);
  const rows = grid.rows.map((row, r) => {
    const cells = [];
    row.forEach((cell, c) => {
      if (!cell) return;
      const col = grid.cols[c];
      const style = [
        `border-top:${BORDER[h[r][c]] || 'none'}`,
        `border-bottom:${BORDER[h[r + cell.rowspan][c]] || 'none'}`,
        `border-left:${BORDER[v[r][c]] || 'none'}`,
        `border-right:${BORDER[v[r][c + cell.colspan]] || 'none'}`,
        `text-align:${ALIGN[cell.align || col.align]}`,
        'vertical-align:middle',
        `padding:2pt ${col.kind === 'mark' ? '2pt' : '6pt'} 2pt ${col.kind === 'cand' && grid.cols[c - 1]?.kind === 'mark' ? '2pt' : '6pt'}`,
        'white-space:nowrap',
      ];
      if (cell.shade) style.push('background:#d4d4d4');
      const span = (cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '') + (cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '');
      cells.push(`<td${span} style="${style.join(';')}">${runsHTML(cell.runs) || '&nbsp;'}</td>`);
    });
    return `<tr>${cells.join('')}</tr>`;
  });
  return `<table style="border-collapse:collapse;font-family:'${font}','Charis SIL','Andika','Cambria','Times New Roman',serif;font-size:11pt">${rows.join('')}</table>`;
}

const runsText = runs => runs.map(r => r.t).join('');

// Plain-text fallback: tab-separated cells.
function gridTSV(grid) {
  return grid.rows.map(row => row.map(cell => (cell ? runsText(cell.runs) : '')).join('\t')).join('\n');
}

export function docsCode(grids, opts) {
  return {
    html: grids.map(g => gridHTML(g, opts.font)).join('<p></p>'),
    text: grids.map(gridTSV).join('\n\n'),
  };
}

// ---------------------------------------------------------------------------
// Markdown (GitHub-flavoured pipe tables). No spans, shading or dashed
// lines; the mark and candidate columns are merged into one.

const escMD = s => s.replace(/\\/g, '\\\\').replace(/([|*_`<>])/g, '\\$1');

function runsMD(runs) {
  return runs.map(r => {
    let s = escMD(r.t);
    if (r.sub) s = `<sub>${s}</sub>`;
    if (r.sup) s = `<sup>${s}</sup>`;
    if (r.it && s.trim()) s = `*${s}*`;
    return s;
  }).join('').split(ENSP).join(' ');
}

function gridMD(grid) {
  const n = grid.cols.length;
  // merge each candidate column into the mark column before it
  const keep = [...Array(n).keys()].filter(c => !(grid.cols[c].kind === 'cand' && grid.cols[c - 1]?.kind === 'mark'));
  const text = (r, c) => {
    const cell = grid.rows[r][c];
    if (!cell) return '';
    let s = runsMD(cell.runs);
    const next = grid.rows[r][c + 1];
    if (grid.cols[c].kind === 'mark' && cell.colspan === 1 && next) s = [s, runsMD(next.runs)].filter(Boolean).join(' ');
    return s;
  };
  const line = r => `| ${keep.map(c => text(r, c) || ' ').join(' | ')} |`;
  const align = keep.map(c => ({ l: ':--', r: '--:', c: ':-:' })[grid.cols[c].kind === 'mark' ? 'l' : grid.cols[c].align]);
  const out = [line(0), `| ${align.join(' | ')} |`];
  for (let r = 1; r < grid.rows.length; r++) out.push(line(r));
  return out.join('\n');
}

export function markdownCode(grids) {
  return grids.map(gridMD).join('\n\n') + '\n';
}
