// Hasse diagrams of constraint rankings: graph construction, layered
// layout, and output as a scene, TikZ or Typst.

import { strata, ercs, entailedRankings, transitiveReduction, transitiveClosure, evaluate } from './model.js';
import { parseName } from './rich.js';
import { fragments, measure } from './render.js';
import { runsLatex, runsTypst, usepackages, unicodeFontLines, typstFonts } from './export.js';

// Returns { nodes: [{ name }], edges: [[a, b]] (a dominates b), error? }
export function hasseGraph(state) {
  const cons = state.constraints;
  const src = state.opts.hasseSource;
  if (src === 'ranking') {
    const st = strata(cons);
    const edges = [];
    for (let s = 0; s + 1 < st.length; s++)
      for (const a of st[s]) for (const b of st[s + 1]) edges.push([a, b]);
    return { nodes: cons.map(c => ({ name: c.name })), edges };
  }
  if (src === 'custom') {
    const nodes = cons.map(c => ({ name: c.name }));
    const find = name => {
      const n = name.trim();
      let i = nodes.findIndex(x => x.name === n);
      if (i < 0) i = nodes.findIndex(x => x.name.toLowerCase() === n.toLowerCase());
      if (i < 0) { nodes.push({ name: n }); i = nodes.length - 1; }
      return i;
    };
    const pairs = [];
    const used = new Set();
    for (const chain of state.opts.hasseCustom.split(/[\n,;]+/)) {
      const parts = chain.split(/\s*(?:>>|≫|>)\s*/).map(s => s.trim()).filter(Boolean);
      const ids = parts.map(find);
      ids.forEach(i => used.add(i));
      for (let i = 0; i + 1 < ids.length; i++) pairs.push([ids[i], ids[i + 1]]);
    }
    const { pairs: closed, cyclic } = transitiveClosure(pairs, nodes.length);
    if (cyclic) return { nodes: [], edges: [], error: 'These rankings contain a cycle (e.g. A ≫ B ≫ A).' };
    // keep only constraints mentioned (or all, if nothing typed yet)
    const keep = used.size ? [...used].sort((a, b) => a - b) : nodes.map((_, i) => i);
    const idx = new Map(keep.map((k, i) => [k, i]));
    return {
      nodes: keep.map(k => nodes[k]),
      edges: transitiveReduction(closed).map(([a, b]) => [idx.get(a), idx.get(b)]),
    };
  }
  // entailed by the winners
  const rows = ercs(state, evaluate(state)).map(e => e.row);
  const res = entailedRankings(rows, cons.length);
  if (!res.consistent) {
    return { nodes: [], edges: [], error: 'No ranking makes every intended winner optimal, so there are no ranking arguments to draw. Check the comparative tableau for the conflict.' };
  }
  return { nodes: cons.map(c => ({ name: c.name })), edges: transitiveReduction(res.pairs) };
}

// Layered layout (longest path from the top, barycentre ordering).
export function layoutHasse(graph, { font, fontSize: fs, smallcaps }) {
  const n = graph.nodes.length;
  const preds = Array.from({ length: n }, () => []);
  const succs = Array.from({ length: n }, () => []);
  for (const [a, b] of graph.edges) { preds[b].push(a); succs[a].push(b); }
  const layer = Array(n).fill(-1);
  const depth = i => {
    if (layer[i] >= 0) return layer[i];
    layer[i] = 0; // guard against cycles
    layer[i] = preds[i].length ? 1 + Math.max(...preds[i].map(depth)) : 0;
    return layer[i];
  };
  for (let i = 0; i < n; i++) depth(i);
  const L = Math.max(0, ...layer) + 1;
  const layers = Array.from({ length: L }, () => []);
  for (let i = 0; i < n; i++) layers[layer[i]].push(i);

  const pos = Array(n).fill(0);
  const setPos = () => layers.forEach(ly => ly.forEach((v, i) => { pos[v] = i; }));
  setPos();
  const bary = (v, nbrs) => nbrs.length ? nbrs.reduce((a, u) => a + pos[u], 0) / nbrs.length : pos[v];
  for (let sweep = 0; sweep < 6; sweep++) {
    const down = sweep % 2 === 0;
    const order = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const ly of order) {
      const keyed = ly.map(v => [bary(v, down ? preds[v] : succs[v]), pos[v], v]);
      keyed.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      ly.splice(0, ly.length, ...keyed.map(k => k[2]));
      ly.forEach((v, i) => { pos[v] = i; });
    }
  }

  const runs = graph.nodes.map(nd => parseName(nd.name, smallcaps));
  const frs = runs.map(r => fragments(r, fs));
  const widths = frs.map(f => measure(f, font));
  const gap = fs * 1.6;
  const rowGap = fs * 3.4;
  const nodeH = fs * 1.4;
  const margin = fs * 0.6;
  const layerW = layers.map(ly => ly.reduce((a, v) => a + widths[v], 0) + gap * Math.max(0, ly.length - 1));
  const Wmax = Math.max(...layerW, 1);
  const xs = Array(n).fill(0);
  const ys = Array(n).fill(0);
  // start with every layer packed and centred
  layers.forEach((ly, li) => {
    let x = (Wmax - layerW[li]) / 2;
    for (const v of ly) {
      xs[v] = x + widths[v] / 2;
      ys[v] = margin + nodeH / 2 + li * rowGap;
      x += widths[v] + gap;
    }
  });
  // then pull nodes under (or over) their neighbours, keeping the order
  // within each layer and at least `gap` between nodes
  const place = (ly, nbrs) => {
    const want = ly.map(v => (nbrs[v].length ? nbrs[v].reduce((a, u) => a + xs[u], 0) / nbrs[v].length : xs[v]));
    const x = [...want];
    for (let i = 1; i < ly.length; i++) {
      const min = x[i - 1] + (widths[ly[i - 1]] + widths[ly[i]]) / 2 + gap;
      if (x[i] < min) x[i] = min;
    }
    // spread any push-back evenly so the layer stays near its targets
    const shift = ly.reduce((a, v, i) => a + (want[i] - x[i]), 0) / (ly.length || 1);
    ly.forEach((v, i) => { xs[v] = x[i] + shift; });
  };
  for (let li = 1; li < L; li++) place(layers[li], preds);
  for (let li = L - 2; li >= 0; li--) place(layers[li], succs);
  const left = Math.min(...xs.map((x, v) => x - widths[v] / 2));
  const right = Math.max(...xs.map((x, v) => x + widths[v] / 2));
  for (let v = 0; v < n; v++) xs[v] += margin - left;
  const W = right - left;
  const items = [];
  for (const [a, b] of graph.edges) {
    items.push({ type: 'line', x1: xs[a], y1: ys[a] + nodeH / 2, x2: xs[b], y2: ys[b] - nodeH / 2, free: true });
  }
  for (let v = 0; v < n; v++) {
    let x = xs[v] - widths[v] / 2;
    for (const f of frs[v]) {
      items.push({ type: 'text', x, y: ys[v] + fs * 0.32 + f.dy, t: f.t, size: f.size, it: f.it });
      x += f.w;
    }
  }
  return {
    width: W + 2 * margin,
    height: margin * 2 + nodeH + (L - 1) * rowGap,
    items, font, nodes: { xs, ys, widths, runs, nodeH }, fs,
  };
}

const f2 = x => (Math.round(x * 100) / 100).toFixed(2);

export function hasseTikz(graph, scene, opts) {
  const ctx = { ipa: opts.latexIpa, pkgs: new Set(['tikz']), unknown: new Set() };
  const { xs, ys, runs } = scene.nodes;
  const fs = scene.fs;
  const lines = [`\\begin{tikzpicture}[x=1em, y=1em]`];
  runs.forEach((r, i) => {
    lines.push(`  \\node (n${i}) at (${f2(xs[i] / fs)}, ${f2(-ys[i] / fs)}) {${runsLatex(r, ctx)}};`);
  });
  for (const [a, b] of graph.edges) lines.push(`  \\draw (n${a}) -- (n${b});`);
  lines.push('\\end{tikzpicture}');
  const pkgs = usepackages(ctx);
  const body = lines.join('\n');
  if (opts.latexStandalone) {
    const pre = ['\\documentclass[border=4pt]{standalone}'];
    if (opts.latexIpa === 'unicode') pre.push(...unicodeFontLines(opts.font));
    pre.push(...pkgs);
    return `${pre.join('\n')}\n\\begin{document}\n${body}\n\\end{document}\n`;
  }
  return `% Requires: ${pkgs.join(' ')}\n${body}\n`;
}

export function hasseTypst(graph, scene, opts) {
  const { xs, ys, runs, nodeH } = scene.nodes;
  const fs = scene.fs;
  const em = x => `${f2(x / fs)}em`;
  const out = [];
  if (opts.typstStandalone) out.push('#set page(width: auto, height: auto, margin: 6pt)', `#set text(font: ${typstFonts(opts.font)})`, '');
  out.push(`#box(width: ${em(scene.width)}, height: ${em(scene.height)})[`);
  for (const [a, b] of graph.edges) {
    out.push(`  #place(line(start: (${em(xs[a])}, ${em(ys[a] + nodeH / 2)}), end: (${em(xs[b])}, ${em(ys[b] - nodeH / 2)}), stroke: 0.6pt))`);
  }
  runs.forEach((r, i) => {
    out.push(`  #place(center + horizon, dx: ${em(xs[i] - scene.width / 2)}, dy: ${em(ys[i] - scene.height / 2)})[${runsTypst(r)}]`);
  });
  out.push(']');
  return out.join('\n') + '\n';
}
