// Layout of grids into "scenes" (rects, lines, text fragments), and scene
// output as SVG markup or onto a canvas.

import { effectiveLines } from './grid.js';

// Fonts without IPA letters (e.g. Atkinson Hyperlegible) fall back to Noto
// Sans for them, glyph by glyph.
export const IPA_FALLBACK = 'Noto Sans';

export const fontStack = font =>
  `"${font}", "${IPA_FALLBACK}", "Noto Sans Math", "Noto Sans Symbols 2", "Segoe UI Symbol", "Apple Symbols", sans-serif`;

const SHADE = '#d4d4d4';
const measureCtx = document.createElement('canvas').getContext('2d');

// Split runs into drawable fragments: synthesized small caps, sub/superscripts.
export function fragments(runs, fs) {
  const out = [];
  for (const r of runs) {
    const size = r.sub || r.sup ? fs * 0.7 : fs;
    const dy = r.sub ? fs * 0.22 : r.sup ? -fs * 0.36 : 0;
    const push = (t, s) => {
      const last = out[out.length - 1];
      if (last && last.size === s && last.dy === dy && last.it === !!r.it) last.t += t;
      else out.push({ t, size: s, dy, it: !!r.it });
    };
    if (r.sc) {
      for (const ch of r.t) {
        if (/[a-z]/.test(ch)) push(ch.toUpperCase(), size * 0.78);
        else push(ch, size);
      }
    } else if (r.t) {
      push(r.t, size);
    }
  }
  return out;
}

export function measure(frags, font) {
  let w = 0;
  for (const f of frags) {
    measureCtx.font = `${f.it ? 'italic ' : ''}${f.size}px ${fontStack(font)}`;
    f.w = measureCtx.measureText(f.t).width;
    w += f.w;
  }
  return w;
}

// Lay out a grid. Returns a scene { width, height, items }.
// Column and row boundaries fall on whole pixels, and each 1px rule is drawn
// through the middle of the pixel after its boundary (see snap below), so
// horizontal and vertical rules meet exactly at every corner.
export function layoutGrid(grid, { font, fontSize: fs, margin = 1 }) {
  const em = fs;
  const { v, h } = effectiveLines(grid);
  const R = grid.rows.length;
  const Cn = grid.cols.length;
  const lineH = fs * 1.3;
  const padY = fs * 0.3;
  const rowH = Math.round(lineH + 2 * padY);

  const cols = grid.cols.map(c => ({ ...c }));
  // an empty mark column takes no space
  cols.forEach((c, i) => {
    if (c.kind !== 'mark') return;
    const empty = grid.rows.every(row => !row[i] || row[i].colspan > 1 || !row[i].runs.length);
    if (empty) { c.padL = 0; c.padR = 0; if (cols[i + 1]) cols[i + 1].padL = 0.45; }
  });

  const cellFrags = grid.rows.map(row => row.map(cell => {
    if (!cell) return null;
    const frags = fragments(cell.runs, fs);
    return { frags, w: measure(frags, font) };
  }));

  const widths = cols.map((c, i) => {
    let w = 0;
    grid.rows.forEach((row, r) => {
      const cell = row[i];
      if (cell && cell.colspan === 1) w = Math.max(w, cellFrags[r][i].w + (c.padL + c.padR) * em);
    });
    if (c.kind === 'con' || c.kind === 'extra') w = Math.max(w, 2.2 * em);
    return w;
  });
  // widen the last column of a span if the spanning cell needs more room
  grid.rows.forEach((row, r) => row.forEach((cell, i) => {
    if (!cell || cell.colspan === 1) return;
    const need = cellFrags[r][i].w + (cols[i].padL + cols[i + cell.colspan - 1].padR) * em;
    const have = widths.slice(i, i + cell.colspan).reduce((a, b) => a + b, 0);
    if (need > have) widths[i + cell.colspan - 1] += need - have;
  }));

  const xs = [margin];
  widths.forEach(w => xs.push(xs[xs.length - 1] + Math.ceil(w)));
  const ys = Array.from({ length: R + 1 }, (_, r) => margin + r * rowH);
  const items = [];

  // shading and hit areas
  grid.rows.forEach((row, r) => row.forEach((cell, i) => {
    if (!cell) return;
    const x0 = xs[i], x1 = xs[i + cell.colspan], y0 = ys[r], y1 = ys[r + cell.rowspan];
    if (cell.shade) items.push({ type: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0, fill: SHADE });
    if (cell.meta) items.push({ type: 'hit', x: x0, y: y0, w: x1 - x0, h: y1 - y0, meta: cell.meta });
  }));

  // text
  grid.rows.forEach((row, r) => row.forEach((cell, i) => {
    if (!cell) return;
    const { frags, w } = cellFrags[r][i];
    const c0 = cols[i], c1 = cols[i + cell.colspan - 1];
    const x0 = xs[i] + c0.padL * em, x1 = xs[i + cell.colspan] - c1.padR * em;
    const align = cell.align || c0.align;
    let x = align === 'r' ? x1 - w : align === 'c' ? (x0 + x1 - w) / 2 : x0;
    const midY = (ys[r] + ys[r + cell.rowspan]) / 2;
    const base = midY + fs * 0.32;
    for (const f of frags) {
      items.push({ type: 'text', x, y: base + f.dy, t: f.t, size: f.size, it: f.it });
      x += f.w;
    }
  }));

  // lines, merged into maximal segments per style
  const seg = (x1, y1, x2, y2, style) => items.push({ type: 'line', x1, y1, x2, y2, dash: style === 'dashed' });
  for (let b = 0; b <= Cn; b++) {
    let start = null, style = null;
    for (let r = 0; r <= R; r++) {
      const s = r < R ? v[r][b] : null;
      if (s !== style) {
        if (style) seg(xs[b], ys[start], xs[b], ys[r], style);
        start = r; style = s;
      }
    }
  }
  for (let b = 0; b <= R; b++) {
    let start = null, style = null;
    for (let c = 0; c <= Cn; c++) {
      const s = c < Cn ? h[b][c] : null;
      if (s !== style) {
        if (style) seg(xs[start], ys[b], xs[c], ys[b], style);
        start = c; style = s;
      }
    }
  }
  // the last rules occupy the pixel after the final boundary
  return { width: xs[Cn] + 1 + margin, height: ys[R] + 1 + margin, items, font };
}

// Stack several scenes vertically.
export function stackScenes(scenes, gap) {
  if (scenes.length === 1) return scenes[0];
  const items = [];
  let y = 0;
  let width = 0;
  for (const s of scenes) {
    for (const it of s.items) {
      const c = { ...it };
      if ('y' in c) c.y += y;
      if ('y1' in c) { c.y1 += y; c.y2 += y; }
      items.push(c);
    }
    y += s.height + Math.round(gap);
    width = Math.max(width, s.width);
  }
  return { width, height: y - Math.round(gap), items, font: scenes[0].font };
}

// A rule at boundary x is drawn through the centre of pixel [x, x+1].
const snap = x => Math.round(x) + 0.5;

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = x => Math.round(x * 100) / 100;

export function toSVG(scene, { fontCSS = '', background = null, interactive = false, stroke = '#000' } = {}) {
  const { width, height } = scene;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${r2(width)}" height="${r2(height)}" viewBox="0 0 ${r2(width)} ${r2(height)}">`];
  if (fontCSS) out.push(`<style>${fontCSS}</style>`);
  if (background) out.push(`<rect width="100%" height="100%" fill="${background}"/>`);
  const fam = esc(fontStack(scene.font));
  for (const it of scene.items) {
    if (it.type === 'rect') out.push(`<rect x="${r2(it.x)}" y="${r2(it.y)}" width="${r2(it.w)}" height="${r2(it.h)}" fill="${it.fill}"/>`);
  }
  out.push(`<g stroke="${stroke}" stroke-width="1" fill="none" stroke-linecap="square">`);
  for (const it of scene.items) {
    if (it.type !== 'line') continue;
    const [x1, y1, x2, y2] = it.free ? [it.x1, it.y1, it.x2, it.y2] : [snap(it.x1), snap(it.y1), snap(it.x2), snap(it.y2)];
    out.push(`<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}"${it.dash ? ' stroke-dasharray="3 3" stroke-linecap="butt"' : ''}/>`);
  }
  out.push('</g>');
  out.push(`<g font-family="${fam}" fill="${stroke}">`);
  for (const it of scene.items) {
    if (it.type !== 'text') continue;
    out.push(`<text x="${r2(it.x)}" y="${r2(it.y)}" font-size="${r2(it.size)}"${it.it ? ' font-style="italic"' : ''} xml:space="preserve">${esc(it.t)}</text>`);
  }
  out.push('</g>');
  if (interactive) {
    for (const it of scene.items) {
      if (it.type !== 'hit') continue;
      out.push(`<rect class="hit" x="${r2(it.x)}" y="${r2(it.y)}" width="${r2(it.w)}" height="${r2(it.h)}" fill="transparent" data-cand="${it.meta.cand}" data-con="${it.meta.con}"/>`);
    }
  }
  out.push('</svg>');
  return out.join('');
}

export function toCanvas(scene, { scale = 2, background = '#fff', stroke = '#000' } = {}) {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(scene.width * scale);
  cv.height = Math.ceil(scene.height * scale);
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, scene.width, scene.height); }
  for (const it of scene.items) {
    if (it.type === 'rect') { ctx.fillStyle = it.fill; ctx.fillRect(it.x, it.y, it.w, it.h); }
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  for (const it of scene.items) {
    if (it.type !== 'line') continue;
    ctx.setLineDash(it.dash ? [3, 3] : []);
    ctx.lineCap = it.dash ? 'butt' : 'square';
    ctx.beginPath();
    if (it.free) { ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x2, it.y2); }
    else { ctx.moveTo(snap(it.x1), snap(it.y1)); ctx.lineTo(snap(it.x2), snap(it.y2)); }
    ctx.stroke();
  }
  ctx.fillStyle = stroke;
  ctx.textBaseline = 'alphabetic';
  for (const it of scene.items) {
    if (it.type !== 'text') continue;
    ctx.font = `${it.it ? 'italic ' : ''}${it.size}px ${fontStack(scene.font)}`;
    ctx.fillText(it.t, it.x, it.y);
  }
  return cv;
}

// ---------------------------------------------------------------------------
// Fonts

const loadedCSS = new Set();

export async function loadFont(font) {
  // Noto Sans Math is only registered here: the browser downloads it the
  // first time a logic symbol needs it
  const fams = [font, IPA_FALLBACK, 'Noto Sans Symbols 2', 'Noto Sans Math'];
  for (const f of fams) {
    if (loadedCSS.has(f)) continue;
    loadedCSS.add(f);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}:ital,wght@0,400;1,400&display=swap`;
    if (f === 'Noto Sans Symbols 2' || f === 'Noto Sans Math') link.href = `https://fonts.googleapis.com/css2?family=${f.replace(/ /g, '+')}&display=swap`;
    document.head.appendChild(link);
    await new Promise(res => { link.onload = res; link.onerror = res; });
  }
  try {
    await Promise.all([
      document.fonts.load(`16px "${font}"`, 'aəʃ'),
      document.fonts.load(`16px "${IPA_FALLBACK}"`, 'əʃŋ'),
      document.fonts.load(`italic 16px "${font}"`, 'H'),
      document.fonts.load('16px "Noto Sans Symbols 2"', '☞☹✗'),
    ]);
  } catch { /* fall back to whatever is available */ }
}

// Self-contained @font-face CSS for an SVG export, subset to the glyphs used.
export async function embeddedFontCSS(scene) {
  const text = [...new Set(scene.items.filter(i => i.type === 'text').map(i => i.t).join(''))].join('');
  if (!text) return '';
  const fetchFaces = async (family, spec) => {
    const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}${spec}&text=${encodeURIComponent(text)}`;
    const css = await (await fetch(url)).text();
    const faces = [];
    for (const block of css.match(/@font-face\s*{[^}]*}/g) || []) {
      const src = block.match(/url\(([^)]+)\)/);
      if (!src) continue;
      const buf = await (await fetch(src[1])).arrayBuffer();
      const b64 = await new Promise(res => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(new Blob([buf]));
      });
      const woff2 = new TextDecoder().decode(new Uint8Array(buf, 0, 4)) === 'wOF2';
      const [mime, fmt] = woff2 ? ['font/woff2', 'woff2'] : ['font/ttf', 'truetype'];
      faces.push(block.replace(/src:[^;]+;/, `src: url(${b64.replace(/^data:[^;]*/, `data:${mime}`)}) format('${fmt}');`));
    }
    return faces.join('\n');
  };
  try {
    const hasItalic = scene.items.some(i => i.type === 'text' && i.it);
    const main = await fetchFaces(scene.font, hasItalic ? ':ital@0;1' : '');
    const ipa = scene.font !== IPA_FALLBACK && /[^\x00-\x7F]/.test(text) ? await fetchFaces(IPA_FALLBACK, '') : '';
    const symbols = /[☞☹✗]/.test(text) ? await fetchFaces('Noto Sans Symbols 2', '') : '';
    const math = /[←-⋿□◇⟦⟧⨀-⫿]/.test(text) ? await fetchFaces('Noto Sans Math', '') : '';
    return [main, ipa, symbols, math].join('\n');
  } catch {
    return '';
  }
}
