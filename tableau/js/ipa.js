// IPA symbol inventory: palette data, search, and conversion to tipa.
//
// Each symbol: c = character(s), n = name, t = tipa (inside \textipa),
// x = X-SAMPA (for search), k = kind ('comb' for combining marks,
// 'text' for symbols emitted outside \textipa via `tx`).
// In combining-mark tipa patterns, `#` stands for the base symbol.

const S = (c, n, t, x = '') => ({ c, n, t, x });
const M = (c, n, t, x = '') => ({ c, n, t, x, k: 'comb' });
const T = (c, n, tx, x = '') => ({ c, n, tx, x, k: 'text' });

// Pulmonic consonant chart: rows are manners, columns are places (bilabial,
// labiodental, dental, alveolar, postalveolar, retroflex, palatal, velar,
// uvular, pharyngeal, glottal). Each cell is [voiceless, voiced]; null means
// empty, '#' means judged impossible.

const C = {
  p: S('p', 'voiceless bilabial plosive', 'p', 'p'),
  b: S('b', 'voiced bilabial plosive', 'b', 'b'),
  t: S('t', 'voiceless alveolar plosive', 't', 't'),
  d: S('d', 'voiced alveolar plosive', 'd', 'd'),
  tr: S('ʈ', 'voiceless retroflex plosive', '\\:t', 't`'),
  dr: S('ɖ', 'voiced retroflex plosive', '\\:d', 'd`'),
  c: S('c', 'voiceless palatal plosive', 'c', 'c'),
  jj: S('ɟ', 'voiced palatal plosive (barred dotless j)', '\\textbardotlessj', 'J\\'),
  k: S('k', 'voiceless velar plosive', 'k', 'k'),
  g: S('ɡ', 'voiced velar plosive (script g)', 'g', 'g'),
  q: S('q', 'voiceless uvular plosive', 'q', 'q'),
  G: S('ɢ', 'voiced uvular plosive (small capital G)', '\\;G', 'G\\'),
  gs: S('ʔ', 'glottal stop', 'P', '?'),
  m: S('m', 'bilabial nasal', 'm', 'm'),
  mj: S('ɱ', 'labiodental nasal', 'M', 'F'),
  n: S('n', 'alveolar nasal', 'n', 'n'),
  nr: S('ɳ', 'retroflex nasal', '\\:n', 'n`'),
  nj: S('ɲ', 'palatal nasal (left-tail n)', '\\textltailn', 'J'),
  ng: S('ŋ', 'velar nasal (eng, engma)', 'N', 'N'),
  N: S('ɴ', 'uvular nasal (small capital N)', '\\;N', 'N\\'),
  B: S('ʙ', 'bilabial trill (small capital B)', '\\;B', 'B\\'),
  r: S('r', 'alveolar trill', 'r', 'r'),
  R: S('ʀ', 'uvular trill (small capital R)', '\\;R', 'R\\'),
  vf: { c: 'ⱱ', n: 'labiodental flap', t: null, x: '' },
  tap: S('ɾ', 'alveolar tap / flap (fish-hook r)', 'R', '4'),
  rf: S('ɽ', 'retroflex flap', '\\:r', 'r`'),
  ph: S('ɸ', 'voiceless bilabial fricative (phi)', 'F', 'p\\'),
  bh: S('β', 'voiced bilabial fricative (beta)', 'B', 'B'),
  f: S('f', 'voiceless labiodental fricative', 'f', 'f'),
  v: S('v', 'voiced labiodental fricative', 'v', 'v'),
  th: S('θ', 'voiceless dental fricative (theta)', 'T', 'T'),
  dh: S('ð', 'voiced dental fricative (eth)', 'D', 'D'),
  s: S('s', 'voiceless alveolar fricative', 's', 's'),
  z: S('z', 'voiced alveolar fricative', 'z', 'z'),
  sh: S('ʃ', 'voiceless postalveolar fricative (esh)', 'S', 'S'),
  zh: S('ʒ', 'voiced postalveolar fricative (ezh, yogh)', 'Z', 'Z'),
  sr: S('ʂ', 'voiceless retroflex fricative', '\\:s', 's`'),
  zr: S('ʐ', 'voiced retroflex fricative', '\\:z', 'z`'),
  cc: S('ç', 'voiceless palatal fricative (c cedilla)', 'C', 'C'),
  jc: S('ʝ', 'voiced palatal fricative (curly-tail j)', 'J', 'j\\'),
  x: S('x', 'voiceless velar fricative', 'x', 'x'),
  gh: S('ɣ', 'voiced velar fricative (gamma)', 'G', 'G'),
  X: S('χ', 'voiceless uvular fricative (chi)', 'X', 'X'),
  Rf: S('ʁ', 'voiced uvular fricative (inverted small capital R)', 'K', 'R'),
  hb: S('ħ', 'voiceless pharyngeal fricative (barred h)', '\\textcrh', 'X\\'),
  ain: S('ʕ', 'voiced pharyngeal fricative (reversed glottal stop)', 'Q', '?\\'),
  h: S('h', 'voiceless glottal fricative', 'h', 'h'),
  hv: S('ɦ', 'voiced glottal fricative (hooktop h)', 'H', 'h\\'),
  lf: S('ɬ', 'voiceless alveolar lateral fricative (belted l)', '\\textbeltl', 'K'),
  lz: S('ɮ', 'voiced alveolar lateral fricative (l-ezh)', '\\textlyoghlig', 'K\\'),
  va: S('ʋ', 'labiodental approximant (script v)', 'V', 'P'),
  ra: S('ɹ', 'alveolar approximant (turned r)', '\\*r', 'r\\'),
  rra: S('ɻ', 'retroflex approximant', '\\:R', 'r\\`'),
  j: S('j', 'palatal approximant', 'j', 'j'),
  wa: S('ɰ', 'velar approximant (turned m, right leg)', '\\textturnmrleg', 'M\\'),
  l: S('l', 'alveolar lateral approximant', 'l', 'l'),
  lr: S('ɭ', 'retroflex lateral approximant', '\\:l', 'l`'),
  lj: S('ʎ', 'palatal lateral approximant (turned y)', 'L', 'L'),
  L: S('ʟ', 'velar lateral approximant (small capital L)', '\\;L', 'L\\'),
};

// rows: [manner, cells per place]
export const PULMONIC = [
  ['Plosive', [['p', 'b'], null, null, ['t', 'd'], null, ['tr', 'dr'], ['c', 'jj'], ['k', 'g'], ['q', 'G'], '#', ['gs', null]]],
  ['Nasal', [[null, 'm'], [null, 'mj'], null, [null, 'n'], null, [null, 'nr'], [null, 'nj'], [null, 'ng'], [null, 'N'], '#', '#']],
  ['Trill', [[null, 'B'], null, null, [null, 'r'], null, null, null, '#', [null, 'R'], null, '#']],
  ['Tap or flap', [null, [null, 'vf'], null, [null, 'tap'], null, [null, 'rf'], null, '#', null, null, '#']],
  ['Fricative', [['ph', 'bh'], ['f', 'v'], ['th', 'dh'], ['s', 'z'], ['sh', 'zh'], ['sr', 'zr'], ['cc', 'jc'], ['x', 'gh'], ['X', 'Rf'], ['hb', 'ain'], ['h', 'hv']]],
  ['Lateral fricative', ['#', '#', null, ['lf', 'lz'], null, null, null, null, null, '#', '#']],
  ['Approximant', [null, [null, 'va'], null, [null, 'ra'], null, [null, 'rra'], [null, 'j'], [null, 'wa'], null, null, '#']],
  ['Lateral approximant', ['#', '#', null, [null, 'l'], null, [null, 'lr'], [null, 'lj'], [null, 'L'], null, '#', '#']],
].map(([manner, cells]) => [manner, cells.map(cell =>
  cell === '#' || cell === null ? cell : cell.map(k => (k ? C[k] : null)))]);

// Vowel chart: [height, [front unrounded, front rounded, central unr., central r., back unr., back r.]]
const V = {
  i: S('i', 'close front unrounded vowel', 'i', 'i'),
  y: S('y', 'close front rounded vowel', 'y', 'y'),
  ib: S('ɨ', 'close central unrounded vowel (barred i)', '1', '1'),
  ub: S('ʉ', 'close central rounded vowel (barred u)', '0', '}'),
  um: S('ɯ', 'close back unrounded vowel (turned m)', 'W', 'M'),
  u: S('u', 'close back rounded vowel', 'u', 'u'),
  I: S('ɪ', 'near-close front unrounded vowel (small capital I)', 'I', 'I'),
  Y: S('ʏ', 'near-close front rounded vowel (small capital Y)', 'Y', 'Y'),
  U: S('ʊ', 'near-close back rounded vowel (upsilon)', 'U', 'U'),
  e: S('e', 'close-mid front unrounded vowel', 'e', 'e'),
  oe2: S('ø', 'close-mid front rounded vowel (slashed o)', '\\o', '2'),
  re: S('ɘ', 'close-mid central unrounded vowel (reversed e)', '9', '@\\'),
  bo: S('ɵ', 'close-mid central rounded vowel (barred o)', '8', '8'),
  ram: S('ɤ', 'close-mid back unrounded vowel (ram\'s horns)', '7', '7'),
  o: S('o', 'close-mid back rounded vowel', 'o', 'o'),
  schwa: S('ə', 'mid central vowel (schwa)', '@', '@'),
  E: S('ɛ', 'open-mid front unrounded vowel (epsilon)', 'E', 'E'),
  oe: S('œ', 'open-mid front rounded vowel (o-e ligature)', '\\oe', '9'),
  rE: S('ɜ', 'open-mid central unrounded vowel (reversed epsilon)', '3', '3'),
  crE: S('ɞ', 'open-mid central rounded vowel (closed reversed epsilon)', '\\textcloserevepsilon', '3\\'),
  wedge: S('ʌ', 'open-mid back unrounded vowel (wedge, turned v)', '2', 'V'),
  O: S('ɔ', 'open-mid back rounded vowel (open o)', 'O', 'O'),
  ae: S('æ', 'near-open front unrounded vowel (ash)', '\\ae', '{'),
  ta: S('ɐ', 'near-open central vowel (turned a)', '5', '6'),
  a: S('a', 'open front unrounded vowel', 'a', 'a'),
  OE: S('ɶ', 'open front rounded vowel (small capital OE)', '\\OE', '&'),
  A: S('ɑ', 'open back unrounded vowel (script a, alpha)', 'A', 'A'),
  Q: S('ɒ', 'open back rounded vowel (turned script a)', '6', 'Q'),
};

export const VOWELS = [
  ['Close', ['i', 'y', 'ib', 'ub', 'um', 'u']],
  ['Near-close', ['I', 'Y', null, null, null, 'U']],
  ['Close-mid', ['e', 'oe2', 're', 'bo', 'ram', 'o']],
  ['Mid', [null, null, 'schwa', null, null, null]],
  ['Open-mid', ['E', 'oe', 'rE', 'crE', 'wedge', 'O']],
  ['Near-open', ['ae', null, 'ta', null, null, null]],
  ['Open', ['a', 'OE', null, null, 'A', 'Q']],
].map(([h, cells]) => [h, cells.map(k => (k ? V[k] : null))]);

export const GROUPS = [
  {
    id: 'other', label: 'Other consonants', items: [
      S('ʘ', 'bilabial click (bull\'s eye)', '\\!o', 'O\\'),
      S('ǀ', 'dental click (pipe)', '\\textpipe', '|\\'),
      S('ǃ', '(post)alveolar click', '!', '!\\'),
      S('ǂ', 'palatoalveolar click (double-barred pipe)', '\\textdoublebarpipe', '=\\'),
      S('ǁ', 'alveolar lateral click (double pipe)', '\\textdoublepipe', '|\\|\\'),
      S('ɓ', 'bilabial implosive', '\\!b', 'b_<'),
      S('ɗ', 'alveolar implosive', '\\!d', 'd_<'),
      S('ʄ', 'palatal implosive', '\\!j', 'J\\_<'),
      S('ɠ', 'velar implosive', '\\!g', 'g_<'),
      S('ʛ', 'uvular implosive', '\\!G', 'G\\_<'),
      S('ʼ', 'ejective (apostrophe)', '\'', '_>'),
      S('ʍ', 'voiceless labial-velar fricative (turned w)', '\\textturnw', 'W'),
      S('w', 'voiced labial-velar approximant', 'w', 'w'),
      S('ɥ', 'voiced labial-palatal approximant (turned h)', '4', 'H'),
      S('ʜ', 'voiceless epiglottal fricative (small capital H)', '\\;H', 'H\\'),
      S('ʢ', 'voiced epiglottal fricative', '\\textbarrevglotstop', '<\\'),
      S('ʡ', 'epiglottal plosive (barred glottal stop)', '\\textbarglotstop', '>\\'),
      S('ɕ', 'voiceless alveolo-palatal fricative (curly-tail c)', '\\textctc', 's\\'),
      S('ʑ', 'voiced alveolo-palatal fricative (curly-tail z)', '\\textctz', 'z\\'),
      S('ɺ', 'alveolar lateral flap', '\\textturnlonglegr', 'l\\'),
      S('ɧ', 'simultaneous ʃ and x (hooktop heng)', '\\texththeng', 'x\\'),
      S('t\u0361ʃ', 'voiceless postalveolar affricate (ch)', '\\t{tS}', 'tS'),
      S('d\u0361ʒ', 'voiced postalveolar affricate (j)', '\\t{dZ}', 'dZ'),
      S('t\u0361s', 'voiceless alveolar affricate (ts)', '\\t{ts}', 'ts'),
      S('d\u0361z', 'voiced alveolar affricate (dz)', '\\t{dz}', 'dz'),
      S('ɚ', 'rhotacized schwa', '\\textrhookschwa', '@`'),
      S('ɝ', 'rhotacized open-mid central vowel', '\\textrhookrevepsilon', '3`'),
    ],
  },
  {
    id: 'diacritics', label: 'Diacritics', comb: true, items: [
      M('\u0325', 'voiceless (ring below)', '\\r*{#}', '_0'),
      M('\u030A', 'voiceless (ring above)', '\\r{#}', '_0'),
      M('\u032C', 'voiced (caron below)', '\\v*{#}', '_v'),
      S('ʰ', 'aspirated (superscript h)', '\\super{h}', '_h'),
      M('\u0339', 'more rounded', '\\textsubrhalfring{#}', '_O'),
      M('\u031C', 'less rounded', '\\textsublhalfring{#}', '_c'),
      M('\u031F', 'advanced (plus below)', '\\textsubplus{#}', '_+'),
      M('\u0320', 'retracted (bar below)', '\\textsubbar{#}', '_-'),
      M('\u0308', 'centralized (umlaut)', '\\"{#}', '_"'),
      M('\u033D', 'mid-centralized (cross above)', '\\textovercross{#}', '_x'),
      M('\u0329', 'syllabic (stroke below)', '\\s{#}', '='),
      M('\u032F', 'non-syllabic (arch below)', '\\textsubarch{#}', '_^'),
      S('˞', 'rhoticity (rhotic hook)', '\\textrhoticity', '`'),
      M('\u0324', 'breathy voiced (diaeresis below)', '\\textsubumlaut{#}', '_t'),
      M('\u0330', 'creaky voiced (tilde below)', '\\textsubtilde{#}', '_k'),
      M('\u033C', 'linguolabial (seagull)', '\\textseagull{#}', '_N'),
      S('ʷ', 'labialized (superscript w)', '\\super{w}', '_w'),
      S('ʲ', 'palatalized (superscript j)', '\\super{j}', '\''),
      S('ˠ', 'velarized (superscript gamma)', '\\super{G}', '_G'),
      S('ˤ', 'pharyngealized (superscript reversed glottal stop)', '\\super{Q}', '_?\\'),
      M('\u0334', 'velarized or pharyngealized (tilde through)', '\\textsuperimposetilde{#}', '_e'),
      M('\u031D', 'raised', '\\textraising{#}', '_r'),
      M('\u031E', 'lowered', '\\textlowering{#}', '_o'),
      M('\u0318', 'advanced tongue root (ATR)', '\\textadvancing{#}', '_A'),
      M('\u0319', 'retracted tongue root (RTR)', '\\textretracting{#}', '_q'),
      M('\u032A', 'dental (bridge below)', '\\textsubbridge{#}', '_d'),
      M('\u033A', 'apical', '\\textinvsubbridge{#}', '_a'),
      M('\u033B', 'laminal', '\\textsubsquare{#}', '_m'),
      M('\u0303', 'nasalized (tilde)', '\\~{#}', '~'),
      S('ⁿ', 'nasal release (superscript n)', '\\super{n}', '_n'),
      S('ˡ', 'lateral release (superscript l)', '\\super{l}', '_l'),
      M('\u031A', 'no audible release (corner)', '#{\\textcorner}', '_}'),
      M('\u0361', 'tie bar above (affricate / double articulation)', 'TIE', '_'),
      M('\u035C', 'tie bar below', 'TIEB', '_'),
    ],
  },
  {
    id: 'supra', label: 'Suprasegmentals', items: [
      S('ˈ', 'primary stress', '"', '"'),
      S('ˌ', 'secondary stress', '""', '%'),
      S('ː', 'long (length mark)', ':', ':'),
      S('ˑ', 'half-long', ';', ':\\'),
      M('\u0306', 'extra-short (breve)', '\\u{#}', '_X'),
      S('.', 'syllable break', '.', '.'),
      T('|', 'minor (foot) group', '\\textbar{}', '|'),
      T('‖', 'major (intonation) group', '\\textbardbl{}', '||'),
      S('‿', 'linking (absence of a break)', '\\textbottomtiebar{}', '-\\'),
    ],
  },
  {
    id: 'tones', label: 'Tones', comb: true, items: [
      M('\u030B', 'extra-high tone (double acute)', '\\H{#}', '_T'),
      M('\u0301', 'high tone (acute)', '\\\'{#}', '_H'),
      M('\u0304', 'mid tone (macron)', '\\={#}', '_M'),
      M('\u0300', 'low tone (grave)', '\\`{#}', '_L'),
      M('\u030F', 'extra-low tone (double grave)', '\\textdoublegrave{#}', '_B'),
      M('\u030C', 'rising tone (caron / haček)', '\\v{#}', '_R'),
      M('\u0302', 'falling tone (circumflex)', '\\^{#}', '_F'),
      S('˥', 'extra-high tone letter', 'TONE5', '_T'),
      S('˦', 'high tone letter', 'TONE4', '_H'),
      S('˧', 'mid tone letter', 'TONE3', '_M'),
      S('˨', 'low tone letter', 'TONE2', '_L'),
      S('˩', 'extra-low tone letter', 'TONE1', '_B'),
      S('ꜜ', 'downstep', '\\textdownstep{}', '!'),
      S('ꜛ', 'upstep', '\\textupstep{}', '^'),
      S('↗', 'global rise', '\\textglobrise{}', '<R>'),
      S('↘', 'global fall', '\\textglobfall{}', '<F>'),
    ],
  },
  {
    id: 'phon', label: 'Phonology', items: [
      T('σ', 'syllable (sigma)', '$\\sigma$'),
      T('μ', 'mora (mu)', '$\\mu$'),
      T('ω', 'prosodic word (omega)', '$\\omega$'),
      T('φ', 'phonological phrase (phi)', '$\\phi$'),
      T('∅', 'empty / null (zero)', '$\\emptyset$'),
      T('→', 'becomes (rightward arrow)', '$\\rightarrow$'),
      T('~', 'alternates with (tilde)', '$\\sim$'),
      T('⟨', 'left angle bracket (orthography)', '$\\langle$'),
      T('⟩', 'right angle bracket (orthography)', '$\\rangle$'),
      T('·', 'middle dot (morpheme / syllable boundary)', '\\textperiodcentered{}'),
      T('#', 'word boundary (hash)', '\\#'),
      T('+', 'morpheme boundary (plus)', '+'),
      T('–', 'en dash', '--'),
    ],
  },
];

// Everything searchable, with the chart symbols included.
export const ALL = [
  ...Object.values(C), ...Object.values(V),
  ...GROUPS.flatMap(g => g.items),
];

const BY_CHAR = new Map();
for (const s of ALL) if (!BY_CHAR.has(s.c)) BY_CHAR.set(s.c, s);

export function search(query, limit = 40) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const scored = [];
  for (const s of ALL) {
    let score = 0;
    if (s.c === query.trim()) score += 100;
    if (s.x && s.x.toLowerCase() === q) score += 50;
    const name = s.n.toLowerCase();
    if (words.every(w => name.includes(w))) {
      score += 10;
      if (name.startsWith(q)) score += 5;
      // whole-word hits (e.g. "schwa") rank above substrings
      if (words.every(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(name))) score += 5;
    }
    if (score) scored.push([score, s]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const seen = new Set();
  const out = [];
  for (const [, s] of scored) {
    if (seen.has(s.c)) continue;
    seen.add(s.c);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export function describe(ch) {
  return BY_CHAR.get(ch);
}

// ---------------------------------------------------------------------------
// tipa conversion

const LATEX_SPECIAL = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&',
  '#': '\\#', '_': '\\_', '%': '\\%', '~': '$\\sim$', '^': '\\textasciicircum{}',
  '|': '\\textbar{}', '<': '\\textless{}', '>': '\\textgreater{}', '−': '$-$',
  '☞': '\\ding{43}', '✗': '\\ding{55}', '☹': '\\frownie{}', '💣': '\\faBomb{}',
  '→': '$\\rightarrow$', '·': '\\textperiodcentered{}',
};

export function escapeLatexChar(ch) {
  return LATEX_SPECIAL[ch] ?? ch;
}

export function escapeLatex(str) {
  return [...str].map(escapeLatexChar).join('');
}

const isComb = ch => /\p{M}/u.test(ch);
const TIE_ABOVE = '\u0361';
const TIE_BELOW = '\u035C';
const TONE_DIGIT = { '˥': '5', '˦': '4', '˧': '3', '˨': '2', '˩': '1' };

// A base symbol's tipa form. Control words get braces so they can be
// followed by letters safely: {\ae}n rather than \aen.
function tipaBase(ch) {
  if (/^[a-z]$/.test(ch)) return ch;
  const s = BY_CHAR.get(ch);
  if (!s || s.k === 'text' || !s.t || s.t.startsWith('TONE')) return null;
  return /^\\[a-zA-Z]+$/.test(s.t) ? `{${s.t}}` : s.t;
}

// Split a string into clusters: base + following combining marks, with
// tie bars joining two bases into one cluster.
function clusters(str) {
  const chars = [...str.normalize('NFD')];
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (isComb(ch) && out.length) {
      const last = out[out.length - 1];
      last.marks.push(ch);
      if ((ch === TIE_ABOVE || ch === TIE_BELOW) && i + 1 < chars.length && !isComb(chars[i + 1])) {
        last.tied = { mark: ch, base: chars[++i], marks: [] };
        // marks after the second base belong to it
        while (i + 1 < chars.length && isComb(chars[i + 1])) last.tied.marks.push(chars[++i]);
      }
    } else {
      out.push({ base: ch, marks: [] });
    }
  }
  return out;
}

// Apply combining marks (tipa patterns) around a tipa base. Returns null
// if any mark has no tipa equivalent.
function applyMarks(tipa, marks) {
  for (const m of marks) {
    if (m === TIE_ABOVE || m === TIE_BELOW) continue;
    const s = BY_CHAR.get(m);
    if (!s || !s.t || !s.t.includes('#')) return null;
    tipa = s.t.replace('#', tipa);
  }
  return tipa;
}

// Convert one cluster to {mode, out}: mode 'ipa' (inside \textipa),
// 'plain' (lowercase ASCII, fine either way) or 'text' (outside \textipa).
function convertCluster(cl) {
  const { base, marks, tied } = cl;
  const sym = BY_CHAR.get(base);
  if (sym && sym.k === 'text' && !marks.length) return { mode: 'text', out: sym.tx };
  if (TONE_DIGIT[base] && !marks.length) return { mode: 'tone', out: TONE_DIGIT[base] };
  let b = tipaBase(base);
  // a diacritic on a plain letter or digit (e.g. the C in NC̥): inside
  // \textipa, uppercase and digits are shortcuts, so shield the base
  if (b === null && marks.length && /^[A-Z0-9]$/.test(base)) b = `\\textnormal{${base}}`;
  if (b === null) {
    // not an IPA base: ASCII outside textipa (uppercase and digits are
    // tipa shortcuts), or a character tipa can't express
    const txt = escapeLatexChar(base) + marks.join('');
    return { mode: 'text', out: txt, unknown: !/^[\x20-\x7E]$/.test(base) && !LATEX_SPECIAL[base] };
  }
  let t = applyMarks(b, marks);
  if (t === null) return { mode: 'text', out: base + marks.join(''), unknown: true };
  if (tied) {
    const b2 = tipaBase(tied.base);
    const t2 = b2 === null ? null : applyMarks(b2, tied.marks);
    if (t2 === null) return { mode: 'text', out: base + marks.join('') + tied.base + tied.marks.join(''), unknown: true };
    t = tied.mark === TIE_BELOW ? `\\t*{${t}${t2}}` : `\\t{${t}${t2}}`;
  }
  const plain = /^[a-z.]$/.test(base) && !marks.length && !tied;
  return { mode: plain ? 'plain' : 'ipa', out: t };
}

// Convert text (possibly containing IPA) to LaTeX. With mode 'tipa',
// IPA runs become \textipa{...}; with 'unicode', text is escaped as is.
// Returns {latex, tipa: bool (tipa was used), tone: bool (needs the [tone]
// package option), unknown: [chars]}.
export function toLatex(str, mode = 'tipa') {
  if (mode === 'unicode') return { latex: escapeLatex(str), tipa: false, tone: false, unknown: [] };
  const cls = clusters(str).map(convertCluster);
  let out = '';
  let usedTipa = false;
  let tone = false;
  const unknown = [];
  let i = 0;
  while (i < cls.length) {
    const c = cls[i];
    if (c.mode === 'ipa' || c.mode === 'plain' || c.mode === 'tone') {
      // collect a run; it only needs \textipa if it contains real IPA
      let j = i;
      let run = '';
      let needs = false;
      while (j < cls.length && ['ipa', 'plain', 'tone'].includes(cls[j].mode)) {
        if (cls[j].mode === 'tone') {
          let digits = '';
          while (j < cls.length && cls[j].mode === 'tone') digits += cls[j++].out;
          run += `\\tone{${digits}}`;
          needs = true;
          tone = true;
          continue;
        }
        if (cls[j].mode === 'ipa') needs = true;
        run += cls[j].out;
        j++;
      }
      if (needs) {
        out += `\\textipa{${run}}`;
        usedTipa = true;
      } else {
        out += run;
      }
      i = j;
    } else {
      if (c.unknown) unknown.push(c.out);
      out += c.out;
      i++;
    }
  }
  return { latex: out, tipa: usedTipa, tone, unknown };
}
