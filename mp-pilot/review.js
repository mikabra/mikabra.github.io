// Review page: renders every item from stimuli.js with the same frame-and-options view as the
// experiment, keeps the reviewer's marks in localStorage, and exports them as a CSV.
(function () {
  const STORE = 'mp-review-b700881c53';
  const CLASS_NOTES = {
    'definiteness': ['Definiteness', '<em>the</em> vs <em>a</em>'],
    'duality': ['Duality', '<em>both</em> vs <em>all</em>'],
    'additive': ['Additive', 'adding <em>too</em> or not'],
    'iterative': ['Iterative', 'adding <em>again</em> or not'],
    'factivity': ['Factivity', '<em>knows</em> vs <em>believes</em>'],
    'change-of-state': ['Change of state', '<em>stopped V-ing</em> vs <em>doesn\u2019t V</em>'],
    'possessive': ['Possessive', '<em>X\u2019s N</em> vs <em>a N of X\u2019s</em>'],
    'cleft': ['Cleft', '<em>It was X who\u2026</em> vs a plain sentence']
  };

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let state = {};
  try { state = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { state = {}; }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* private mode */ } };

  // ---- collect entries -------------------------------------------------------
  // Study items: merge the four lists, so each item carries both of its contexts.
  const items = new Map();
  Object.values(STIMULI.lists).flat().forEach(t => {
    if (!items.has(t.item)) items.set(t.item, { id: t.item, cls: t.cls, cand_A: t.cand_A, cand_B: t.cand_B, contexts: {} });
    items.get(t.item).contexts[t.ctx] = t.context;
  });
  const sections = [];
  const byClass = {};
  [...items.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
    .forEach(it => { (byClass[it.cls] = byClass[it.cls] || []).push(it); });
  Object.keys(CLASS_NOTES).forEach(cls => {
    if (byClass[cls]) sections.push({ key: cls, title: CLASS_NOTES[cls][0], note: CLASS_NOTES[cls][1], kind: 'study', entries: byClass[cls] });
  });
  const single = (t, kind) => ({ id: t.item, cls: t.cls, cand_A: t.cand_A, cand_B: t.cand_B,
    contexts: { [kind]: t.context }, ftype: t.ctx, key: t.filler_key });
  sections.push({ key: 'fillers', title: 'Fillers', kind: 'filler',
    note: 'everyday choices mixed in with the study items; some have a clear answer, some do not',
    entries: STIMULI.fillers.map(f => single(f, 'Context')) });
  sections.push({ key: 'practice', title: 'Practice rounds', kind: 'other', note: 'shown before the main task',
    entries: STIMULI.practice.map(p => single(p, 'Context')) });
  sections.push({ key: 'checks', title: 'Attention checks', kind: 'other',
    note: 'one option is deliberately anomalous; the first one should be the obvious choice',
    entries: STIMULI.attention.map(a => single(a, 'Context')) });
  const all = sections.flatMap(s => s.entries.map(e => Object.assign(e, { section: s.title })));

  // ---- render -------------------------------------------------------------------
  function choiceView(e) {
    const s = splitCandidates(e.cand_A, e.cand_B);
    const frame = frameText({ ...s, prefix: esc(s.prefix), suffix: esc(s.suffix) });   // as in the experiment
    return `<div class="choice-view">
      <p class="frame">${frame}</p>
      <div class="opts"><span class="opt">${esc(s.optA)}</span><span class="opt">${esc(s.optB)}</span></div>
      <p class="full">${esc(e.cand_A)} <span class="vs">/</span> ${esc(e.cand_B)}</p>
    </div>`;
  }
  function entryView(e, kind) {
    const ctx = Object.entries(e.contexts).sort(([a], [b]) => a === 'Support' ? -1 : b === 'Support' ? 1 : 0)
      .map(([k, v]) => `<div class="ctx-line"><span class="ctx-kind">${kind === 'study' ? k : 'Context'}</span>
        <span class="ctx-text">${esc(v)}</span></div>`).join('');
    const extra = kind === 'filler'
      ? `<span class="meta">${esc(e.ftype)}${e.key ? ', first option expected' : ', no right answer'}</span>` : '';
    const st = state[e.id] || {};
    return `<article class="entry" id="e-${esc(e.id)}" data-id="${esc(e.id)}" data-verdict="${esc(st.verdict || '')}">
      <div class="entry-head"><span class="id">${esc(e.id)}</span>${extra}</div>
      <div class="contexts">${ctx}</div>
      ${choiceView(e)}
      <div class="verdict" role="group" aria-label="Verdict for ${esc(e.id)}">
        <button type="button" data-v="fine" aria-pressed="${st.verdict === 'fine'}">Looks fine</button>
        <button type="button" data-v="flag" aria-pressed="${st.verdict === 'flag'}">Flag</button>
        <textarea rows="1" placeholder="Comment (optional)" aria-label="Comment on ${esc(e.id)}">${esc(st.comment || '')}</textarea>
      </div>
    </article>`;
  }
  document.getElementById('sections').innerHTML = sections.map(s => `
    <section class="group" id="s-${s.key}">
      <h2>${s.title} <span class="note">${s.note}</span></h2>
      ${s.entries.map(e => entryView(e, s.kind)).join('')}
    </section>`).join('');

  function counts(list) {
    const done = list.filter(e => state[e.id] && state[e.id].verdict).length;
    const flagged = list.filter(e => state[e.id] && state[e.id].verdict === 'flag').length;
    return { done, flagged, total: list.length };
  }
  function refresh() {
    const c = counts(all);
    document.getElementById('progress').textContent =
      `${c.done} of ${c.total} reviewed` + (c.flagged ? `, ${c.flagged} flagged` : '');
    document.getElementById('toc').innerHTML = sections.map(s => {
      const k = counts(s.entries);
      return `<a href="#s-${s.key}" class="${k.done === k.total ? 'complete' : ''}">${s.title}
        <span>${k.done}/${k.total}</span></a>`;
    }).join('');
  }

  // ---- interaction ---------------------------------------------------------------
  const sectionsEl = document.getElementById('sections');
  sectionsEl.addEventListener('click', ev => {
    const btn = ev.target.closest('button[data-v]');
    if (!btn) return;
    const art = btn.closest('.entry'), id = art.dataset.id;
    const st = state[id] = state[id] || {};
    st.verdict = st.verdict === btn.dataset.v ? '' : btn.dataset.v;     // click again to clear
    art.dataset.verdict = st.verdict;
    art.querySelectorAll('button[data-v]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === st.verdict)));
    if (st.verdict === 'flag') art.querySelector('textarea').focus();
    save(); refresh();
  });
  sectionsEl.addEventListener('input', ev => {
    if (ev.target.tagName !== 'TEXTAREA') return;
    const id = ev.target.closest('.entry').dataset.id;
    (state[id] = state[id] || {}).comment = ev.target.value;
    ev.target.style.height = 'auto'; ev.target.style.height = ev.target.scrollHeight + 'px';
    save();
  });
  const who = document.getElementById('reviewer');
  who.value = state.__reviewer || '';
  who.addEventListener('input', () => { state.__reviewer = who.value; save(); });

  document.getElementById('download').addEventListener('click', () => {
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const head = ['reviewer', 'section', 'item', 'class', 'context_support', 'context_control',
                  'context', 'option_1', 'option_2', 'verdict', 'comment'];
    const rows = all.map(e => [state.__reviewer || '', e.section, e.id, e.cls,
      e.contexts.Support || '', e.contexts.Control || '', e.contexts.Context || '',
      e.cand_A, e.cand_B, (state[e.id] || {}).verdict || '', (state[e.id] || {}).comment || '']);
    const csv = [head, ...rows].map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const name = (state.__reviewer || 'reviewer').trim().replace(/\s+/g, '-').replace(/[^\w-]/g, '') || 'reviewer';
    a.download = `stimulus-review-${name}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  });

  refresh();
  window.__review = { entries: all.length };      // used by the build test
})();
