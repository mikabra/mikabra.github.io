// Saving and loading: share links, JSON files, OTSoft tab-delimited files,
// and built-in examples.

import { uid, normalize, blankState, withModeDefaults, parseViol, parseObs } from './model.js';

const b64url = bytes => {
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = str => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// Compact JSON for links: ids are rewritten to short ones.
function compact(state) {
  const s = JSON.parse(JSON.stringify(state));
  const map = new Map();
  const short = id => { if (!map.has(id)) map.set(id, map.size.toString(36)); return map.get(id); };
  s.constraints.forEach(c => { c.id = short(c.id); });
  s.groups.forEach(g => {
    g.id = short(g.id);
    g.candidates.forEach(k => {
      k.id = short(k.id);
      const v = {};
      for (const [cid, raw] of Object.entries(k.viol)) if (String(raw).trim() && map.has(cid)) v[map.get(cid)] = raw;
      k.viol = v;
      if (k.mark === 'auto') delete k.mark;
      if (k.obs === '') delete k.obs;
    });
    if (g.winner) g.winner = map.get(g.winner) ?? null;
  });
  const shade = {};
  for (const [key, on] of Object.entries(s.shade || {})) {
    const [k, c] = key.split(':');
    if (on && map.has(k) && map.has(c)) shade[`${map.get(k)}:${map.get(c)}`] = true;
  }
  s.shade = shade;
  return s;
}

export async function toShareHash(state) {
  const json = new TextEncoder().encode(JSON.stringify(compact(state)));
  const z = await pipe(json, new CompressionStream('deflate-raw'));
  return `t=${b64url(z)}`;
}

export async function fromShareHash(hash) {
  const m = hash.match(/(?:^#?|&)t=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const bytes = await pipe(unb64url(m[1]), new DecompressionStream('deflate-raw'));
  return normalize(JSON.parse(new TextDecoder().decode(bytes)));
}

export function toJSON(state) {
  return JSON.stringify(compact(state), null, 2);
}

export function fromJSON(text) {
  const s = JSON.parse(text);
  if (!Array.isArray(s.constraints) || !Array.isArray(s.groups)) throw new Error('Not a tableau file.');
  return normalize(s);
}

// ---------------------------------------------------------------------------
// OTSoft: tab-delimited; row 1 full constraint names, row 2 abbreviations,
// then input, candidate, frequency, violations (input blank for further
// candidates of the same input).

export function fromOTSoft(text, mode) {
  const rows = text.replace(/\r/g, '').split('\n').filter(l => l.trim()).map(l => l.split('\t'));
  if (rows.length < 3) throw new Error('Expected two header rows followed by candidate rows.');
  const full = rows[0].slice(3);
  const abbr = rows[1].slice(3);
  const n = Math.max(full.length, abbr.length);
  const constraints = [];
  for (let i = 0; i < n; i++) {
    const name = (abbr[i] || full[i] || `C${i + 1}`).trim();
    if (!name && !(full[i] || '').trim()) continue;
    constraints.push({ id: uid('c'), name, weight: 1, tie: false });
  }
  const groups = [];
  for (const r of rows.slice(2)) {
    const input = (r[0] || '').trim();
    if (input || !groups.length) groups.push({ id: uid('g'), input, winner: null, candidates: [] });
    const g = groups[groups.length - 1];
    const k = { id: uid('k'), form: (r[1] || '').trim(), obs: (r[2] || '').trim(), mark: 'auto', viol: {} };
    constraints.forEach((c, i) => {
      const raw = (r[3 + i] || '').trim();
      if (raw && raw !== '0') k.viol[c.id] = raw;
    });
    g.candidates.push(k);
  }
  const state = blankState(mode);
  state.constraints = constraints;
  state.groups = groups;
  // with 0/1 frequencies (a winner per input), use them as intended winners
  for (const g of groups) {
    const pos = g.candidates.filter(k => parseObs(k.obs) > 0);
    if (mode !== 'me' && pos.length === 1) g.winner = pos[0].id;
  }
  return normalize(withModeDefaults(state, mode));
}

export function toOTSoft(state) {
  const cons = state.constraints;
  const lines = [
    ['', '', '', ...cons.map(c => c.name)].join('\t'),
    ['', '', '', ...cons.map(c => c.name)].join('\t'),
  ];
  for (const g of state.groups) {
    g.candidates.forEach((k, i) => {
      const freq = state.mode === 'me' ? String(k.obs ?? '') : (g.winner ? (g.winner === k.id ? '1' : '0') : String(k.obs ?? ''));
      lines.push([i === 0 ? g.input : '', k.form, freq, ...cons.map(c => String(parseViol(k.viol[c.id]).n))].join('\t'));
    });
  }
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Examples

function build(mode, cons, groups, extra = {}) {
  const s = blankState(mode);
  s.constraints = cons.map(([name, weight = 1, tie = false]) => ({ id: uid('c'), name, weight, tie }));
  s.groups = groups.map(([input, cands]) => ({
    id: uid('g'), input, winner: null,
    candidates: cands.map(([form, viols, obs = '']) => {
      const k = { id: uid('k'), form, obs: String(obs), mark: 'auto', viol: {} };
      viols.forEach((v, i) => { if (v) k.viol[s.constraints[i].id] = String(v); });
      return k;
    }),
  }));
  Object.assign(s.opts, extra);
  return s;
}

export const EXAMPLES = [
  {
    id: 'ot-basic', label: 'OT: coda deletion',
    make: () => build('ot', [['*Coda'], ['Max'], ['Dep']], [
      ['/pat/', [['[pat]', [1, 0, 0]], ['[pa]', [0, 1, 0]], ['[pa.tə]', [0, 0, 1]]]],
    ]),
  },
  {
    id: 'ot-strata', label: 'OT: unranked constraints, two inputs',
    make: () => build('ot', [['*NC̥', 1, false], ['Ident-IO[nas]', 1, true], ['Max-IO', 1, false], ['Ident-IO[voi]']], [
      ['/kampa/', [['[kampa]', [1, 0, 0, 0]], ['[kapa]', [0, 0, 1, 0]], ['[kamba]', [0, 0, 0, 1]], ['[kamma]', [0, 1, 0, 1]]]],
      ['/tanta/', [['[tanta]', [1, 0, 0, 0]], ['[tada]', [0, 0, 1, 1]], ['[tanda]', [0, 0, 0, 1]]]],
    ]),
  },
  {
    id: 'hg-gang', label: 'HG: gang effect (Japanese devoicing)',
    make: () => build('hg', [['Ident-IO(voi)', 3], ['*Voi-Gem', 2], ['OCP(voi)', 2]], [
      ['/baɡɡu/', [['[baɡɡu]', [0, 1, 1]], ['[bakku]', [1, 0, 0]]]],
      ['/eɡɡu/', [['[eɡɡu]', [0, 1, 0]], ['[ekku]', [1, 0, 0]]]],
    ], { layout: 'separate' }),
  },
  {
    id: 'me-var', label: 'MaxEnt: variable t/d-deletion',
    make: () => build('me', [['*CC', 1.2], ['Max', 1.5], ['Max-Prevocalic', 3.1]], [
      ['/west ɛnd/', [['[wɛst ɛnd]', [1, 0, 0], 0.7], ['[wɛs ɛnd]', [0, 1, 1], 0.3]]],
      ['/west lɛɡ/', [['[wɛst lɛɡ]', [2, 0, 0], 0.4], ['[wɛs lɛɡ]', [1, 1, 0], 0.6]]],
    ], { layout: 'combined', inputHeader: 'Input', candHeader: 'Output' }),
  },
];
