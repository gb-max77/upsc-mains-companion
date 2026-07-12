// Feature C2 — Mains answer-writing drill.
// A theme becomes a timed question; on reveal you get (a) the notes' structure
// and (b) a full model answer — pulled from uploaded Model Answer documents if
// one matches, otherwise composed from the notes theme — sized to the word limit.
import { DB } from './db.js';
import { parseStructure, classifyLine, cleanTitle, decorateLine } from './parser.js';
import { escapeHtml, sheet, closeSheet } from './ui.js';

const DURATIONS = [
  { label: '7.5 min · 10-marker', secs: 7.5 * 60, marks: 10, words: 150 },
  { label: '9.5 min · 15/20-marker', secs: 9.5 * 60, marks: 15, words: 250 },
];

let el, docs = [], current = null, timer = null, remaining = 0, duration = DURATIONS[1];

export async function mountPractice(root) {
  el = root;
  docs = await DB.allDocs();
  renderIdle();
}

export async function reloadPractice() { if (el) { docs = await DB.allDocs(); if (!timer) renderIdle(); } }

function renderIdle() {
  stopTimer();
  if (!docs.length) { el.innerHTML = `<div class="empty">Add documents in the Library tab first.</div>`; return; }
  el.innerHTML = `
    <div class="pad">
      <h2 class="vt">✍️ Answer writing</h2>
      <p class="muted small">A theme becomes your question. Write the answer on paper against the clock, then compare with the structure and a full model answer.</p>
      <div class="card-ui" style="margin-top:14px">
        <label class="tiny muted">Subject</label>
        <select id="pr-doc" style="width:100%;margin:6px 0 12px">${docs.map(d => `<option value="${d.id}">${escapeHtml(d.title)}</option>`).join('')}</select>
        <label class="tiny muted">Time limit</label>
        <div class="chiprow" id="pr-durs" style="margin-top:6px">
          ${DURATIONS.map((d, i) => `<button class="chip ${d === duration ? 'on' : ''}" data-i="${i}">${d.label}</button>`).join('')}
        </div>
        <div class="row" style="margin-top:16px">
          <button class="btn primary" id="pr-random">🎲 Random theme</button>
          <button class="btn" id="pr-pick">Pick a theme</button>
        </div>
      </div>
      <div class="card-ui" style="margin-top:12px">
        <b class="small">How to score high</b>
        <p class="muted small" style="margin-top:6px;line-height:1.6">Intro with a case/data/thinker → 2 balanced body heads (H1/H2) → every point as <i>keyword → mechanism → named example</i> → way forward → forward-looking conclusion. Your notes carry all of it — this drill makes it automatic.</p>
      </div>
    </div>`;
  el.querySelectorAll('#pr-durs .chip').forEach(c => c.onclick = () => {
    duration = DURATIONS[+c.dataset.i];
    el.querySelectorAll('#pr-durs .chip').forEach(x => x.classList.remove('on'));
    c.classList.add('on');
  });
  el.querySelector('#pr-random').onclick = () => startRandom();
  el.querySelector('#pr-pick').onclick = () => pickTheme();
}

function themesOf(doc) {
  const { sections } = parseStructure(doc.lines);
  return sections.flatMap(s => s.themes.filter(t => !t.pseudo).map(t => ({ ...t, section: s.title, doc })));
}

async function startRandom() {
  const doc = await DB.getDoc(el.querySelector('#pr-doc').value);
  const ths = themesOf(doc);
  if (!ths.length) return;
  start(ths[Math.floor(Math.random() * ths.length)]);
}

async function pickTheme() {
  const doc = await DB.getDoc(el.querySelector('#pr-doc').value);
  const ths = themesOf(doc);
  sheet(`<h3>Pick a theme</h3>` + ths.map((t, i) =>
    `<div class="drawer-item" data-i="${i}"><span class="n">${i + 1}</span><span>${escapeHtml(cleanTitle(t.title))}</span></div>`).join(''),
    (root) => root.querySelectorAll('.drawer-item').forEach(n => n.onclick = () => { closeSheet(); start(ths[+n.dataset.i]); }));
}

function start(theme) {
  current = theme;
  remaining = Math.round(duration.secs);
  el.innerHTML = `
    <div class="pad">
      <div class="qz-ctx">${escapeHtml(cleanTitle(theme.section) || theme.section)}</div>
      <div class="pr-q">Q. ${escapeHtml(cleanTitle(theme.title))} — discuss with recent examples. <span class="muted">(${duration.marks} marks · ≈${duration.words} words)</span></div>
      <div class="timer" id="pr-timer">${fmt(remaining)}</div>
      <div class="row" style="justify-content:center;gap:10px;flex-wrap:wrap">
        <button class="btn danger" id="pr-quit">Quit</button>
        <button class="btn" id="pr-reveal">Reveal structure</button>
        <button class="btn primary" id="pr-model">📄 Full model answer</button>
      </div>
      <p class="muted tiny" style="text-align:center;margin-top:14px">Write on paper. Structure: Intro → H1/H2 → Way forward → Conclusion.</p>
      <div id="pr-answer"></div>
      <div id="pr-model-out"></div>
    </div>`;
  el.querySelector('#pr-quit').onclick = renderIdle;
  el.querySelector('#pr-reveal').onclick = revealStructure;
  el.querySelector('#pr-model').onclick = revealModel;
  timer = setInterval(() => {
    remaining--;
    const t = el.querySelector('#pr-timer');
    if (!t) { stopTimer(); return; }
    t.textContent = fmt(Math.max(remaining, 0));
    if (remaining <= 60) t.classList.add('low');
    if (remaining <= 0) { stopTimer(); revealStructure(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); }
  }, 1000);
}

function revealStructure() {
  stopTimer();
  const box = el.querySelector('#pr-answer');
  if (!box || box.childElementCount) return;
  const doc = current.doc;
  const rows = [];
  for (let i = current.start; i < current.end; i++) {
    rows.push(`<div class="rl k-${classifyLine(doc.lines[i])}">${decorateLine(doc.lines[i])}</div>`);
  }
  box.innerHTML = `<div class="card-ui pr-structure"><b class="small" style="color:var(--acc)">📋 Model structure from your notes</b><div style="margin-top:8px">${rows.join('')}</div></div>`;
  box.scrollIntoView({ behavior: 'smooth' });
}

// ---------- full model answer ----------

const STOP = new Set('the a an of in on and or to for with its is are as by from at their his her this that vs discuss examine critically comment analyse analyze recent examples covers'.split(' '));
const tokens = s => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));

function overlap(q, cand) {
  if (!q.size) return 0;
  let hit = 0;
  for (const w of q) if (cand.has(w)) hit++;
  return hit / q.size;
}

// best-matching theme across all uploaded Model Answer documents
async function findUploadedModel(theme) {
  const models = await DB.allModelDocs();
  const q = tokens(cleanTitle(theme.title));
  let best = null, bestScore = 0.34; // threshold — below this, synthesize instead
  for (const m of models) {
    const st = parseStructure(m.lines);
    for (const s of st.sections) {
      for (const t of s.themes) {
        const head = m.lines.slice(t.start, Math.min(t.start + 3, t.end)).join(' ');
        const score = overlap(q, tokens(cleanTitle(t.title) + ' ' + head));
        if (score > bestScore) { bestScore = score; best = { doc: m, theme: t, score }; }
      }
    }
  }
  return best;
}

// compose an exam-ready answer from the notes theme, within the word budget
function synthesizeAnswer(theme, wordLimit) {
  const doc = theme.doc;
  const wc = s => s.split(/\s+/).filter(Boolean).length;
  const strip = (s, re) => s.replace(re, '').replace(/^[▪•‣]\s*/, '').trim();

  const intro = [], bullets = [], tail = [];
  let heading = '';
  for (let i = theme.start + 1; i < theme.end; i++) {
    const raw = doc.lines[i];
    switch (classifyLine(raw)) {
      case 'intro': intro.push(strip(raw, /^Intro[^:]*:\s*/i)); break;
      case 'h1': case 'h2': heading = strip(raw, /^H[12]\s*[—\-–:]*\s*/).replace(/:$/, ''); break;
      case 'way': tail.push({ h: 'Way forward', t: strip(raw, /^Way\s?-?\s?F(or)?w(ar)?d\s*[:—\-–]*\s*/i) }); break;
      case 'concl': tail.push({ h: 'Conclusion', t: strip(raw, /^Concl(usion)?\s*[:—\-–]*\s*/i) }); break;
      case 'ammo': break; // extra ammo is a bonus, not part of the core answer
      default: bullets.push({ h: heading, t: strip(raw, /^$/) });
    }
  }

  const parts = [];
  let used = 0;
  const tailWords = tail.reduce((n, x) => n + wc(x.t), 0);

  if (intro.length) { parts.push(`<p>${decorateLine(intro[0])}</p>`); used += wc(intro[0]); }

  // fill the body with as many points as fit, keeping room for way-fwd/conclusion
  let lastH = '';
  for (const b of bullets) {
    const w = wc(b.t);
    if (used + w + tailWords > wordLimit * 1.05) break;
    if (b.h && b.h !== lastH) { parts.push(`<p class="ma-h">${escapeHtml(b.h)}</p>`); lastH = b.h; }
    parts.push(`<p class="ma-pt">– ${decorateLine(b.t)}</p>`);
    used += w;
  }
  for (const x of tail) {
    parts.push(`<p class="ma-h">${escapeHtml(x.h)}</p><p>${decorateLine(x.t)}</p>`);
    used += wc(x.t);
  }
  return { html: parts.join(''), words: used, source: 'composed from your notes' };
}

// render an uploaded model-answer theme, trimmed to the word budget
function renderUploadedModel(best, wordLimit) {
  const { doc, theme } = best;
  const wc = s => s.split(/\s+/).filter(Boolean).length;
  const parts = [];
  let used = 0;
  for (let i = theme.start; i < theme.end; i++) {
    const line = doc.lines[i];
    const w = wc(line);
    if (used && used + w > wordLimit * 1.25) { parts.push(`<p class="muted tiny">… trimmed to the ${wordLimit}-word limit</p>`); break; }
    parts.push(`<p class="${i === theme.start ? 'ma-h' : ''}">${decorateLine(line)}</p>`);
    used += w;
  }
  return { html: parts.join(''), words: used, source: `from “${doc.title}”` };
}

async function revealModel() {
  stopTimer();
  const box = el.querySelector('#pr-model-out');
  if (!box || box.childElementCount) { if (box) box.scrollIntoView({ behavior: 'smooth' }); return; }
  const limit = duration.words;
  const best = await findUploadedModel(current);
  const ans = best ? renderUploadedModel(best, limit) : synthesizeAnswer(current, limit);
  box.innerHTML = `
    <div class="card-ui" style="margin-top:12px">
      <div class="row">
        <b class="small" style="color:var(--good)">📄 Model answer</b>
        <div class="spacer"></div>
        <span class="tiny muted">≈${ans.words} words · limit ${limit} · ${escapeHtml(ans.source)}</span>
      </div>
      <div class="ma-body" style="margin-top:8px">${ans.html}</div>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth' });
}

function stopTimer() { clearInterval(timer); timer = null; }
function fmt(s) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
