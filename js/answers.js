// 📝 Bank — the locked 2026 final question list with pre-generated model answers.
// Each main question may carry "branch" questions (variant angles on the same
// prepared content) — viewable and independently answerable from the main one.
// Views per answer: Full / Skeleton / Flashcard. Full view doubles as a
// read-along player: every audible line is tappable (start/seek) and the
// speaking line is highlighted and kept in view, like the Listen tab.
// Answers ship as static JSON (data/answers/<paperId>.json), generated paper-wise,
// or on-demand via the user's own AI key (see generateAnswer below).
import { DB } from './db.js';
import { speech } from './tts.js';
import { sheet, closeSheet, toast, escapeHtml } from './ui.js';
import { anyAIKey, aiComplete } from './ai.js';
import { ensureIndexLoaded, notesRefsFor } from './analysis.js';

let root = null;
let banks = [];
const answers = {};           // paperId -> {qid: answer}  (static batch merged with on-device generated)
let dropped = new Set();
let nav = { view: 'home', paper: null, q: null, branch: null, mode: 'full' };

// app.js calls this when the user leaves the Bank tab — the shared speech
// engine must hand its callbacks back to the Listen player before it's reused
export function leaveAnswers() { stopBankAudio(); }

export async function mountAnswers(el) {
  root = el;
  dropped = new Set(await DB.getKV('bank-dropped', []));
  await ensureIndexLoaded();
  try {
    banks = await (await fetch('data/banks.json')).json();
  } catch {
    el.innerHTML = '<div class="pad muted">Could not load question banks (offline first run?).</div>';
    return;
  }
  render();
}

async function loadAnswers(pid) {
  if (pid in answers) return answers[pid];
  let base = {};
  try {
    const res = await fetch(`data/answers/${pid}.json`);
    if (res.ok) base = await res.json();
  } catch { /* no static batch yet for this paper */ }
  const gen = await DB.getKV('gen-answers-' + pid, {});
  answers[pid] = { ...gen, ...base }; // a verified static batch always wins over an on-device draft
  return answers[pid];
}

async function saveGenerated(pid, id, answer) {
  const store = await DB.getKV('gen-answers-' + pid, {});
  store[id] = answer;
  await DB.setKV('gen-answers-' + pid, store);
  answers[pid] = { ...answers[pid], [id]: answer };
}

const qid = (pid, n, bi) => bi == null ? `${pid}-${n}` : `${pid}-${n}-b${bi}`;
const paper = () => banks.find(p => p.id === nav.paper);
const allQs = (p) => p.sections.flatMap(s => s.qs);

// locate a main question plus the syllabus-section it lives in (sections are
// flattened by allQs, so the section title has to be found by a second pass)
function findQuestion(p, n) {
  for (const s of p.sections) {
    const q = s.qs.find(x => x.n === n);
    if (q) return { q, sectionTitle: s.t };
  }
  return { q: null, sectionTitle: '' };
}

function directiveOf(q, paperId, sectionTitle) {
  if (paperId === 'essay') return 'essay';
  if (paperId === 'gs4' && /Case Stud/i.test(sectionTitle || '')) return 'case study';
  const m = q.toLowerCase().match(/critically (?:examine|analyse|evaluate)|examine|discuss|comment|elucidate|analyse|evaluate|assess|compare|contrast|trace|justify|illustrate|explain/);
  return m ? m[0] : 'discuss';
}

// **gold** markup → highlighted spans (escape first)
function md(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b class="au">$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
}
const plain = (s) => s.replace(/\*\*?/g, '');
const golds = (s) => [...s.matchAll(/\*\*(.+?)\*\*/g)].map(m => m[1]);

// exam-written words: ONE intro + headings + points + way forward + conclusion
function wordCount(a) {
  const parts = [];
  if (a.intro?.[0]) parts.push(a.intro[0].x);
  (a.body || []).forEach(s => { parts.push(s.h); s.p.forEach(pt => parts.push(pt.x)); });
  (a.wf || []).forEach(x => parts.push(x));
  if (a.conc) parts.push(a.conc);
  return parts.map(plain).join(' ').split(/\s+/).filter(Boolean).length;
}

function render() {
  stopBankAudio();
  if (nav.view === 'home') renderHome();
  else if (nav.view === 'paper') renderPaper();
  else renderQuestion();
}

/* ---------- ✨ on-device generation: same schema as a pre-generated batch,
   grounded in the matching cheat-sheet doc(s) from the Library, per docs/answer-scheme.md ---------- */
const NOTES_MATCH = {
  pubad1: ['PubAd · Paper 1'],
  pubad2: ['PubAd · Paper 2'],
  gs1: ['GS1 · Geography', 'GS1 · History', 'GS1 · Society'],
  gs2: ['GS2 · Polity', 'GS2 · Governance', 'GS2 · International'],
  gs3: [], gs4: [], essay: [], // no matching cheat sheet uploaded to the Library (yet)
};
async function notesContextFor(paperId) {
  const keys = NOTES_MATCH[paperId] || [];
  if (!keys.length) return '';
  const docs = await DB.allDocs();
  const matched = keys.map(k => docs.find(d => d.title.includes(k))).filter(Boolean);
  if (!matched.length) return '';
  const capEach = Math.floor(9000 / matched.length);
  return matched.map(d => d.lines.join('\n').slice(0, capEach)).join('\n\n---\n\n');
}

const PAPER_DELTA = {
  essay: "This is an ESSAY topic (an aphoristic/philosophical quote), not a GS question — no directive verb applies and the normal word-budget rule below does NOT apply. Instead write a compact revision SKELETON: a one-line thesis, 5-6 dimensions (each a short paragraph naming ONE concrete example/anecdote/data point), and a one-line closing vision.",
  gs1: "This paper covers History/Culture, Geography and Society — match the register to the question: chronological spine + one historiographical verdict for History/Culture (name actual monuments/styles/texts); physical process/mechanism first for Geography (name real regions/case sites); data + the caste/gender/region intersectionality lens for Society.",
  gs2: "This paper covers Polity, Governance & Social Justice, and International Relations — match the register: Article numbers + Supreme Court judgments + commissions (Punchhi/Sarkaria/NCRWC) for Polity; scheme names + performance data + 2nd ARC as authority for Governance/SJ; doctrine/policy name → convergences → frictions → way forward, with summits/groupings named exactly with year, for IR.",
  gs3: "Open with a data point (Economic Survey/Budget/NCRB/IPCC). Name actual schemes/missions. Security questions: threat anatomy → state response → gaps → reform.",
  gs4: "This is GS4 Ethics — no committees/Articles/data needed. Theory questions: define the concept crisply, use ONE named thinker/framework, ONE concrete administrative example. Case studies: stakeholders → the conflicting ethical values/issues → 2-3 options with their trade-offs → a reasoned, decisive course of action — the course of action is mandatory and is what examiners specifically reward.",
  pubad1: "Answer IN the discipline's vocabulary (locus/focus, ideal type, prismatic society…). Every theory needs ONE Indian administrative bridge example. A scholarly critique (who challenged the idea, and how) is mandatory. Open with a thinker quote or paradigm hook.",
  pubad2: "Anchor in the Constitution/committees (2nd ARC as first authority). Interlink ONE Paper-I theory concept into the answer — this Paper-I↔II interlinking is the topper differentiator. Keep current developments in the administrative lane, not partisan commentary.",
};

const DIRECTIVE_SHAPE = {
  'critically examine': 'merits → limits → a balanced verdict (the verdict is mandatory)',
  'critically analyse': 'merits → limits → a balanced verdict (the verdict is mandatory)',
  'critically evaluate': 'merits → limits → a balanced verdict (the verdict is mandatory)',
  examine: 'break the topic into components, probe cause/effect, an evidence-led finding',
  discuss: 'multiple dimensions or both sides, then a reasoned position',
  comment: 'a brief unpacking, then your own substantiated stand',
  elucidate: 'make the linkage clear with mechanism + examples — no debate needed',
  explain: 'make the linkage clear with mechanism + examples — no debate needed',
  evaluate: 'weigh against explicit criteria, end with a judgement',
  assess: 'weigh against explicit criteria, end with a judgement',
  compare: 'paired points, criteria-wise — never serial description',
  contrast: 'paired points, criteria-wise — never serial description',
  analyse: 'break into components, an evidence-led finding',
  trace: 'chronological development to the present, a brief evaluative close',
  justify: 'build the case with evidence, then acknowledge and rebut the strongest objection',
  illustrate: 'let concrete named examples do the explanatory work',
  essay: 'thesis → 5-6 dimensions each anchored to one concrete example → closing vision — this is a revision skeleton, not the full 1000-1200 word essay',
  'case study': 'stakeholders → conflicting ethical values/issues → options with trade-offs → a reasoned, decisive course of action (mandatory)',
};

function buildPrompt(q, p, sectionTitle, notes) {
  const dir = directiveOf(q.q, p.id, sectionTitle);
  return `You are writing a UPSC CSE Mains 2026 topper-level model answer for the paper "${p.title}" (section: ${sectionTitle}).

QUESTION (${q.m} marks, ${q.w}-word target): "${q.q}"
Directive: ${dir}

HARD RULES:
- Word budget: the intro + body + way-forward + conclusion combined must land within ${Math.round(q.w * 0.9)}–${Math.round(q.w * 1.1)} words when read as plain prose (unless the paper-specific requirement below overrides this). Do not pad; density over length.
- Never invent committees, data, Articles, case names or schemes. If you are not confident a fact is correct, either omit it or include it with "vf":"u". You have no live web access, so never use "vf":"w" — every fact you include is either "n" (matches the notes below) or "u" (your own knowledge, unverified here).
- Directive shape for "${dir}": ${DIRECTIVE_SHAPE[dir] || DIRECTIVE_SHAPE.discuss}.
- Paper-specific requirement: ${PAPER_DELTA[p.id] || 'Use precise named examples, data, committees or thinkers as the discipline demands.'}
- Wrap every load-bearing keyword the exam-writer must reproduce in **double asterisks**.
- Only include "diag" if a genuinely simple hand-drawable diagram helps; only include "mne" if there is a real list of 4+ items worth memorising as one — omit both otherwise.
${notes ? `\nGROUND THE ANSWER IN THIS MATERIAL (the user's own revision notes for this paper — reuse its keywords, thinkers and examples; do not contradict it):\n${notes}\n` : ''}
Return ONLY one JSON object, no markdown fences, no commentary, exactly this shape:
{
  "directive": "${dir}",
  "lens": "one sentence: what specifically fetches marks in this question",
  "intro": [{"t":"concept|thinker|data|event","x":"intro text with **gold** keywords"}],
  "body": [{"h":"Section heading","p":[{"x":"point text with **gold** keywords","vf":"n"}]}],
  "wf": ["way-forward point"],
  "conc": "conclusion line with **gold** keywords",
  "flash": ["5 load-bearing recall phrases"]
}`;
}

function extractJSON(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('The model did not return JSON — try again');
  const parsed = JSON.parse(text.slice(s, e + 1));
  if (!Array.isArray(parsed.body) || !parsed.body.length) throw new Error('The model returned an incomplete answer — try again');
  return parsed;
}

async function generateAnswer(q, p, sectionTitle) {
  const notes = await notesContextFor(p.id);
  const raw = await aiComplete(buildPrompt(q, p, sectionTitle, notes));
  const a = extractJSON(raw);
  a.generated = true;
  return a;
}

/* ---------- home: paper grid ---------- */
async function renderHome() {
  const cards = await Promise.all(banks.map(async p => {
    const qs = allQs(p);
    const branchN = qs.reduce((n, q) => n + (q.branches?.length || 0), 0);
    const ans = await loadAnswers(p.id);
    const done = qs.filter(q => ans[qid(p.id, q.n)]).length;
    const drop = qs.filter(q => dropped.has(qid(p.id, q.n))).length;
    return `<button class="bank-card" data-p="${p.id}">
      <span class="bank-ic">${p.icon}</span>
      <span class="bank-name">${p.short}${p.optional ? ' <span class="tiny muted">optional</span>' : ''}</span>
      <span class="bank-meta">${qs.length - drop} final${branchN ? ` · ${branchN} branches` : ''}${drop ? ` · ${drop} dropped` : ''}</span>
      <span class="bank-prog ${done ? '' : 'none'}">${done ? `✅ ${done}/${qs.length} answered` : '⏳ answers pending'}</span>
    </button>`;
  }));
  root.innerHTML = `
    <div class="bank-top"><h2>📝 Model Answer Bank</h2>
      <p class="tiny muted">Your locked 2026 final question list · ${banks.reduce((a, p) => a + allQs(p).length, 0)} master questions
      (+${banks.reduce((a, p) => a + allQs(p).reduce((n, q) => n + (q.branches?.length || 0), 0), 0)} branch angles) ·
      answers generated paper-wise, verified, exam-reproducible</p></div>
    <div class="bank-grid">${cards.join('')}</div>`;
  root.querySelectorAll('.bank-card').forEach(c => c.onclick = () => { nav = { ...nav, view: 'paper', paper: c.dataset.p }; render(); });
}

/* ---------- paper: sections + question rows ---------- */
async function renderPaper() {
  const p = paper();
  const ans = await loadAnswers(p.id);
  const open = await DB.getKV('bank-open-' + p.id, p.sections.map((_, i) => i === 0));
  root.innerHTML = `
    <div class="bank-top row">
      <button class="btn ghost sm" id="bk-back">←</button>
      <div><b>${p.icon} ${p.title}</b><div class="tiny muted">${allQs(p).length} Qs · tap a section</div></div>
    </div>
    <div class="bank-scroll">${p.sections.map((s, si) => `
      <div class="bank-sec">
        <button class="bank-sech" data-si="${si}">${escapeHtml(s.t)} <span class="muted tiny">${s.qs.length}</span></button>
        <div class="bank-qs" style="${open[si] ? '' : 'display:none'}">
          ${s.qs.map(q => {
            const id = qid(p.id, q.n), has = ans[id], off = dropped.has(id);
            const bN = q.branches?.length || 0;
            return `<button class="bank-q ${off ? 'off' : ''}" data-q="${q.n}">
              <span class="bank-qn">${q.n}</span>
              <span class="bank-qt">${q.title ? `<b>${escapeHtml(q.title)}.</b> ` : ''}${escapeHtml(q.q.length > 110 ? q.q.slice(0, 110) + '…' : q.q)}</span>
              <span class="bank-qm">${q.m}m${q.tier ? ` · T${q.tier}` : ''}${bN ? ` · 🌿${bN}` : ''} ${has ? '✅' : ''}</span>
            </button>`;
          }).join('')}
        </div>
      </div>`).join('')}
    </div>`;
  root.querySelector('#bk-back').onclick = () => { nav = { ...nav, view: 'home' }; render(); };
  root.querySelectorAll('.bank-sech').forEach(h => h.onclick = async () => {
    open[h.dataset.si] = !open[h.dataset.si];
    await DB.setKV('bank-open-' + p.id, open);
    h.nextElementSibling.style.display = open[h.dataset.si] ? '' : 'none';
  });
  root.querySelectorAll('.bank-q').forEach(b => b.onclick = () => { nav = { ...nav, view: 'q', q: +b.dataset.q, branch: null, mode: 'full' }; render(); });
}

/* ---------- question: answer viewer (branch-aware) ---------- */
async function renderQuestion() {
  const p = paper();
  const { q: mainQ, sectionTitle } = findQuestion(p, nav.q);
  const branches = mainQ.branches || [];
  const onBranch = nav.branch != null && nav.branch < branches.length;
  const activeQ = onBranch ? branches[nav.branch] : mainQ;
  const activeId = qid(p.id, mainQ.n, onBranch ? nav.branch : null);
  const allAns = await loadAnswers(p.id);
  const ans = allAns[activeId];
  const dir = ans?.directive || directiveOf(activeQ.q, p.id, sectionTitle);
  const time = Math.round(activeQ.m * 0.72);
  const off = dropped.has(qid(p.id, mainQ.n)); // drop applies to the whole prepared theme, not per-branch
  const isEssay = p.id === 'essay';
  const wc = ans ? wordCount(ans) : 0;
  const wcOk = ans && wc >= activeQ.w * 0.9 && wc <= activeQ.w * 1.1;
  const noteRefs = notesRefsFor(ans ? walk(ans, activeQ).join(' ') : activeQ.q, 6);

  root.innerHTML = `
    <div class="bank-top row">
      <button class="btn ghost sm" id="bk-back">←</button>
      <div class="row" style="gap:6px;flex:1">
        <span class="chip on">${activeQ.m} marks</span>
        <span class="chip">${dir}</span><span class="chip">⏱ ${time} min</span>
        ${isEssay ? '' : ans
          ? `<span class="chip ${wcOk ? 'wc-ok' : 'wc-bad'}" title="exam-written words vs the ${activeQ.w}-word limit">${wc}/${activeQ.w}w</span>`
          : `<span class="chip">${activeQ.w}w</span>`}
      </div>
      <button class="btn ghost sm" id="bk-drop" title="drop from final list">${off ? '♻️' : '🗑'}</button>
    </div>
    ${branches.length ? `
    <div class="chiprow" style="padding:8px 14px 0">
      <button class="chip ${onBranch ? '' : 'on'}" data-b="main">🌳 Main</button>
      ${branches.map((b, i) => `<button class="chip ${nav.branch === i ? 'on' : ''}" data-b="${i}">↳ Branch ${i + 1}${b.label ? ` (${escapeHtml(b.label)})` : ''}</button>`).join('')}
    </div>` : ''}
    <div class="bank-scroll">
      <div class="bank-qfull ${off ? 'off' : ''}" data-ln="0">
        ${onBranch ? `<div class="tiny muted" style="margin-bottom:4px">↳ Branch angle on Q${mainQ.n}</div>` : ''}
        ${activeQ.title ? `<b>${escapeHtml(activeQ.title)}.</b> ` : ''}${escapeHtml(activeQ.q)}
        <div class="tiny muted" style="margin-top:6px">§ ${escapeHtml(sectionTitle)} · Q${mainQ.srcNo ?? mainQ.n}</div>
      </div>
      ${ans ? `
      <div class="seg" style="margin:10px 14px 0">
        ${[['full', '📄 Full'], ['skel', '🦴 Skeleton'], ['card', '🃏 Card']].map(([v, l]) =>
          `<button class="seg-btn ${nav.mode === v ? 'on' : ''}" data-m="${v}">${l}</button>`).join('')}
      </div>
      <div class="row" style="padding:8px 14px 0;gap:8px">
        <button class="btn sm" id="bk-audio">🔊 Listen</button>
        <button class="btn sm" id="bk-ai">✨ AI</button>
        ${ans.generated ? `<button class="chip" id="bk-regen" title="regenerate">✨ AI-generated · 🔄</button>` : ''}
        ${ans.lens ? `<span class="tiny muted" style="flex:1">🎯 ${escapeHtml(ans.lens)}</span>` : ''}
      </div>
      <div id="bk-answer">${renderAnswer(ans, activeQ)}</div>` : `
      <div class="bank-pending card-ui" style="margin:14px" id="bk-pending">
        ${anyAIKey()
          ? `⏳ <b>No answer yet.</b>
             <p class="tiny muted" style="margin:6px 0 10px">Generate one now with your saved AI key, grounded in your uploaded notes for this paper. It's saved on this device and marked ✨ AI-generated until a verified batch replaces it.</p>
             <button class="btn primary" id="bk-gen">✨ Generate model answer</button>`
          : `⏳ <b>No answer yet.</b>
             <p class="tiny muted" style="margin-top:6px">Add an OpenAI, Gemini or Anthropic API key in <b>Library ▸ ⚙️ Settings</b> to generate this answer on the spot, or wait for the next verified batch.</p>`}
      </div>`}
      ${noteRefs.length ? `
      <div class="bank-notes">
        <div class="bank-notes-h">📎 From your notes <span class="tiny muted">— where your Library covers this</span></div>
        ${noteRefs.map(r => `<div class="bank-note"><b>${escapeHtml(r.match)}</b>
          <span class="muted">→ ${escapeHtml(r.docTitle)} · ${escapeHtml(r.theme)}</span></div>`).join('')}
      </div>` : ''}
    </div>`;

  root.querySelector('#bk-back').onclick = () => { nav = { ...nav, view: 'paper' }; render(); };
  root.querySelectorAll('[data-b]').forEach(b => b.onclick = () => {
    nav.branch = b.dataset.b === 'main' ? null : +b.dataset.b;
    nav.mode = 'full';
    render();
  });
  root.querySelector('#bk-drop').onclick = async () => {
    const mainId = qid(p.id, mainQ.n);
    off ? dropped.delete(mainId) : dropped.add(mainId);
    await DB.setKV('bank-dropped', [...dropped]);
    toast(off ? '♻️ Back in the final list' : '🗑 Dropped from final list');
    render();
  };
  const genBtn = root.querySelector('#bk-gen') || root.querySelector('#bk-regen');
  if (genBtn) genBtn.onclick = async () => {
    const original = genBtn.textContent;
    genBtn.disabled = true; genBtn.textContent = '⏳ Generating…';
    try {
      const a = await generateAnswer(activeQ, p, sectionTitle);
      await saveGenerated(p.id, activeId, a);
      toast('✨ Model answer generated');
      render();
    } catch (e) {
      toast('❌ ' + e.message, 4500);
      genBtn.disabled = false; genBtn.textContent = original;
    }
  };
  if (!ans) return;
  root.querySelectorAll('.seg-btn').forEach(b => b.onclick = () => {
    stopBankAudio();
    nav.mode = b.dataset.m;
    root.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('on', x === b));
    root.querySelector('#bk-answer').innerHTML = renderAnswer(ans, activeQ);
    wireAnswer(ans, activeQ);
  });
  root.querySelector('#bk-audio').onclick = () => toggleBankAudio(ans, activeQ);
  root.querySelector('#bk-ai').onclick = () => aiSheet(ans, activeQ);
  wireAnswer(ans, activeQ);
}

/* ---------- one linear walk shared by the Full view and the audio player:
   walk()[i] speaks as line i, and the element tagged data-ln="i" is its
   on-screen counterpart — tap it to play from there, highlight follows. */
function walk(a, q) {
  const seq = [{ text: 'Question. ' + q.q }];
  if (a.intro?.[0]) seq.push({ text: plain(a.intro[0].x) });
  (a.body || []).forEach(s => {
    seq.push({ text: plain(s.h) + ':' });
    s.p.forEach(pt => seq.push({ text: plain(pt.x) }));
  });
  if (a.wf?.length) { seq.push({ text: 'Way forward:' }); a.wf.forEach(x => seq.push({ text: plain(x) })); }
  if (a.conc) seq.push({ text: 'In conclusion. ' + plain(a.conc) });
  return seq.map(s => s.text);
}

function renderAnswer(a, q) {
  if (nav.mode === 'skel') return renderSkeleton(a);
  if (nav.mode === 'card') return renderCard(a, q);
  const vf = { n: '', w: ' <sup class="vf w" title="web-verified">✓</sup>', u: ' <sup class="vf u" title="could not verify — use with care">⚠</sup>' };
  let ln = 1; // 0 = the question block rendered above
  const introA = a.intro?.[0] ? `<p class="ans-intro aud" data-ln="${ln++}">${a.intro.length > 1 ? `<span class="ans-lbl">intro A · ${a.intro[0].t}</span>` : ''}${md(a.intro[0].x)}</p>` : '';
  const introB = a.intro?.[1] ? `<p class="ans-intro alt">${`<span class="ans-lbl">intro B · ${a.intro[1].t} (alternative — not counted, not narrated)</span>`}${md(a.intro[1].x)}</p>` : '';
  const body = (a.body || []).map(s =>
    `<h4 class="ans-h aud" data-ln="${ln++}">${md(s.h)}</h4>
     <ul class="ans-ul">${s.p.map(pt => `<li class="aud" data-ln="${ln++}">${md(pt.x)}${vf[pt.vf || 'n']}</li>`).join('')}</ul>`).join('');
  const wf = a.wf?.length
    ? `<h4 class="ans-h aud" data-ln="${ln++}">Way forward</h4><ul class="ans-ul">${a.wf.map(x => `<li class="aud" data-ln="${ln++}">${md(x)}</li>`).join('')}</ul>` : '';
  const conc = a.conc ? `<p class="ans-conc aud" data-ln="${ln++}">${md(a.conc)}</p>` : '';
  return `<div class="bank-ans">
    ${introA}${introB}${body}${wf}${conc}
    ${a.diag ? renderDiag(a.diag) : ''}
    ${a.mne ? `<p class="ans-mne">🧠 ${md(a.mne)}</p>` : ''}
  </div>`;
}

function renderSkeleton(a) {
  const line = (pt) => {
    const g = golds(pt.x);
    return g.length ? g.join(' · ') : plain(pt.x).split(' ').slice(0, 7).join(' ') + '…';
  };
  return `<div class="bank-ans skel">
    ${(a.intro || []).slice(0, 1).map(o => `<p class="ans-intro">${(golds(o.x)[0]) ? `<b class="au">${escapeHtml(golds(o.x).join(' · '))}</b>` : md(o.x)}</p>`).join('')}
    ${(a.body || []).map(s => `<h4 class="ans-h">${md(s.h)}</h4>
      <ul class="ans-ul">${s.p.map(pt => `<li><b class="au">${escapeHtml(line(pt))}</b></li>`).join('')}</ul>`).join('')}
    ${a.conc ? `<p class="ans-conc"><b class="au">${escapeHtml(golds(a.conc).join(' · ') || plain(a.conc).split(' ').slice(0, 8).join(' ') + '…')}</b></p>` : ''}
  </div>`;
}

function renderCard(a, q) {
  const pts = a.flash?.length ? a.flash : (a.body || []).flatMap(s => s.p.map(pt => golds(pt.x)[0]).filter(Boolean)).slice(0, 6);
  return `<div class="bank-flash" id="bk-flash">
    <div class="bank-flash-q">${escapeHtml(q.q)}<div class="tiny muted" style="margin-top:10px">tap to reveal the ${pts.length} load-bearing points</div></div>
    <ul class="bank-flash-a" style="display:none">${pts.map(x => `<li>${md(x)}</li>`).join('')}</ul>
  </div>`;
}

function wireAnswer(a, q) {
  const f = root.querySelector('#bk-flash');
  if (f) {
    f.onclick = () => {
      f.querySelector('.bank-flash-q').style.display = f.querySelector('.bank-flash-q').style.display === 'none' ? '' : 'none';
      const el = f.querySelector('.bank-flash-a');
      el.style.display = el.style.display === 'none' ? '' : 'none';
    };
  }
  // read-along: tap any audible line to play from it (Full view only)
  if (nav.mode === 'full') {
    root.querySelectorAll('[data-ln]').forEach(el => el.addEventListener('click', () => {
      const i = +el.dataset.ln;
      if (bankPlaying) speech.seek(i);
      else startBankAudio(a, q, i);
    }));
  }
}

function renderDiag(d) {
  if (d.k === 'flow') return `<div class="ans-diag">${d.d.split('→').map(s => `<span class="dg-box">${escapeHtml(s.trim())}</span>`).join('<span class="dg-ar">→</span>')}</div>`;
  if (d.k === 'hub') {
    const [c, ...sp] = d.d.split('|');
    return `<div class="ans-diag hub"><span class="dg-box hubc">${escapeHtml(c.trim())}</span><div class="dg-spokes">${sp.map(s => `<span class="dg-box">${escapeHtml(s.trim())}</span>`).join('')}</div></div>`;
  }
  return `<div class="ans-diag"><pre class="tiny">${escapeHtml(d.d)}</pre></div>`;
}

/* ---------- read-along audio over the shared speech engine ---------- */
let saved = null, bankPlaying = false;

function highlightLine(i) {
  root.querySelectorAll('.ans-hl').forEach(el => el.classList.remove('ans-hl'));
  const el = root.querySelector(`[data-ln="${i}"]`);
  if (el) {
    el.classList.add('ans-hl');
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
}

function startBankAudio(a, q, fromLine = 0) {
  if (!bankPlaying) {
    saved = { onLine: speech.onLine, onWord: speech.onWord, onLineDone: speech.onLineDone, onState: speech.onState, onFinish: speech.onFinish };
    speech.onWord = () => {}; speech.onLineDone = () => {};
    speech.onLine = highlightLine;
    speech.onState = (on) => { const b = root.querySelector('#bk-audio'); if (b) b.textContent = on ? '⏸ Pause' : '▶ Resume'; };
    speech.onFinish = () => stopBankAudio();
    speech.load(walk(a, q), fromLine);
    bankPlaying = true;
  }
  speech.play();
  highlightLine(fromLine);
}

function toggleBankAudio(a, q) {
  if (bankPlaying) { speech.playing ? speech.pause() : speech.play(); return; }
  if (nav.mode !== 'full') { // audio follows the Full view — switch to it first
    nav.mode = 'full';
    root.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('on', x.dataset.m === 'full'));
    root.querySelector('#bk-answer').innerHTML = renderAnswer(a, q);
    wireAnswer(a, q);
  }
  startBankAudio(a, q, 0);
}

function stopBankAudio() {
  if (!bankPlaying) return;
  speech.stop();
  Object.assign(speech, saved || {});
  saved = null; bankPlaying = false;
  const b = root && root.querySelector('#bk-audio'); if (b) b.textContent = '🔊 Listen';
  root && root.querySelectorAll('.ans-hl').forEach(el => el.classList.remove('ans-hl'));
}

/* ---------- ✨ AI actions (opt-in, whichever key the user saved) ---------- */
function aiSheet(a, q) {
  if (!anyAIKey()) {
    sheet(`<h3>✨ AI actions</h3><p class="muted">Add an OpenAI, Gemini or Anthropic API key in <b>Library ▸ ⚙️ Settings</b> to enable
      Polish, Extra points, Diagramise and Re-angle on any answer. The key stays in this browser.</p>
      <div class="row"><div class="spacer"></div><button class="btn primary" id="ok">OK</button></div>`,
      r => r.querySelector('#ok').onclick = closeSheet);
    return;
  }
  const full = walk(a, q).join('\n');
  const acts = {
    polish: ['✍️ Polish', 'Tighten the language of this UPSC model answer. Keep EVERY named fact, keyword and the exact structure. Return the improved answer only.'],
    extra: ['➕ Extra points', 'Suggest 3-4 ADDITIONAL scoring points (keyword → mechanism → named example) that this UPSC answer is missing. Only verifiable facts; flag anything you are unsure of with ⚠.'],
    diagram: ['📊 Diagramise', 'Propose ONE simple hand-drawable diagram (flowchart, hub-and-spoke, or 2-column table) for this UPSC answer. Describe it in plain text so it can be drawn in 30 seconds in an exam.'],
    reangle: ['🎯 Re-angle', `Rewrite the skeleton of this answer as if the directive were different (currently "${a.directive || 'discuss'}"). Show headings + keywords only for: Comment, Examine, Critically examine.`],
  };
  sheet(`<h3>✨ AI actions</h3>
    <div class="chiprow" style="margin:8px 0">${Object.entries(acts).map(([k, [l]]) => `<button class="chip" data-a="${k}">${l}</button>`).join('')}</div>
    <div id="ai-out" class="card-ui tiny" style="white-space:pre-wrap;max-height:50vh;overflow:auto;margin-top:8px">Pick an action.</div>
    <div class="row" style="margin-top:10px"><div class="spacer"></div><button class="btn sm" id="ai-close">Close</button></div>`,
    r => {
      r.querySelector('#ai-close').onclick = closeSheet;
      r.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
        const out = r.querySelector('#ai-out');
        out.textContent = '…thinking';
        try {
          out.textContent = await aiComplete(
            `${acts[b.dataset.a][1]}\n\nQUESTION: ${q.q}\n\nANSWER:\n${full}`);
        } catch (e) { out.textContent = '❌ ' + e.message; }
      });
    });
}
