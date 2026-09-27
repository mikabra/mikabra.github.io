// LaTeX (plain tabular) and Typst (native table) code from grids.

import { effectiveLines } from './grid.js';
import { toLatex, escapeLatex } from './ipa.js';
import { ENSP } from './rich.js';

const SYM_LATEX = {
  hand: ['\\ding{43}', 'pifont'],
  cross: ['\\ding{55}', 'pifont'],
  frown: ['\\frownie{}', 'wasysym'],
  bomb: ['\\faBomb{}', 'fontawesome5'],
  arrow: ['$\\rightarrow$', null],
};

const markColEmpty = (grid, i) =>
  grid.rows.every(row => !row[i] || row[i].colspan > 1 || !row[i].runs.length);

// ---------------------------------------------------------------------------
// LaTeX

export function runsLatex(runs, ctx) {
  return runs.map(r => {
    if (r.sym) {
      const [cmd, pkg] = SYM_LATEX[r.sym];
      if (pkg) ctx.pkgs.add(pkg);
      return cmd;
    }
    let s;
    if (r.ipa) {
      const res = toLatex(r.t, ctx.ipa);
      if (res.tipa) ctx.pkgs.add('tipa');
      if (res.tone) ctx.tone = true;
      if (/\\(Box|Diamond|leadsto|nexists)\b/.test(res.latex)) ctx.pkgs.add('amssymb');
      res.unknown.forEach(u => ctx.unknown.add(u));
      s = res.latex;
    } else {
      s = escapeLatex(r.t).split(ENSP).join('\\enspace{}');
    }
    if (r.sc) s = `\\textsc{${s}}`;
    if (r.it) s = `\\textit{${s}}`;
    if (r.sub) s = `\\textsubscript{${s}}`;
    if (r.sup) s = `\\textsuperscript{${s}}`;
    return s;
  }).join('');
}

const VL = { solid: '|', dashed: ':' };

function gridLatex(grid, ctx) {
  const { v, h, own } = effectiveLines(grid);
  const Cn = grid.cols.length;
  let spec = '';
  grid.cols.forEach((c, i) => {
    const before = grid.vl[i];
    if (before === 'dashed') ctx.pkgs.add('arydshln');
    if (c.kind === 'cand' && grid.cols[i - 1]?.kind === 'mark') {
      spec += markColEmpty(grid, i - 1) ? '@{}' : '@{\\hspace{0.3em}}';
    } else {
      spec += VL[before] || '';
    }
    if (c.kind === 'mark' && markColEmpty(grid, i)) spec += '@{}';
    spec += c.align;
  });
  spec += VL[grid.vl[Cn]] || '';

  const hline = b => {
    const row = h[b];
    if (row.every(s => s === 'solid')) return '\\hline';
    const segs = [];
    let start = null;
    for (let c = 0; c <= Cn; c++) {
      const on = c < Cn && row[c] === 'solid';
      if (on && start === null) start = c;
      if (!on && start !== null) { segs.push(`\\cline{${start + 1}-${c}}`); start = null; }
    }
    return segs.join(' ');
  };

  const lines = [`\\begin{tabular}{${spec}}`];
  const hl0 = hline(0);
  if (hl0) lines.push(hl0);
  grid.rows.forEach((row, r) => {
    const cells = [];
    for (let c = 0; c < Cn;) {
      const cell = row[c];
      if (!cell) {
        const o = own[r][c];
        if (o && o.r < r) {
          // under a \multirow: an empty placeholder (with the same width)
          if (o.colspan > 1) cells.push(`\\multicolumn{${o.colspan}}{${c === 0 ? VL[v[r][0]] || '' : ''}l${VL[v[r][c + o.colspan]] || ''}}{}`);
          else cells.push('');
          c += o.colspan;
        } else {
          cells.push('');
          c += 1;
        }
        continue;
      }
      let body = runsLatex(cell.runs, ctx);
      // after \\ a leading [ or * would be read as an optional argument
      if (c === 0 && /^[[*]/.test(body)) body = `{}${body}`;
      if (cell.rowspan > 1) { body = `\\multirow{${cell.rowspan}}{*}{${body}}`; ctx.pkgs.add('multirow'); }
      if (cell.shade) { body = `\\cellcolor[gray]{0.83}${body}`; ctx.pkgs.add('colortbl'); }
      const align = cell.align || grid.cols[c].align;
      if (cell.colspan > 1 || align !== grid.cols[c].align) {
        const left = c === 0 ? VL[v[r][0]] || '' : '';
        const right = VL[v[r][c + cell.colspan]] || '';
        body = `\\multicolumn{${cell.colspan}}{${left}${align}${right}}{${body}}`;
      }
      cells.push(body);
      c += cell.colspan;
    }
    lines.push(`  ${cells.join(' & ')} \\\\`);
    const hl = hline(r + 1);
    if (hl) lines.push(hl);
  });
  lines.push('\\end{tabular}');
  return lines.join('\n');
}

const PKG_ORDER = ['tikz', 'amssymb', 'tipa', 'pifont', 'wasysym', 'fontawesome5', 'colortbl', 'arydshln', 'multirow'];

// \usepackage lines for the packages a piece of code needs.
export function usepackages(ctx) {
  return PKG_ORDER.filter(p => ctx.pkgs.has(p))
    .map(p => (p === 'tipa' && ctx.tone ? '\\usepackage[tone]{tipa}' : `\\usepackage{${p}}`));
}

// fontspec preamble lines for a Unicode (XeLaTeX/LuaLaTeX) document.
export const unicodeFontLines = font =>
  ['% Compile with XeLaTeX or LuaLaTeX.', '\\usepackage{fontspec}', `\\setmainfont{${font}}`];

// Typst font list: the chosen font, then fallbacks with IPA letters.
export const typstFonts = font => `("${font}", "Noto Sans", "New Computer Modern")`;

export function latexCode(grids, opts) {
  const ctx = { ipa: opts.latexIpa, pkgs: new Set(), unknown: new Set() };
  const bodies = grids.map(g => gridLatex(g, ctx));
  const pkgs = usepackages(ctx);
  const body = bodies.join('\n\n\\medskip\n\n');
  let code;
  if (opts.latexStandalone) {
    const pre = ['\\documentclass[border=4pt,varwidth=100cm]{standalone}'];
    if (opts.latexIpa === 'unicode') {
      pre.push(...unicodeFontLines(opts.font));
    }
    pre.push(...pkgs);
    code = `${pre.join('\n')}\n\\begin{document}\n\n${body}\n\n\\end{document}\n`;
  } else {
    const notes = [];
    if (pkgs.length) notes.push(`% Requires: ${pkgs.join(' ')}`);
    if (opts.latexIpa === 'unicode') notes.push('% IPA as Unicode: compile with XeLaTeX/LuaLaTeX and an IPA font (e.g. fontspec + Noto Sans or Charis SIL).');
    code = (notes.length ? notes.join('\n') + '\n' : '') + body + '\n';
  }
  return { code, unknown: [...ctx.unknown] };
}

// ---------------------------------------------------------------------------
// Typst

const tstr = s => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const sameStyle = (a, b) => !!a.sc === !!b.sc && !!a.it === !!b.it && !!a.sub === !!b.sub && !!a.sup === !!b.sup;

export function runsTypst(runs) {
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && sameStyle(last, r)) last.t += r.t;
    else merged.push({ ...r });
  }
  return merged.map(r => {
    let s = `#${tstr(r.t)}`;
    if (r.sc) s = `#smallcaps[${s}]`;
    if (r.it) s = `#emph[${s}]`;
    if (r.sub) s = `#sub[${s}]`;
    if (r.sup) s = `#super[${s}]`;
    return s;
  }).join('');
}

const ALIGN_T = { l: 'left', r: 'right', c: 'center' };
const STROKE = { solid: '0.6pt', dashed: '(thickness: 0.6pt, dash: "dashed")' };

function gridTypst(grid) {
  const { v, h } = effectiveLines(grid);
  const Cn = grid.cols.length;
  const R = grid.rows.length;
  const out = ['#table('];
  out.push(`  columns: ${Cn},`);
  out.push(`  align: (${grid.cols.map(c => `${ALIGN_T[c.align]} + horizon`).join(', ')}),`);
  out.push('  stroke: none,');
  const mi = grid.cols.findIndex(c => c.kind === 'mark');
  if (mi >= 0) {
    // the mark (☞ a.) and candidate columns sit close together
    out.push(markColEmpty(grid, mi)
      ? `  inset: (x, y) => (x: if x == ${mi} { 0pt } else { 0.5em }, y: 0.35em),`
      : `  inset: (x, y) => (
    left: if x == ${mi + 1} { 0.25em } else { 0.5em },
    right: if x == ${mi} { 0.25em } else { 0.5em },
    y: 0.35em,
  ),`);
  } else {
    out.push('  inset: (x: 0.5em, y: 0.35em),');
  }
  // lines as maximal segments
  for (let b = 0; b <= R; b++) {
    let start = null, style = null;
    for (let c = 0; c <= Cn; c++) {
      const s = c < Cn ? h[b][c] : null;
      if (s !== style) {
        if (style) out.push(`  table.hline(y: ${b}${start ? `, start: ${start}` : ''}${c < Cn ? `, end: ${c}` : ''}, stroke: ${STROKE[style]}),`);
        start = c; style = s;
      }
    }
  }
  for (let b = 0; b <= Cn; b++) {
    let start = null, style = null;
    for (let r = 0; r <= R; r++) {
      const s = r < R ? v[r][b] : null;
      if (s !== style) {
        if (style) out.push(`  table.vline(x: ${b}${start ? `, start: ${start}` : ''}${r < R ? `, end: ${r}` : ''}, stroke: ${STROKE[style]}),`);
        start = r; style = s;
      }
    }
  }
  grid.rows.forEach(row => {
    const cells = [];
    row.forEach((cell, c) => {
      if (!cell) return;
      const args = [];
      if (cell.colspan > 1) args.push(`colspan: ${cell.colspan}`);
      if (cell.rowspan > 1) args.push(`rowspan: ${cell.rowspan}`);
      if (cell.shade) args.push('fill: luma(212)');
      const align = cell.align || grid.cols[c].align;
      if (align !== grid.cols[c].align) args.push(`align: ${ALIGN_T[align]} + horizon`);
      const body = `[${runsTypst(cell.runs)}]`;
      cells.push(args.length ? `table.cell(${args.join(', ')})${body}` : body);
    });
    out.push(`  ${cells.join(', ')},`);
  });
  out.push(')');
  return out.join('\n');
}

export function typstCode(grids, opts) {
  const body = grids.map(gridTypst).join('\n\n#v(1em)\n\n');
  const head = opts.typstStandalone
    ? `#set page(width: auto, height: auto, margin: 6pt)\n#set text(font: ${typstFonts(opts.font)})\n\n`
    : '';
  return `${head}${body}\n`;
}
