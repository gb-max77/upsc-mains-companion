// Feature C1 — active recall cloze quiz: years, Articles, cases, %s blanked out
import { DB } from './db.js';
import { parseStructure, classifyLine, cleanTitle } from './parser.js';
import { escapeHtml } from './ui.js';

// Each pattern is typed so a question mixes fact KINDS (a case + a year + a
// committee) instead of three years. Order = blanking priority.
const PATTERNS = [
  { t: 'case', re: /\b[A-Z][A-Za-z.'']+(?:\s[A-Z][A-Za-z.'']+){0,3}\s(?:v\.?|vs\.?)\s[A-Z][A-Za-z.'']+/g },
  // named entity right before "(year)": Kesavananda (1973), NFHS-5 (2021)…
  { t: 'name', re: /\b[A-Z][\w.''&-]+(?:\s[A-Z][\w.''&-]+){0,3}(?=\s*\((?:1[89]|20)\d{2}\))/g },
  // institutional terms: X Committee / Commission / Doctrine / Act / Mission…
  { t: 'term', re: /\b[A-Z][\w''-]+(?:\s(?:[A-Z][\w''-]+|of|the|and)){0,3}\s(?:Committee|Commission|Doctrine|Mission|Act|Bill|Policy|Model|Theory|Curve|Index|Report|Scheme|Yojana|Abhiyan|Convention|Protocol|Treaty|Agreement|Summit|Fund)\b/g },
  // thinker quotes: blank what was said
  { t: 'quote', re: /“([^”]{4,70})”/g, group: 1 },
  { t: 'article', re: /\bArts?\.?\s?\d+[A-Z]?(?:\(\w+\))?/g },
  { t: 'amendment', re: /\b\d+(?:st|nd|rd|th)\s(?:Amdt|Amendment|Schedule)\b/g },
  { t: 'data', re: /\b\d+(?:\.\d+)?\s?(?:%|crore|lakh|bn|mn|km)\b/g },
  { t: 'year', re: /\b(?:1[89]|20)\d{2}\b/g },
  // schemes & acronyms: MGNREGA, DPSP, NJAC…
  { t: 'acronym', re: /\b[A-Z]{3,}(?:-[A-Z0-9]{1,4})?\b/g },
];

let el, pool = [], round = [], qIdx = 0, score = { got: 0, missed: 0 }, filterDoc = 'all', docs = [];

const quizDocs = async () => (await DB.allDocs()).filter(d => !d.uses || d.uses.quiz !== false);

export async function mountQuiz(root) {
  el = root;
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
  const chips = el.querySelector('#qz-chips');
  chips.innerHTML = [`<button class="chip ${filterDoc === 'all' ? 'on' : ''}" data-doc="all">All subjects</button>`]
    .concat(docs.map(d => `<button class="chip ${filterDoc === d.id ? 'on' : ''}" data-doc="${d.id}">${escapeHtml(d.title.split('·').slice(-1)[0].trim())}</button>`)).join('');
  chips.querySelectorAll('[data-doc]').forEach(c => c.onclick = async () => {
    filterDoc = c.dataset.doc; renderChips(); await buildPool(); newRound();
  });
}

async function buildPool() {
  pool = [];
  const use = filterDoc === 'all' ? docs : docs.filter(d => d.id === filterDoc);
  for (const d of use) {
    const { sections } = parseStructure(d.lines);
    for (const sec of sections) for (const th of sec.themes) {
      for (let i = th.pseudo ? th.start : th.start + 1; i < th.end; i++) {
        const line = d.lines[i];
        const kind = classifyLine(line);
        if (kind === 'h1' || kind === 'h2') continue;
        const w = line.split(/\s+/).length;
        if (w < 8 || w > 55) continue;
        const matches = findMatches(line);
        if (matches.length) pool.push({ line, matches, theme: cleanTitle(th.title), doc: d.title });
      }
    }
  }
}

function findMatches(line) {
  const out = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(line))) {
      // for group patterns (quotes) blank only the inner text
      const text = p.group ? m[p.group] : m[0];
      const start = p.group ? m.index + m[0].indexOf(text) : m.index;
      const end = start + text.length;
      if (!out.some(o => start < o.end && end > o.start)) out.push({ start, end, text, t: p.t });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// choose up to 3 blanks, preferring a MIX of fact kinds spread across the line
function pickBlanks(matches) {
  const byType = new Map();
  for (const m of matches) {
    if (!byType.has(m.t)) byType.set(m.t, []);
    byType.get(m.t).push(m);
  }
  const picked = [];
  for (const [, arr] of byType) {           // one per kind first (insertion = priority order)
    if (picked.length >= 3) break;
    const c = arr[Math.floor(Math.random() * arr.length)];
    if (!picked.some(p => c.start < p.end && c.end > p.start)) picked.push(c);
  }
  for (const m of matches) {                 // then fill from anything left
    if (picked.length >= 3) break;
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
    round.push({ ...q, blanks: pickBlanks(q.matches), state: null, revealed: new Set() });
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

  body.innerHTML = `
    <div class="card-ui">
      <div class="qz-ctx">${escapeHtml(q.theme)}${q.state ? ` · <span style="color:${q.state === 'got' ? 'var(--good)' : 'var(--bad)'}">${q.state === 'got' ? '✓ recalled' : '✗ missed'}</span>` : ''}</div>
      <div class="qz-line">${html}</div>
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
