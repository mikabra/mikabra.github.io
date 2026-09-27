// Rich text: a cell's content is an array of runs
//   { t: string, sc?: small caps, sub?, sup?, it?, ipa?: user text that may
//     contain IPA (converted to tipa in LaTeX), sym?: 'hand'|'frown'|... }

export const ENSP = String.fromCharCode(0x2002); // en space between mark and letter

export const plain = t => (t ? [{ t }] : []);
// Inputs and candidates: IPA text with the same _{…} / ^{…} markup as names.
export const form = t => (t ? parseName(t, false) : []);

// Constraint names: `_{...}` / `_x` for subscripts, `^{...}` / `^x` for
// superscripts, `\_` and `\^` for literal characters.
export function parseName(src, sc = true) {
  const runs = [];
  let buf = '';
  const flush = () => { if (buf) runs.push({ t: buf, ipa: true, sc }); buf = ''; };
  const chars = [...src];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '\\' && (chars[i + 1] === '_' || chars[i + 1] === '^')) { buf += chars[++i]; continue; }
    if ((ch === '_' || ch === '^') && i + 1 < chars.length) {
      let arg = '';
      if (chars[i + 1] === '{') {
        let j = i + 2;
        while (j < chars.length && chars[j] !== '}') arg += chars[j++];
        i = j;
      } else {
        arg = chars[++i];
      }
      flush();
      if (arg) runs.push({ t: arg, ipa: true, sc, [ch === '_' ? 'sub' : 'sup']: true });
      continue;
    }
    buf += ch;
  }
  flush();
  return runs;
}

export const runsText = runs => runs.map(r => r.t).join('');

export const SYMBOLS = {
  hand: '☞', arrow: '→', frown: '☹', bomb: '💣', cross: '✗',
};

export const sym = s => ({ t: SYMBOLS[s], sym: s });
