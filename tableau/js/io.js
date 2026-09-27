// Saving and loading: share links, JSON files, OTSoft tab-delimited files,
// and built-in examples.

import { uid, normalize, blankState, withModeDefaults, parseViol, parseObs, intendedWinners } from './model.js';
import { freezeAuto } from './grid.js';

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
    if (mode !== 'me' && pos.length === 1) { g.winner = pos[0].id; pos[0].mark = 'hand'; }
  }
  return normalize(withModeDefaults(state, mode));
}

export function toOTSoft(state) {
  const cons = state.constraints;
  const lines = [
    ['', '', '', ...cons.map(c => c.name)].join('\t'),
    ['', '', '', ...cons.map(c => c.name)].join('\t'),
  ];
  const iw = intendedWinners(state);
  state.groups.forEach((g, gi) => {
    g.candidates.forEach((k, i) => {
      const freq = state.mode === 'me' ? String(k.obs ?? '') : (iw[gi] === k.id ? '1' : '0');
      lines.push([i === 0 ? g.input : '', k.form, freq, ...cons.map(c => String(parseViol(k.viol[c.id]).n))].join('\t'));
    });
  });
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Examples, each reproducing a published tableau. `source` is shown above
// the editor. Checked against the PDFs linked below.

function build(mode, cons, groups, { opts = {}, source = null } = {}) {
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
  Object.assign(s.opts, opts);
  s.source = source;
  // evaluate once, then keep the result as an ordinary hand-editable tableau
  s.auto = true;
  freezeAuto(s);
  return s;
}

const PATER_2009 = 'https://people.umass.edu/pater/pater-cogsci-2009.pdf';
const PATER_1999 = 'https://roa.rutgers.edu/files/160-1196/roa-160-pater-5.pdf';
const ZURAW_HAYES_2017 = 'https://brucehayes.org/papers/ZurawHayes2017IntersectingConstraintFamilies.pdf';
const NC = '*NC̥';

export const EXAMPLES = [
  {
    id: 'ot-devoicing', label: 'OT: final devoicing (Pater 2009)',
    make: () => build('ot', [['*Coda-Voice'], ['Ident-Voice']], [
      ['/bad/', [['bad', [1, 0]], ['pad', [1, 1]], ['[bat]', [0, 1]], ['pat', [0, 2]]]],
    ], {
      source: {
        text: 'Pater, Joe (2009). Weighted constraints in generative linguistics. Cognitive Science 33: 999–1035. Example (5), p. 1004: final devoicing in OT.',
        url: PATER_2009,
      },
    }),
  },
  {
    id: 'ot-indonesian', label: 'OT: unranked Max and Dep, Indonesian (Pater 1999)',
    make: () => build('ot', [['Max', 1, true], ['Dep'], [NC]], [
      ['/əmpat/', [['əmpat', [0, 0, 1]], ['əpat', [1, 0, 0]], ['əməpat', [0, 1, 0]]]],
    ], {
      source: {
        text: 'Pater, Joe (1999). Austronesian nasal substitution and other NC̥ effects. In R. Kager, H. van der Hulst & W. Zonneveld (eds.), The Prosody–Morphology Interface. Cambridge University Press. Example (9): Indonesian əmpat ‘four’. Max and Dep are unranked with respect to each other (dashed line), and both dominate *NC̥. Pater’s Indonesian data are from Lapoliwa (1981).',
        url: PATER_1999,
      },
    }),
  },
  {
    id: 'hg-japanese', label: 'HG: gang effect in Japanese loanwords (Pater 2009)',
    make: () => build('hg', [['Ident-Voice', 1.5], ['*Vce-Gem', 1], ['OCP-Voice', 1]], [
      ['/bobu/', [['[bobu]', [0, 0, 1]], ['bopu', [1, 0, 0]]]],
      ['/webːu/', [['[webːu]', [0, 1, 0]], ['wepːu', [1, 0, 0]]]],
      ['/dogːu/', [['dogːu', [0, 1, 1]], ['[dokːu]', [1, 0, 0]]]],
    ], {
      opts: { layout: 'separate' },
      source: {
        text: 'Pater, Joe (2009). Weighted constraints in generative linguistics. Cognitive Science 33: 999–1035. Example (22), p. 1013: Japanese loanword devoicing as cumulative constraint interaction, after Nishimura (2003, 2006), with data from Kawahara (2006). Length is written ː here (Pater writes “:”). Pater’s first two tableaux omit the constraint that neither candidate violates.',
        url: PATER_2009,
      },
    }),
  },
  {
    id: 'me-tagalog', label: 'MaxEnt: Tagalog nasal substitution (Zuraw & Hayes 2017)',
    make: () => build('me', [
      ['NasSub', 2.31], [NC, 4.85], ['*[_{root} m/n/ŋ', 0.00], ['*[_{root} n/ŋ', 2.13], ['*[_{root} ŋ', 1.16],
      ['Unif-maŋ-_{other}', 0.00], ['Unif-paŋ-red-', 0.82], ['Unif-maŋ-_{adv}', 1.92],
      ['Unif-maŋ-red-', 2.29], ['Unif-paŋ-_{noun}', 4.06], ['Unif-paŋ-_{res}', 6.01],
    ], [
      ['/paŋ_{noun} + t…/', [
        ['[pa-n…]', [0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0], 60.5],
        ['[pan-t…]', [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], 29.5],
      ]],
    ], {
      opts: { decimals: 4 },
      source: {
        text: 'Zuraw, Kie & Bruce Hayes (2017). Intersecting constraint families: an argument for Harmonic Grammar. Language 93(3). Sample MaxEnt tableau (9), p. 504, using the fitted weights of Table 1, p. 506. Observed: 60.5 words with substitution, 29.5 without. The paper’s predicted probabilities are .73 and .27.',
        url: ZURAW_HAYES_2017,
      },
    }),
  },
];

