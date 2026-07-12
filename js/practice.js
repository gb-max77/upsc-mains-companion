// Feature C2 — Mains answer-writing drill.
// A theme becomes a timed question; on reveal you get (a) the notes' structure
// and (b) a full model answer — pulled from uploaded Model Answer documents if
// one matches, otherwise composed from the notes theme — sized to the word limit.
import { DB } from './db.js';
import { parseStructure, classifyLine, cleanTitle, decorateLine } from './parser.js';
import { escapeHtml, sheet, closeSheet, toast } from './ui.js';
import { geminiAvailable, callGemini, mainsAnswerPrompt } from './ai.js';
import { suggestFolder } from './library.js';

// ---------- paper-specific high-scoring tacticalities ----------
const TACTICS = {
  GS1: 'Weave in society data (Census, NFHS-5, PLFS), name sociologists (Srinivas, Ambedkar, Xaxa) for society questions; exact chronology and named movements/art forms for history; process mechanisms and a "draw a diagram/map" cue for geography. Balance colonial, nationalist and subaltern perspectives where relevant.',
  GS2: 'Anchor EVERY point in an Article, SC judgment, or committee (2nd ARC, Sarkaria, Punchhi, Law Commission). Cite recent constitutional developments. Way forward should quote committee recommendations, not generic advice. Maintain constitutional-morality tone; for IR, use doctrines, groupings and recent summits.',
  GS3: 'Lead with Economic Survey/Budget/RBI data and named schemes. For environment cite conventions (UNFCCC, CBD, Ramsar) and CPCB/SoE data; for security use doctrine and named operations; for S&T name missions. Always balance growth vs equity/sustainability and end with a scheme-linked way forward.',
  GS4: 'Define the ethical concept in one line first, attribute it (Aristotle, Kant, Mill, Gandhi, Kohlberg), give a lived administrative example or case study, quote a thinker mid-answer, and close by synthesising the value with public service. Use simple diagrams cue (value-conflict matrix) where apt.',
  PubAd: 'Cite thinkers by theory (Weber-bureaucracy, Simon-decision making, Riggs-ecology, Dwivedi-ethics), link Paper-1 theory to Indian administrative practice and vice-versa, quote 2nd ARC and NITI reports, and use committee-vs-practice tension as the analytical spine.',
  Essay: 'Open with an anecdote or striking fact, sweep dimensions (political, economic, social, technological, environmental, ethical), transition smoothly between paras, embed 2-3 quotes, keep a balanced argumentative arc, and close philosophically with a forward vision.',
  General: 'Use the keyword → mechanism → named example spine on every point; quantify with data wherever possible; end with an optimistic, forward-looking conclusion.',
};
const paperOf = d => {
  const p = d.folder || suggestFolder(d.title);
  return TACTICS[p] ? p : 'General';
};

// mine the Knowledge Bank for value-addition lines matching the question
async function bankSnippets(question, n = 6) {
  const models = await DB.allModelDocs();
  const q = tokens(question);
  const scored = [];
  for (const m of models) {
    for (const l of m.lines) {
      if (l.length < 40 || l.length > 500) continue;
      const s = overlap(q, tokens(l));
      if (s >= 0.25) scored.push({ l, s });
    }
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, n).map(x => x.l);
}

// time and word limit are independent — you pick each
const TIMES = [7.5, 9.5];                 // minutes
const WORDS = [150, 200, 250, 300];       // word limits

let el, docs = [], current = null, currentQ = '', timer = null, remaining = 0, paused = false;
let mins = 9.5, wordLimit = 250, qMode = 'questions'; // 'questions' | 'themes'
let maSource = localStorage.getItem('ma-source') || 'notes'; // 'notes' | 'gemini' | 'both'

const answerDocs = async () => (await DB.allDocs()).filter(d => !d.uses || d.uses.answer !== false);

export async function mountPractice(root) {
  el = root;
  docs = await answerDocs();
  renderIdle();
}

export async function reloadPractice() { if (el) { docs = await answerDocs(); if (!timer) renderIdle(); } }

// ---------- predicted-question bank ----------
// pulls real question lines out of the notes (numbered question banks,
// ★-tagged predictions, "Discuss/Examine…?" lines) and maps each to its
// best-matching theme in the same document for reveal/model-answer.
function extractQuestions(doc) {
  const qs = [];
  for (const l of doc.lines) {
    const numbered = /^\d{1,3}[.)]\s+/.test(l) || /^Q\d{1,3}[.:)]?\s+/.test(l);
    const asks = /\?/.test(l) || /\b(Discuss|Examine|Elucidate|Comment|Analyse|Analyze|Evaluate|Critically|Do you agree|In (the )?light of)\b/i.test(l);
    if (numbered && asks && l.length > 40 && l.length < 400) {
      qs.push(l.replace(/^\d{1,3}[.)]\s*/, '').replace(/^Q\d{1,3}[.:)]?\s*/, '').replace(/^★\s*/, '').replace(/\[T\d+\]\s*$/, '').trim());
    }
  }
  return [...new Set(qs)];
}

function bestTheme(doc, questionText) {
  const q = tokens(questionText);
  const ths = themesOf(doc);
  let best = null, bestScore = 0;
  for (const t of ths) {
    const head = doc.lines.slice(t.start, Math.min(t.start + 4, t.end)).join(' ');
    const s = overlap(q, tokens(cleanTitle(t.title) + ' ' + head));
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return best || ths[0] || null;
}

function renderIdle() {
  stopTimer();
  if (!docs.length) { el.innerHTML = `<div class="empty">Add documents in the Library tab first.</div>`; return; }
  el.innerHTML = `
    <div class="pad">
      <h2 class="vt">✍️ Answer writing</h2>
      <p class="muted small">Write the answer on paper against the clock, then compare with the structure and a full model answer.</p>
      <div class="card-ui" style="margin-top:14px">
        <label class="tiny muted">Question source</label>
        <div class="chiprow" id="pr-mode" style="margin:6px 0 12px">
          <button class="chip ${qMode === 'questions' ? 'on' : ''}" data-m="questions">🎯 Predicted questions</button>
          <button class="chip ${qMode === 'themes' ? 'on' : ''}" data-m="themes">📚 Themes</button>
        </div>
        <label class="tiny muted">Subject</label>
        <select id="pr-doc" style="width:100%;margin:6px 0 12px">${docs.map(d => `<option value="${d.id}">${escapeHtml(d.title)}</option>`).join('')}</select>
        <label class="tiny muted">Time</label>
        <div class="chiprow" id="pr-durs" style="margin:6px 0 12px">
          ${TIMES.map(t => `<button class="chip ${t === mins ? 'on' : ''}" data-t="${t}">${t} min</button>`).join('')}
        </div>
        <label class="tiny muted">Word limit (sizes the model answer)</label>
        <div class="chiprow" id="pr-words" style="margin-top:6px">
          ${WORDS.map(w => `<button class="chip ${w === wordLimit ? 'on' : ''}" data-w="${w}">${w} words</button>`).join('')}
        </div>
        <label class="tiny muted" style="display:block;margin-top:12px">Model answer source</label>
        <div class="chiprow" id="pr-src" style="margin-top:6px">
          <button class="chip ${maSource === 'notes' ? 'on' : ''}" data-src="notes">📚 Notes only</button>
          <button class="chip ${maSource === 'gemini' ? 'on' : ''}" data-src="gemini">✨ Just Gemini</button>
          <button class="chip ${maSource === 'both' ? 'on' : ''}" data-src="both">🔗 Gemini + Notes</button>
        </div>
        <div class="row" style="margin-top:16px">
          <button class="btn primary" id="pr-random">🎲 Random</button>
          <button class="btn" id="pr-pick">Pick</button>
        </div>
      </div>
      <div class="card-ui" style="margin-top:12px">
        <b class="small">How to score high</b>
        <p class="muted small" style="margin-top:6px;line-height:1.6">Intro with a case/data/thinker → 2 balanced body heads (H1/H2) → every point as <i>keyword → mechanism → named example</i> → way forward → forward-looking conclusion. Your notes carry all of it — this drill makes it automatic.</p>
      </div>
    </div>`;
  el.querySelectorAll('#pr-mode .chip').forEach(c => c.onclick = () => {
    qMode = c.dataset.m;
    el.querySelectorAll('#pr-mode .chip').forEach(x => x.classList.toggle('on', x === c));
  });
  el.querySelectorAll('#pr-durs .chip').forEach(c => c.onclick = () => {
    mins = parseFloat(c.dataset.t);
    el.querySelectorAll('#pr-durs .chip').forEach(x => x.classList.toggle('on', x === c));
  });
  el.querySelectorAll('#pr-words .chip').forEach(c => c.onclick = () => {
    wordLimit = +c.dataset.w;
    el.querySelectorAll('#pr-words .chip').forEach(x => x.classList.toggle('on', x === c));
  });
  el.querySelectorAll('#pr-src .chip').forEach(c => c.onclick = () => {
    maSource = c.dataset.src;
    localStorage.setItem('ma-source', maSource);
    el.querySelectorAll('#pr-src .chip').forEach(x => x.classList.toggle('on', x === c));
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
  if (qMode === 'questions') {
    const qs = extractQuestions(doc);
    if (qs.length) {
      const qText = qs[Math.floor(Math.random() * qs.length)];
      return start(bestTheme(doc, qText), qText);
    }
    toast('No question bank found in this document — using a theme instead');
  }
  const ths = themesOf(doc);
  if (!ths.length) return;
  start(ths[Math.floor(Math.random() * ths.length)]);
}

async function pickTheme() {
  const doc = await DB.getDoc(el.querySelector('#pr-doc').value);
  if (qMode === 'questions') {
    const qs = extractQuestions(doc);
    if (qs.length) {
      sheet(`<h3>Pick a question (${qs.length} found)</h3>` + qs.map((q, i) =>
        `<div class="drawer-item" data-i="${i}"><span class="n">${i + 1}</span><span>${escapeHtml(q)}</span></div>`).join(''),
        (root) => root.querySelectorAll('.drawer-item').forEach(n => n.onclick = () => {
          closeSheet(); start(bestTheme(doc, qs[+n.dataset.i]), qs[+n.dataset.i]);
        }));
      return;
    }
    toast('No question bank found in this document — showing themes');
  }
  const ths = themesOf(doc);
  sheet(`<h3>Pick a theme</h3>` + ths.map((t, i) =>
    `<div class="drawer-item" data-i="${i}"><span class="n">${i + 1}</span><span>${escapeHtml(cleanTitle(t.title))}</span></div>`).join(''),
    (root) => root.querySelectorAll('.drawer-item').forEach(n => n.onclick = () => { closeSheet(); start(ths[+n.dataset.i]); }));
}

function start(theme, questionText) {
  current = theme;
  currentQ = questionText || `${cleanTitle(theme.title)} — discuss with recent examples.`;
  remaining = Math.round(mins * 60);
  paused = false;
  el.innerHTML = `
    <div class="pad">
      <div class="qz-ctx">${escapeHtml(cleanTitle(theme.section) || theme.section || '')}</div>
      <div class="pr-q">Q. ${escapeHtml(currentQ)} <span class="muted">(≈${wordLimit} words · ${mins} min)</span></div>
      <div class="timer" id="pr-timer">${fmt(remaining)}</div>
      <div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap">
        <button class="btn" id="pr-pause">⏸ Pause</button>
        <button class="btn" id="pr-stop">⏹ Stop</button>
        <button class="btn danger" id="pr-quit">Quit</button>
      </div>
      <div class="row" style="justify-content:center;gap:10px;flex-wrap:wrap;margin-top:10px">
        <button class="btn" id="pr-reveal">Reveal structure</button>
        <button class="btn primary" id="pr-model">📄 Full model answer</button>
      </div>
      <p class="muted tiny" style="text-align:center;margin-top:14px">Write on paper. Structure: Intro → H1/H2 → Way forward → Conclusion. Timer keeps running when you reveal.</p>
      <div id="pr-answer"></div>
      <div id="pr-model-out"></div>
    </div>`;
  el.querySelector('#pr-quit').onclick = renderIdle;
  el.querySelector('#pr-pause').onclick = togglePause;
  el.querySelector('#pr-stop').onclick = () => { stopTimer(); el.querySelector('#pr-pause').textContent = '▶ Restart'; paused = 'stopped'; };
  el.querySelector('#pr-reveal').onclick = revealStructure;
  el.querySelector('#pr-model').onclick = revealModel;
  runTimer();
}

function runTimer() {
  stopTimer();
  timer = setInterval(() => {
    if (paused === true) return;
    remaining--;
    const t = el.querySelector('#pr-timer');
    if (!t) { stopTimer(); return; }
    t.textContent = fmt(Math.max(remaining, 0));
    if (remaining <= 60) t.classList.add('low');
    if (remaining <= 0) { stopTimer(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); }
  }, 1000);
}

function togglePause() {
  const b = el.querySelector('#pr-pause');
  if (paused === 'stopped') {           // restart from full time
    remaining = Math.round(mins * 60);
    paused = false;
    el.querySelector('#pr-timer').classList.remove('low');
    el.querySelector('#pr-timer').textContent = fmt(remaining);
    b.textContent = '⏸ Pause';
    runTimer();
    return;
  }
  paused = !paused;
  b.textContent = paused ? '▶ Resume' : '⏸ Pause';
}

function revealStructure() {
  // timer intentionally keeps running — self-check against the clock
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
        if (t.pseudo) continue; // unstructured stretches feed bankSnippets, not full answers
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

async function notesAnswer(limit) {
  const best = await findUploadedModel(current);
  const ans = best ? renderUploadedModel(best, limit) : synthesizeAnswer(current, limit);
  // enrich with value-addition lines mined from the Knowledge Bank
  const snips = await bankSnippets(currentQ, 4);
  if (snips.length && !best) {
    ans.html += `<p class="ma-h">Value addition — Knowledge Bank</p>`
      + snips.map(s => `<p class="ma-pt">– ${decorateLine(s)}</p>`).join('');
    ans.source += ' + knowledge bank';
  }
  return ans;
}

// light formatting for Gemini plain-text output: heading lines end with ':'
function formatAiAnswer(text) {
  return text.split(/\n+/).map(l => {
    const t = l.trim();
    if (!t) return '';
    if (/^[^.!?]{3,70}:$/.test(t)) return `<p class="ma-h">${escapeHtml(t.replace(/:$/, ''))}</p>`;
    return `<p>${decorateLine(t.replace(/^[-–•*]\s*/, t.startsWith('-') ? '– ' : ''))}</p>`;
  }).join('');
}

async function geminiAnswer(limit, withNotes) {
  if (!geminiAvailable()) throw new Error('Add your Gemini API key in Library ▸ Settings (free at aistudio.google.com/apikey)');
  const paper = paperOf(current.doc);
  let notesCtx = null;
  if (withNotes) {
    notesCtx = current.doc.lines.slice(current.start, current.end).join('\n').slice(0, 12000);
    const snips = await bankSnippets(currentQ, 6);
    if (snips.length) notesCtx += '\n\nVALUE-ADDITION FROM KNOWLEDGE BANK:\n' + snips.join('\n');
  }
  const text = await callGemini(mainsAnswerPrompt(currentQ, limit, notesCtx, TACTICS[paper], paper));
  return {
    html: formatAiAnswer(text),
    words: text.split(/\s+/).filter(Boolean).length,
    source: (withNotes ? 'Gemini + notes + knowledge bank' : 'Gemini') + ` · ${paper} tactics`,
  };
}

async function revealModel() {
  // timer intentionally keeps running
  const box = el.querySelector('#pr-model-out');
  if (!box) return;
  const limit = wordLimit;
  box.innerHTML = `<div class="card-ui" style="margin-top:12px"><span class="muted small">✨ Preparing ${limit}-word model answer…</span></div>`;
  box.scrollIntoView({ behavior: 'smooth' });
  try {
    const ans = maSource === 'notes' ? await notesAnswer(limit)
      : maSource === 'gemini' ? await geminiAnswer(limit, false)
      : await geminiAnswer(limit, true);
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
  } catch (e) {
    box.innerHTML = `<div class="card-ui" style="margin-top:12px"><span class="small" style="color:var(--bad)">${escapeHtml(e.message)}</span></div>`;
  }
}

function stopTimer() { clearInterval(timer); timer = null; }
function fmt(s) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
