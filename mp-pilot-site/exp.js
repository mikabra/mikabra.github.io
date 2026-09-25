// Experiment logic, kept free of DOM code so it can be unit-tested in node.
//
// Each trial runs:  fixation  ->  context (alone, timed)  ->  choice  ->  [feedback if too slow]
// On the choice screen the context stays where it was, greyed, and the sentence frame and the two
// forms that differ between the candidates appear below it (e.g. "___ of her brothers are doctors."
// F: Both  /  J: All). The context screen reserves the space for the frame and options, invisibly,
// so nothing on screen moves when the choice appears.
//
// A session interleaves 60 critical trials (one of four lists) with 60 fillers, never more than
// MAX_RUN of either in a row, plus 6 attention checks.

const CONFIG = {
  KEY_LEFT: 'f',
  KEY_RIGHT: 'j',
  FIXATION_MS: 500,
  CONTEXT_BASE_MS: 1200,        // context display time = base + per-word, clamped to [min, max]
  CONTEXT_PER_WORD_MS: 250,
  CONTEXT_MIN_MS: 2500,
  CONTEXT_MAX_MS: 5000,
  RESPONSE_DEADLINE_MS: 8000,   // the trial ends if no key is pressed within this time
  TIMEOUT_FEEDBACK_MS: 1000,
  ITI_MS: 300,
  N_BREAKS: 2,
  ATTENTION_EVERY: 21,          // one attention check after every 21 critical + filler trials
  MAX_RUN: 2                    // at most this many critical (or filler) trials in a row
};

function mulberry32(seed) {           // small deterministic RNG, so runs are reproducible
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Reduce two candidate sentences to a shared frame and the two differing spans.
 * If one span would be empty (e.g. "too" vs nothing), the span is widened by one shared word,
 * so that both options are real text and neither is marked as "leave it out".
 */
function splitCandidates(a, b) {
  const strip = s => { const m = s.trim().match(/^(.*?)([.!?]*)$/); return [m[1], m[2]]; };
  const [aBody, punct] = strip(a); const [bBody] = strip(b);
  const A = aBody.split(/\s+/), B = bBody.split(/\s+/);
  let i = 0; while (i < A.length && i < B.length && A[i] === B[i]) i++;
  let j = 0; while (j < A.length - i && j < B.length - i && A[A.length - 1 - j] === B[B.length - 1 - j]) j++;
  // widen an empty span: take the preceding shared word, or failing that the following one
  if (A.length - i - j === 0 || B.length - i - j === 0) {
    if (i > 0) i--; else if (j > 0) j--;
  }
  return {
    prefix: A.slice(0, i).join(' '),
    optA: A.slice(i, A.length - j).join(' '),
    optB: B.slice(i, B.length - j).join(' '),
    suffix: A.slice(A.length - j).join(' '),
    punct
  };
}

function contextDuration(text, scale = 1) {
  const words = text.trim().split(/\s+/).length;
  const ms = CONFIG.CONTEXT_BASE_MS + CONFIG.CONTEXT_PER_WORD_MS * words;
  return Math.round(Math.min(CONFIG.CONTEXT_MAX_MS, Math.max(CONFIG.CONTEXT_MIN_MS, ms)) * scale);
}

/**
 * Merge two shuffled lists so that neither contributes more than maxRun items in a row. Each step
 * picks a type at random (weighted by what is left), among the types that keep the remainder
 * arrangeable, so the constraint can never paint the sequence into a corner.
 */
function interleave(a, b, rand, maxRun = CONFIG.MAX_RUN) {
  const src = [a.slice(), b.slice()];
  const ok = (x, y) => x <= maxRun * (y + 1);                  // x items can be separated by y
  const out = [];
  let runType = -1, runLen = 0;
  while (src[0].length + src[1].length > 0) {
    const allowed = [0, 1].filter(k => {
      const o = 1 - k, rk = src[k].length - 1, ro = src[o].length;
      if (rk < 0) return false;
      if (runType === k && runLen >= maxRun) return false;
      return ok(rk, ro) && ok(ro, rk);
    });
    if (!allowed.length) throw new Error('interleave: no arrangement satisfies the run limit');
    let k = allowed[0];
    if (allowed.length === 2) k = rand() * (src[0].length + src[1].length) < src[0].length ? 0 : 1;
    out.push(src[k].shift());
    runLen = runType === k ? runLen + 1 : 1; runType = k;
  }
  return out;
}

/** n booleans, as close to half true as n allows, in random order (the odd one out is random). */
function balancedSides(n, rand) {
  const half = Math.floor(n / 2) + (n % 2 && rand() < 0.5 ? 1 : 0);
  return shuffle(Array.from({ length: n }, (_, i) => i < half), rand);
}

/**
 * Interleave critical trials and fillers, add attention checks, and fix each trial's layout.
 * The stronger form (or Sentence 1 of a filler) is on the left on exactly half of the trials of
 * each class, of the fillers, and of the checks (to within one, where the count is odd).
 */
function buildTrials(critical, fillers, attention, rand) {
  const mixed = interleave(shuffle(critical, rand), shuffle(fillers, rand), rand);
  const checks = shuffle(attention, rand);
  const out = [];
  let ci = 0;
  mixed.forEach((t, i) => {
    out.push(t);
    if ((i + 1) % CONFIG.ATTENTION_EVERY === 0 && ci < checks.length) out.push(checks[ci++]);
  });
  while (ci < checks.length) out.push(checks[ci++]);
  const groups = new Map();
  out.forEach((t, i) => { if (!groups.has(t.cls)) groups.set(t.cls, []); groups.get(t.cls).push(i); });
  const side = new Array(out.length);
  for (const idx of groups.values()) balancedSides(idx.length, rand).forEach((v, j) => { side[idx[j]] = v; });
  return out.map((t, i) => Object.assign({}, t, splitCandidates(t.cand_A, t.cand_B), {
    left_is_A: side[i]                                         // side of candidate A
  }));
}

function breakPositions(nTrials, nBreaks = CONFIG.N_BREAKS) {
  const step = Math.floor(nTrials / (nBreaks + 1));
  return Array.from({ length: nBreaks }, (_, k) => step * (k + 1));
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function frameText(t) {
  return [t.prefix, '<span class="gap">___</span>', t.suffix].filter(Boolean).join(' ') + (t.punct || '');
}
/**
 * Both screens of a trial share one layout: context, then frame, then options. On the context
 * screen the frame and options are present but invisible, so the context sits exactly where it
 * will be on the choice screen; there it is greyed, and the frame and options become visible.
 */
function trialHTML(t, showChoice) {
  const left  = t.left_is_A ? t.optA : t.optB;
  const right = t.left_is_A ? t.optB : t.optA;
  return `<div class="trial${showChoice ? ' choosing' : ''}">
  <div class="ctx">${esc(t.context)}</div>
  <div class="choice">
    <div class="frame">${frameText({ ...t, prefix: esc(t.prefix), suffix: esc(t.suffix) })}</div>
    <div class="opts">
      <div class="opt"><div class="key">F</div><div class="form">${esc(left)}</div></div>
      <div class="opt"><div class="key">J</div><div class="form">${esc(right)}</div></div>
    </div>
  </div>
</div>`;
}
function contextHTML(t) { return trialHTML(t, false); }
function choiceHTML(t) { return trialHTML(t, true); }

/** Map a keypress (or its absence) to the chosen candidate. */
function scoreResponse(t, key) {
  if (key === null || key === undefined) {
    return { chose: null, timed_out: true, correct_check: null, correct_filler: null };
  }
  const leftChosen = String(key).toLowerCase() === CONFIG.KEY_LEFT;
  const chose = (leftChosen === t.left_is_A) ? 'A' : 'B';
  return {
    chose, timed_out: false,
    correct_check: t.cls === 'check' ? (chose === 'A') : null,
    // only fillers whose context favours one answer are scored; free alternations stay null
    correct_filler: t.cls === 'filler' && t.filler_key ? (chose === t.filler_key) : null
  };
}

/**
 * Build the full jsPsych timeline. Plugins are injected so this runs both in the browser
 * (CDN globals) and in node tests. `timeScale` shortens every presentation duration (not the
 * response deadline); it exists for automated testing only.
 */
function buildTimeline(jsPsych, P, opts) {
  const o = Object.assign({ list: 1, stimuli: null, practice: true, timeScale: 1 }, opts);
  const S = o.stimuli;
  const chosen = S.lists[String(o.list)];
  if (!Array.isArray(chosen)) {
    throw new Error(`No stimulus list "${o.list}" (available: ${Object.keys(S.lists).join(', ')}). ` +
                    `Check list assignment, and that stimuli.js was built with "npm run build".`);
  }
  const k = o.timeScale;
  const rand = mulberry32((Date.now() ^ (o.seed || 0)) >>> 0);
  if (!Array.isArray(S.fillers)) throw new Error('stimuli.js has no fillers: rebuild it with "npm run build".');
  const trials = buildTrials(chosen, S.fillers, S.attention, rand);
  const breaks = new Set(breakPositions(trials.length));
  const tl = [];
  const page = (html, label) => ({ type: P.button, stimulus: html, choices: [label || 'Continue'] });

  tl.push(page(`<h2>Information and consent</h2>
    <p class="body">This study is run by researchers at UCL. You will read short sentences and
    choose how you would continue them. It takes about 20 minutes.</p>
    <p class="body">Participation is voluntary and you may stop at any time by closing the tab.
    Responses are anonymous and stored without any information that identifies you, apart from your
    Prolific ID, which is used only to arrange payment. Data may be shared in anonymised form.</p>
    <p class="body">By continuing you confirm that you are 18 or over, a native speaker of English,
    and consent to take part.</p>`, 'I consent — begin'));

  tl.push(page(`<h2>Instructions</h2>
    <p class="body">Imagine you are chatting with a friend. Each round has two steps.</p>
    <p class="body"><strong>1.</strong> A sentence appears on its own. It tells you something that
    <strong>you and your friend both already know</strong>. Read it.</p>
    <p class="body"><strong>2.</strong> After a few seconds, the next thing you are about to say
    appears below it, with a gap and two ways to fill the gap. Choose the one
    <strong>you would say</strong>. Press <kbd>F</kbd> for the left option and <kbd>J</kbd> for the
    right. The first sentence stays on screen, in grey, while you choose.</p>
    <p class="body">Go with your first impression. Often either option would do, and then there is
    no right answer; just pick the one you would actually say. You have
    ${Math.round(CONFIG.RESPONSE_DEADLINE_MS / 1000)} seconds to answer, which is plenty.
    A few rounds are simple checks that you are paying attention.</p>`));

  const trialNodes = (t, isPractice) => {
    const nodes = [];
    nodes.push({ type: P.keyboard, stimulus: '<div class="fix">+</div>', choices: 'NO_KEYS',
                 trial_duration: Math.round(CONFIG.FIXATION_MS * k), data: { task: 'fixation' } });
    const cms = contextDuration(t.context, k);
    nodes.push({ type: P.keyboard, stimulus: contextHTML(t), choices: 'NO_KEYS',
                 trial_duration: cms, data: { task: 'context', item: t.item } });
    nodes.push({
      type: P.keyboard, stimulus: choiceHTML(t),
      choices: [CONFIG.KEY_LEFT, CONFIG.KEY_RIGHT],
      trial_duration: CONFIG.RESPONSE_DEADLINE_MS, response_ends_trial: true,
      post_trial_gap: Math.round(CONFIG.ITI_MS * k),
      data: {
        task: isPractice ? 'practice' : 'choice',
        item: t.item, cls: t.cls, ctx: t.ctx, context: t.context,
        cand_A: t.cand_A, cand_B: t.cand_B, filler_key: t.filler_key ?? null,
        frame: [t.prefix, '___', t.suffix].filter(Boolean).join(' ') + (t.punct || ''),
        opt_A: t.optA, opt_B: t.optB, left_is_A: t.left_is_A,
        context_ms: cms, list: o.list
      },
      on_finish: d => {
        const s = scoreResponse(t, d.response);
        d.chose = s.chose; d.timed_out = s.timed_out;
        d.correct_check = s.correct_check; d.correct_filler = s.correct_filler;
        d.chose_text = s.chose === 'A' ? t.cand_A : s.chose === 'B' ? t.cand_B : null;
      }
    });
    nodes.push({
      timeline: [{ type: P.keyboard, choices: 'NO_KEYS',
                   stimulus: '<div class="slow">Too slow — please answer a little faster.</div>',
                   trial_duration: Math.round(CONFIG.TIMEOUT_FEEDBACK_MS * k),
                   data: { task: 'timeout_feedback' } }],
      conditional_function: () => {
        const last = jsPsych.data.get().filterCustom(d => d.task === 'choice' || d.task === 'practice').last(1).values()[0];
        return !!(last && last.timed_out);
      }
    });
    return nodes;
  };

  if (o.practice) {
    tl.push(page(`<h2>Three practice rounds</h2><p class="body">These do not count. Remember: the
      first sentence is something you and your friend both know, and you choose what you would say
      next.</p>`, 'Start practice'));
    S.practice.forEach(t => tl.push(...trialNodes(
      Object.assign({}, t, splitCandidates(t.cand_A, t.cand_B), { left_is_A: rand() < 0.5 }), true)));
    tl.push(page(`<p class="body">That’s the practice done. The main task has ${trials.length}
      rounds, with two optional breaks.</p>`, 'Start the task'));
  }

  trials.forEach((t, i) => {
    tl.push(...trialNodes(t, false));
    if (breaks.has(i + 1)) {
      tl.push(page(`<h2>Break</h2><p class="body">You are ${Math.round(100 * (i + 1) / trials.length)}%
        of the way through. Take a moment if you need one.</p>`, 'Continue'));
    }
  });

  tl.push({
    type: P.form,
    preamble: `<h2>Two last questions</h2>`,
    html: `<p class="body">Is English your native language?
             <select name="native" required><option value="">--</option>
             <option value="yes">Yes</option><option value="no">No</option></select></p>
           <p class="body">Anything to report about the task? (optional)<br>
             <textarea name="comments" rows="3" cols="60"></textarea></p>`,
    data: { task: 'debrief_form' }
  });
  return { timeline: tl, trials };
}

if (typeof module !== 'undefined') module.exports = {
  CONFIG, mulberry32, shuffle, splitCandidates, contextDuration, interleave, balancedSides,
  buildTrials, breakPositions, frameText, trialHTML, contextHTML, choiceHTML, scoreResponse, buildTimeline
};
