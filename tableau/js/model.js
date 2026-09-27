// Tableau state, violation parsing and evaluation (OT, HG, MaxEnt),
// plus ranking tools: ERCs, RCD, entailed rankings and MaxEnt fitting.

let nextId = 1;
export const uid = p => `${p}${Date.now().toString(36)}${(nextId++).toString(36)}`;

export const DEFAULT_OPTS = {
  violStyle: 'stars',      // 'stars' | 'numbers'
  negative: false,         // show violations and harmonies as negative numbers
  zeroBlank: true,         // leave zero-violation cells empty
  fatal: true,             // OT: mark fatal violations with '!'
  shading: true,           // OT: shade cells that no longer matter
  labels: true,            // a. b. c. before candidates
  winnerMark: 'hand',      // 'hand' | 'arrow'
  wrongMark: 'frown',      // 'frown' | 'bomb' | 'cross'
  meMarks: false,          // MaxEnt: mark the most probable candidate
  layout: 'combined',      // 'combined' | 'separate' (multiple inputs)
  smallcaps: true,
  showWeights: true,
  showH: true,
  showEH: true,
  showP: true,
  showObs: true,
  decimals: 3,
  inputHeader: '',
  candHeader: '',
  compE: 'e',              // what to write in comparative cells with no preference
  font: 'Andika',          // sans serif with complete IPA coverage
  fontSize: 16,
  latexIpa: 'tipa',        // 'tipa' | 'unicode'
  latexStandalone: false,
  typstStandalone: false,
  pngScale: 3,
  pngBg: 'white',
  hasseSource: 'entailed', // 'ranking' | 'entailed' | 'custom'
  hasseCustom: '',
  sigma2: 100000,          // MaxEnt fitting: Gaussian prior variance (as in the MaxEnt Grammar Tool)
};

export function blankState(mode = 'ot') {
  const c1 = { id: uid('c'), name: '*Coda', weight: 3, tie: false };
  const c2 = { id: uid('c'), name: 'Max', weight: 2, tie: false };
  const c3 = { id: uid('c'), name: 'Dep', weight: 1, tie: false };
  const cand = (form, v) => ({ id: uid('k'), form, viol: v, obs: '', mark: 'auto' });
  const g = {
    id: uid('g'), input: '/pat/', winner: null, candidates: [
      cand('[pat]', { [c1.id]: '1' }),
      cand('[pa]', { [c2.id]: '1' }),
      cand('[pa.tə]', { [c3.id]: '1' }),
    ],
  };
  return withModeDefaults({
    version: 3, mode, view: 'tableau', manual: false, shade: {},
    constraints: [c1, c2, c3], groups: [g], opts: { ...DEFAULT_OPTS },
  }, mode);
}

export function withModeDefaults(state, mode) {
  state.mode = mode;
  state.opts.violStyle = mode === 'ot' ? 'stars' : 'numbers';
  state.opts.negative = mode === 'hg';
  if (mode !== 'ot') state.view = 'tableau';
  return state;
}

// Bring loaded/old states up to the current shape.
export function normalize(state) {
  state.opts = { ...DEFAULT_OPTS, ...(state.opts || {}) };
  // earlier versions defaulted to Charis SIL (v1) and Atkinson Hyperlegible (v2)
  const v = state.version || 1;
  if ((v < 2 && state.opts.font === 'Charis SIL') || (v < 3 && state.opts.font === 'Atkinson Hyperlegible')) state.opts.font = DEFAULT_OPTS.font;
  state.version = 3;
  state.shade ||= {};
  state.view ||= 'tableau';
  state.mode ||= 'ot';
  for (const c of state.constraints) {
    c.id ||= uid('c');
    c.weight = Number.isFinite(+c.weight) ? +c.weight : 0;
    c.tie = !!c.tie;
  }
  for (const g of state.groups) {
    g.id ||= uid('g');
    g.winner ??= null;
    for (const k of g.candidates) {
      k.id ||= uid('k');
      k.viol ||= {};
      k.obs ??= '';
      k.mark ||= 'auto';
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// Violations

// Raw cell text -> { n: count, bang: index of '!' among stars or -1, bad: bool }
export function parseViol(raw) {
  const s = String(raw ?? '').trim().replace(/−/g, '-');
  if (!s) return { n: 0, bang: -1, bad: false };
  if (/^[*!]+$/.test(s)) {
    const stars = s.replace(/!/g, '');
    const bi = s.indexOf('!');
    return { n: stars.length, bang: bi < 0 ? -1 : s.slice(0, bi).replace(/!/g, '').length, bad: false };
  }
  const m = s.match(/^(-?\d*\.?\d+)(!?)$/);
  if (m) return { n: Math.abs(parseFloat(m[1])), bang: m[2] ? Math.abs(parseFloat(m[1])) : -1, bad: false };
  return { n: 0, bang: -1, bad: true };
}

export const violOf = (cand, c) => parseViol(cand.viol[c.id]).n;

// Constraints grouped into strata (unranked neighbours share a stratum).
export function strata(constraints) {
  const out = [];
  let cur = [];
  constraints.forEach((c, i) => {
    cur.push(i);
    if (!c.tie || i === constraints.length - 1) { out.push(cur); cur = []; }
  });
  return out;
}

const EPS = 1e-9;

// ---------------------------------------------------------------------------
// OT evaluation. Returns per group: winners (Set of cand ids), and per cand:
// fatal: Map(constraintIndex -> star position of '!'), shadeFrom: column index
// from which cells are shaded (Infinity = none).
export function evalOT(state) {
  const cons = state.constraints;
  const st = strata(cons);
  return state.groups.map(g => {
    const cands = g.candidates;
    const V = cands.map(k => cons.map(c => violOf(k, c)));
    let alive = cands.map((_, i) => i);
    const info = cands.map(() => ({ fatal: new Map(), shadeFrom: Infinity }));
    let lastDecisive = -1;
    for (let s = 0; s < st.length && alive.length > 1; s++) {
      const cols = st[s];
      const pooled = i => cols.reduce((a, ci) => a + V[i][ci], 0);
      const best = Math.min(...alive.map(pooled));
      const losers = alive.filter(i => pooled(i) > best + EPS);
      if (!losers.length) continue;
      const survivors = alive.filter(i => pooled(i) <= best + EPS);
      const endCol = cols[cols.length - 1] + 1;
      for (const i of losers) {
        for (const ci of cols) {
          const bestHere = Math.min(...survivors.map(j => V[j][ci]));
          if (V[i][ci] > bestHere + EPS) info[i].fatal.set(ci, bestHere);
        }
        info[i].shadeFrom = endCol;
      }
      alive = survivors;
      lastDecisive = endCol;
    }
    if (lastDecisive >= 0) for (const i of alive) info[i].shadeFrom = lastDecisive;
    return { winners: new Set(alive.map(i => cands[i].id)), info };
  });
}

// ---------------------------------------------------------------------------
// HG / MaxEnt

// Penalty: sum of weight × violations (always non-negative for positive weights).
export const penalty = (state, k) =>
  state.constraints.reduce((a, c) => a + (+c.weight || 0) * violOf(k, c), 0);

export function evalHG(state) {
  return state.groups.map(g => {
    const pen = g.candidates.map(k => penalty(state, k));
    const best = Math.min(...pen);
    return {
      pen,
      winners: new Set(g.candidates.filter((_, i) => pen[i] <= best + EPS).map(k => k.id)),
    };
  });
}

export function evalME(state) {
  return state.groups.map(g => {
    const pen = g.candidates.map(k => penalty(state, k));
    const m = Math.min(...pen);
    const eh = pen.map(p => Math.exp(-p));
    // normalize with a shift for numerical stability
    const shifted = pen.map(p => Math.exp(-(p - m)));
    const Z = shifted.reduce((a, b) => a + b, 0);
    const P = shifted.map(x => x / Z);
    const maxP = Math.max(...P);
    return {
      pen, eh, P,
      winners: new Set(g.candidates.filter((_, i) => P[i] >= maxP - EPS).map(k => k.id)),
    };
  });
}

export function evaluate(state) {
  if (state.mode === 'hg') return evalHG(state);
  if (state.mode === 'me') return evalME(state);
  return evalOT(state);
}

export const parseObs = raw => {
  const x = parseFloat(String(raw ?? '').trim());
  return Number.isFinite(x) && x >= 0 ? x : 0;
};

// Fit MaxEnt weights to observed frequencies by projected gradient ascent
// on the log-likelihood with a Gaussian prior (mean 0, variance sigma2).
// Weights are kept non-negative. Returns { weights, logLik }.
export function fitMaxEnt(state, { sigma2 = 100000, iters = 50000 } = {}) {
  const cons = state.constraints;
  const data = state.groups.map(g => ({
    V: g.candidates.map(k => cons.map(c => violOf(k, c))),
    obs: g.candidates.map(k => parseObs(k.obs)),
  })).filter(d => d.obs.some(x => x > 0));
  if (!data.length) return null;
  let w = cons.map(c => Math.max(0, +c.weight || 0));

  const objective = w => {
    let ll = 0;
    const grad = w.map(() => 0);
    for (const { V, obs } of data) {
      const pen = V.map(v => v.reduce((a, x, j) => a + x * w[j], 0));
      const m = Math.min(...pen);
      const ex = pen.map(p => Math.exp(-(p - m)));
      const Z = ex.reduce((a, b) => a + b, 0);
      const P = ex.map(x => x / Z);
      const N = obs.reduce((a, b) => a + b, 0);
      const expV = w.map((_, j) => V.reduce((a, v, i) => a + P[i] * v[j], 0));
      V.forEach((v, i) => {
        if (obs[i] > 0) ll += obs[i] * Math.log(Math.max(P[i], 1e-300));
        v.forEach((x, j) => { grad[j] -= obs[i] * x; });
      });
      expV.forEach((e, j) => { grad[j] += N * e; });
    }
    const prior = sigma2 > 0 ? w.reduce((a, x) => a + x * x, 0) / (2 * sigma2) : 0;
    if (sigma2 > 0) w.forEach((x, j) => { grad[j] -= x / sigma2; });
    return { f: ll - prior, ll, grad };
  };

  let step = 0.1;
  let cur = objective(w);
  for (let t = 0; t < iters; t++) {
    const next = w.map((x, j) => Math.max(0, x + step * cur.grad[j]));
    const res = objective(next);
    if (res.f >= cur.f - 1e-12) {
      const moved = next.reduce((a, x, j) => a + Math.abs(x - w[j]), 0);
      w = next;
      cur = res;
      step *= 1.2;
      if (moved < 1e-10) break;
    } else {
      step *= 0.5;
      if (step < 1e-14) break;
    }
  }
  return { weights: w, logLik: cur.ll };
}

// ---------------------------------------------------------------------------
// ERCs and ranking

// The intended winner of each group: the user's choice, else the first
// computed winner.
export function intendedWinners(state, results = evaluate(state)) {
  return state.groups.map((g, gi) => {
    if (g.winner && g.candidates.some(k => k.id === g.winner)) return g.winner;
    const w = g.candidates.find(k => results[gi].winners.has(k.id));
    return w ? w.id : null;
  });
}

// Winner~loser pairs with W/L/e per constraint (in state.constraints order).
export function ercs(state, results = evaluate(state)) {
  const iw = intendedWinners(state, results);
  const out = [];
  state.groups.forEach((g, gi) => {
    const win = g.candidates.find(k => k.id === iw[gi]);
    if (!win) return;
    for (const l of g.candidates) {
      if (l === win) continue;
      const row = state.constraints.map(c => {
        const d = violOf(l, c) - violOf(win, c);
        return d > EPS ? 'W' : d < -EPS ? 'L' : 'e';
      });
      out.push({ group: g, gi, winner: win, loser: l, row });
    }
  });
  return out;
}

// Recursive Constraint Demotion over ERC rows (arrays of W/L/e).
// Returns { strata: [[constraint index]], consistent, stuck: [erc index] }.
export function rcd(rows, n) {
  let remaining = rows.map((r, i) => i).filter(i => rows[i].some(x => x !== 'e'));
  let left = [...Array(n).keys()];
  const out = [];
  while (left.length) {
    const top = left.filter(c => remaining.every(i => rows[i][c] !== 'L'));
    if (!top.length) return { strata: out, consistent: false, stuck: remaining, unranked: left };
    out.push(top);
    remaining = remaining.filter(i => !top.some(c => rows[i][c] === 'W'));
    left = left.filter(c => !top.includes(c));
  }
  return { strata: out, consistent: remaining.length === 0, stuck: remaining, unranked: [] };
}

// All pairs a >> b entailed by the ERCs: a >> b holds in every consistent
// total ranking iff adding "b >> a" (W on b, L on a) is inconsistent.
export function entailedRankings(rows, n) {
  const base = rcd(rows, n);
  if (!base.consistent) return { consistent: false, pairs: [] };
  const pairs = [];
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const extra = Array(n).fill('e');
      extra[b] = 'W';
      extra[a] = 'L';
      if (!rcd([...rows, extra], n).consistent) pairs.push([a, b]);
    }
  }
  return { consistent: true, pairs };
}

// Remove edges implied by transitivity.
export function transitiveReduction(pairs) {
  const set = new Set(pairs.map(p => p.join('>')));
  const succ = new Map();
  for (const [a, b] of pairs) {
    if (!succ.has(a)) succ.set(a, []);
    succ.get(a).push(b);
  }
  return pairs.filter(([a, b]) =>
    !(succ.get(a) || []).some(c => c !== b && set.has(`${c}>${b}`)));
}

// Close a relation transitively (for user-typed rankings).
export function transitiveClosure(pairs, n) {
  const R = Array.from({ length: n }, () => Array(n).fill(false));
  for (const [a, b] of pairs) R[a][b] = true;
  for (let k = 0; k < n; k++)
    for (let i = 0; i < n; i++)
      if (R[i][k]) for (let j = 0; j < n; j++) if (R[k][j]) R[i][j] = true;
  const out = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && R[i][j]) out.push([i, j]);
  const cyclic = R.some((row, i) => row[i]);
  return { pairs: out, cyclic };
}
