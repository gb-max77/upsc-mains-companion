// Feature C1 — active recall cloze quiz.
// Questions are 30+ word passages (the same keyword-flow chunks as flashcards)
// with a MIX of blanks: keyword lead-ins, theories/committees/acts, case names,
// thinker quotes, examples, Articles, data and years.
import { DB } from './db.js';
import { escapeHtml } from './ui.js';
import { buildCardsForDoc } from './cards.js';
import { findEntities } from './entities.js';
import { crossRefsFor, ensureIndexLoaded } from './analysis.js';

let el, pool = [], round = [], qIdx = 0, filterDoc = 'all', docs = [];

const quizDocs = async () => (await DB.allDocs()).filter(d => !d.uses || d.uses.quiz !== false);

export async function mountQuiz(root) {
  el = root;
  await ensureIndexLoaded();
  docs = await quizDocs();
  el.innerHTML = `
    <div class="pad">
      <h2 class="vt">🧠 Active recall</h2>
      <p class="muted small" style="margin-bottom:12px">Key facts are blanked out. Recall them aloud, tap a blank to check yourself.</p>
      <div class="chiprow" id="qz-chips" style="margin-bottom:14px"></div>
      <div id="qz-body"></div>
    </div>`;
  renderChips();
  await buildPool();
  newRound();
}

export async function reloadQuiz() { if (el) { docs = await quizDocs(); renderChips(); await buildPool(); newRound(); } }

function renderChips() {
  const box = el.querySelector('#qz-chips');
  box.innerHTML = `<select id="qz-doc" style="width:100%">
    <option value="all" ${filterDoc === 'all' ? 'selected' : ''}>📚 All subjects</option>
    ${docs.map(d => `<option value="${d.id}" ${filterDoc === d.id ? 'selected' : ''}>${escapeHtml(d.title)}</option>`).join('')}
  </select>`;
  box.querySelector('#qz-doc').onchange = async (e) => {
    filterDoc = e.target.value; await buildPool(); newRound();
  };
}

async function buildPool() {
  // quiz on 30+ word keyword-flow passages (same chunks as flashcards) so a
  // question carries the full point: keyword → mechanism → example
  pool = [];
  const use = filterDoc === 'all' ? docs : docs.filter(d => d.id === filterDoc);
  for (const d of use) {
    for (const card of buildCardsForDoc(d)) {
      if (card.text.split(/\s+/).length < 30) continue;
      const matches = findEntities(card.text);
      if (matches.length >= 3) pool.push({ line: card.text, matches, theme: card.theme, doc: d.title, docId: d.id });
    }
  }
}

// choose blanks preferring a MIX of fact kinds spread across the passage;
// longer passages earn more blanks (4-6) so recall covers the whole point
function pickBlanks(matches, text) {
  const nMax = Math.max(3, Math.min(6, Math.round(text.split(/\s+/).length / 16)));
  const byType = new Map();
  for (const m of matches) {
    if (!byType.has(m.t)) byType.set(m.t, []);
    byType.get(m.t).push(m);
  }
  const picked = [];
  for (const [, arr] of byType) {           // one per kind first (insertion = priority order)
    if (picked.length >= nMax) break;
    const c = arr[Math.floor(Math.random() * arr.length)];
    if (!picked.some(p => c.start < p.end && c.end > p.start)) picked.push(c);
  }
  for (const m of matches) {                 // then fill from anything left
    if (picked.length >= nMax) break;
    if (!picked.some(p => m.start < p.end && m.end > p.start) && !picked.includes(m)) picked.push(m);
  }
  return picked.sort((a, b) => a.start - b.start);
}

function newRound() {
  round = [];
  const src = pool.slice();
  for (let i = 0; i < 12 && src.length; i++) {
    const q = src.splice(Math.floor(Math.random() * src.length), 1)[0];
    // pick blanks ONCE so revisiting a question shows the same blanks
    round.push({
      ...q, blanks: pickBlanks(q.matches, q.line), state: null, revealed: new Set(),
      crossRefs: crossRefsFor(q.line, q.docId, 3), // Knowledge Engine: same facts in OTHER documents
    });
  }
  qIdx = 0;
  renderQ();
}

const tally = () => round.reduce((s, q) => {
  if (q.state === 'got') s.got++; else if (q.state === 'missed') s.missed++;
  return s;
}, { got: 0, missed: 0 });

function renderQ() {
  const body = el.querySelector('#qz-body');
  if (!round.length) {
    body.innerHTML = `<div class="empty">No quizzable facts found. Add documents in the Library tab.</div>`;
    return;
  }
  const sc = tally();
  if (qIdx >= round.length) {
    const pct = Math.round(100 * sc.got / Math.max(sc.got + sc.missed, 1));
    body.innerHTML = `
      <div class="card-ui" style="text-align:center;padding:34px 18px">
        <div style="font-size:44px">${pct >= 80 ? '🏆' : pct >= 50 ? '💪' : '📖'}</div>
        <h3 style="margin:10px 0 4px">Round complete</h3>
        <p class="muted">Recalled ${sc.got} · missed ${sc.missed} — ${pct}%</p>
        <div class="row" style="justify-content:center;gap:10px;margin-top:16px">
          <button class="btn" id="qz-back">‹ Review questions</button>
          <button class="btn primary" id="qz-again">New round</button>
        </div>
      </div>`;
    body.querySelector('#qz-again').onclick = newRound;
    body.querySelector('#qz-back').onclick = () => { qIdx = round.length - 1; renderQ(); };
    return;
  }
  const q = round[qIdx];
  let html = '', last = 0;
  for (const m of q.blanks) {
    html += escapeHtml(q.line.slice(last, m.start));
    html += `<span class="blank ${q.revealed.has(m.start) ? 'shown' : ''}" data-s="${m.start}" data-a="${escapeHtml(m.text)}">${escapeHtml(m.text)}</span>`;
    last = m.end;
  }
  html += escapeHtml(q.line.slice(last));

  const crossHtml = q.crossRefs && q.crossRefs.length
    ? `<div class="qz-xref">🔗 Also in: ${q.crossRefs.map(r => `<b>${escapeHtml(r.docTitle.split('·').pop().trim())}</b> — ${escapeHtml(r.theme)}`).join(' · ')}</div>`
    : '';
  body.innerHTML = `
    <div class="card-ui">
      <div class="qz-ctx">${escapeHtml(q.theme)}${q.state ? ` · <span style="color:${q.state === 'got' ? 'var(--good)' : 'var(--bad)'}">${q.state === 'got' ? '✓ recalled' : '✗ missed'}</span>` : ''}</div>
      <div class="qz-line">${html}</div>
      ${crossHtml}
      <div class="row">
        <button class="btn sm ghost" id="qz-reveal">Reveal all</button>
        <div class="spacer"></div>
        <span class="qz-score">${qIdx + 1}/${round.length} · ✅ ${sc.got} ❌ ${sc.missed}</span>
      </div>
    </div>
    <div class="row" style="margin-top:14px;justify-content:center;gap:10px">
      <button class="btn" id="qz-prev" ${qIdx === 0 ? 'disabled style="opacity:.35"' : ''}>‹ Prev</button>
      <button class="btn" id="qz-miss" style="color:var(--bad)">✗ Missed it</button>
      <button class="btn primary" id="qz-got">✓ Got it</button>
      <button class="btn" id="qz-next">Next ›</button>
    </div>`;
  body.querySelectorAll('.blank').forEach(b => b.onclick = () => { b.classList.add('shown'); q.revealed.add(+b.dataset.s); });
  body.querySelector('#qz-reveal').onclick = () => body.querySelectorAll('.blank').forEach(b => { b.classList.add('shown'); q.revealed.add(+b.dataset.s); });
  body.querySelector('#qz-got').onclick = () => { q.state = 'got'; qIdx++; renderQ(); };
  body.querySelector('#qz-miss').onclick = () => { q.state = 'missed'; qIdx++; renderQ(); };
  body.querySelector('#qz-prev').onclick = () => { if (qIdx > 0) { qIdx--; renderQ(); } };
  body.querySelector('#qz-next').onclick = () => { qIdx++; renderQ(); };
}
