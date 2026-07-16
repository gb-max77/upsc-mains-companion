// 📝 Bank — the locked question banks with pre-generated model answers.
// Views per answer: Full / Skeleton / Flashcard, plus audio narration.
// Answers ship as static JSON (data/answers/<paperId>.json), generated paper-wise.
import { DB } from './db.js';
import { speech } from './tts.js';
import { sheet, closeSheet, toast, escapeHtml } from './ui.js';
import { openaiAvailable, callOpenAI } from './ai.js';

let root = null;
let banks = [];
const answers = {};           // paperId -> {qid: answer} | null (fetched, none yet)
let dropped = new Set();
let nav = { view: 'home', paper: null, q: null, mode: 'full' };

export async function mountAnswers(el) {
  root = el;
  dropped = new Set(await DB.getKV('bank-dropped', []));
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
  try {
    const res = await fetch(`data/answers/${pid}.json`);
    answers[pid] = res.ok ? await res.json() : null;
  } catch { answers[pid] = null; }
  return answers[pid];
}

const qid = (pid, n) => `${pid}-${n}`;
const paper = () => banks.find(p => p.id === nav.paper);
const allQs = (p) => p.sections.flatMap(s => s.qs);

function directiveOf(q) {
  const m = q.toLowerCase().match(/critically (?:examine|analyse|evaluate)|examine|discuss|comment|elucidate|analyse|evaluate|assess|compare|contrast|trace|justify|illustrate|explain/);
  return m ? m[0] : 'discuss';
}

// **gold** markup → highlighted spans (escape first)
function md(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b class="au">$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
}
const plain = (s) => s.replace(/\*\*?/g, '');
const golds = (s) => [...s.matchAll(/\*\*(.+?)\*\*/g)].map(m => m[1]);

function render() {
  if (nav.view === 'home') renderHome();
  else if (nav.view === 'paper') renderPaper();
  else renderQuestion();
}

/* ---------- home: paper grid ---------- */
async function renderHome() {
  const cards = await Promise.all(banks.map(async p => {
    const qs = allQs(p);
    const ans = await loadAnswers(p.id);
    const done = ans ? qs.filter(q => ans[qid(p.id, q.n)]).length : 0;
    const drop = qs.filter(q => dropped.has(qid(p.id, q.n))).length;
    return `<button class="bank-card" data-p="${p.id}">
      <span class="bank-ic">${p.icon}</span>
      <span class="bank-name">${p.short}${p.optional ? ' <span class="tiny muted">optional</span>' : ''}</span>
      <span class="bank-meta">${qs.length - drop} final${drop ? ` · ${drop} dropped` : ''}</span>
      <span class="bank-prog ${done ? '' : 'none'}">${done ? `✅ ${done}/${qs.length} answered` : '⏳ answers pending'}</span>
    </button>`;
  }));
  root.innerHTML = `
    <div class="bank-top"><h2>📝 Model Answer Bank</h2>
      <p class="tiny muted">Your locked 2026 question lists · ${banks.reduce((a, p) => a + allQs(p).length, 0)} questions ·
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
            const id = qid(p.id, q.n), has = ans && ans[id], off = dropped.has(id);
            return `<button class="bank-q ${off ? 'off' : ''}" data-q="${q.n}">
              <span class="bank-qn">${q.n}</span>
              <span class="bank-qt">${escapeHtml(q.q.length > 110 ? q.q.slice(0, 110) + '…' : q.q)}</span>
              <span class="bank-qm">${q.m}m${q.tier ? ` · T${q.tier}` : ''}${q.topic ? ' · 🏷' : ''} ${has ? '✅' : ''}</span>
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
  root.querySelectorAll('.bank-q').forEach(b => b.onclick = () => { nav = { ...nav, view: 'q', q: +b.dataset.q, mode: 'full' }; render(); });
}

/* ---------- question: answer viewer ---------- */
async function renderQuestion() {
  const p = paper();
  const q = allQs(p).find(x => x.n === nav.q);
  const id = qid(p.id, q.n);
  const ans = (await loadAnswers(p.id))?.[id];
  const dir = ans?.directive || directiveOf(q.q);
  const time = Math.round(q.m * 0.72);
  const off = dropped.has(id);

  root.innerHTML = `
    <div class="bank-top row">
      <button class="btn ghost sm" id="bk-back">←</button>
      <div class="row" style="gap:6px;flex:1">
        <span class="chip on">${q.m} marks</span><span class="chip">${q.w}w</span>
        <span class="chip">⏱ ${time} min</span><span class="chip">${dir}</span>
      </div>
      <button class="btn ghost sm" id="bk-drop" title="drop from final list">${off ? '♻️' : '🗑'}</button>
    </div>
    <div class="bank-scroll">
      <div class="bank-qfull ${off ? 'off' : ''}">${escapeHtml(q.q)}
        <div class="tiny muted" style="margin-top:6px">${escapeHtml(q.src)}${q.topic ? ' · 🏷 topic title — frame the stem yourself' : ''}${q.theme ? ' · ' + escapeHtml(q.theme) : ''}</div>
      </div>
      ${ans ? `
      <div class="seg" style="margin:10px 14px 0">
        ${[['full', '📄 Full'], ['skel', '🦴 Skeleton'], ['card', '🃏 Card']].map(([v, l]) =>
          `<button class="seg-btn ${nav.mode === v ? 'on' : ''}" data-m="${v}">${l}</button>`).join('')}
      </div>
      <div class="row" style="padding:8px 14px 0;gap:8px">
        <button class="btn sm" id="bk-audio">🔊 Listen</button>
        <button class="btn sm" id="bk-ai">✨ AI</button>
        ${ans.lens ? `<span class="tiny muted" style="flex:1">🎯 ${escapeHtml(ans.lens)}</span>` : ''}
      </div>
      <div id="bk-answer">${renderAnswer(ans, q)}</div>` : `
      <div class="bank-pending card-ui" style="margin:14px">⏳ <b>Answer batch pending.</b>
        <p class="tiny muted" style="margin-top:6px">Answers are being generated paper-wise (verified against notes + web).
        This one will appear in an upcoming deploy — pull-to-refresh once notified.</p></div>`}
    </div>`;

  root.querySelector('#bk-back').onclick = () => { stopBankAudio(); nav = { ...nav, view: 'paper' }; render(); };
  root.querySelector('#bk-drop').onclick = async () => {
    off ? dropped.delete(id) : dropped.add(id);
    await DB.setKV('bank-dropped', [...dropped]);
    toast(off ? '♻️ Back in the final list' : '🗑 Dropped from final list');
    render();
  };
  if (!ans) return;
  root.querySelectorAll('.seg-btn').forEach(b => b.onclick = () => {
    nav.mode = b.dataset.m;
    root.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('on', x === b));
    root.querySelector('#bk-answer').innerHTML = renderAnswer(ans, q);
    wireCard(ans);
  });
  root.querySelector('#bk-audio').onclick = () => toggleBankAudio(ans, q);
  root.querySelector('#bk-ai').onclick = () => aiSheet(ans, q);
  wireCard(ans);
}

function renderAnswer(a, q) {
  if (nav.mode === 'skel') return renderSkeleton(a);
  if (nav.mode === 'card') return renderCard(a, q);
  const vf = { n: '', w: ' <sup class="vf w" title="web-verified">✓</sup>', u: ' <sup class="vf u" title="could not verify — use with care">⚠</sup>' };
  return `<div class="bank-ans">
    ${(a.intro || []).map((o, i) => `<p class="ans-intro">${a.intro.length > 1 ? `<span class="ans-lbl">intro ${['A', 'B'][i]} · ${o.t}</span>` : ''}${md(o.x)}</p>`).join('')}
    ${(a.body || []).map(s => `<h4 class="ans-h">${md(s.h)}</h4>
      <ul class="ans-ul">${s.p.map(pt => `<li>${md(pt.x)}${vf[pt.vf || 'n']}</li>`).join('')}</ul>`).join('')}
    ${a.wf?.length ? `<h4 class="ans-h">Way forward</h4><ul class="ans-ul">${a.wf.map(x => `<li>${md(x)}</li>`).join('')}</ul>` : ''}
    ${a.conc ? `<p class="ans-conc">${md(a.conc)}</p>` : ''}
    ${a.diag ? renderDiag(a.diag) : ''}
    ${a.mne ? `<p class="ans-mne">🧠 ${md(a.mne)}</p>` : ''}
    ${a.angle ? `<p class="tiny muted" style="margin-top:8px">🎯 Angle: ${escapeHtml(a.angle)}</p>` : ''}
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
function wireCard() {
  const f = root.querySelector('#bk-flash');
  if (!f) return;
  f.onclick = () => {
    f.querySelector('.bank-flash-q').style.display = f.querySelector('.bank-flash-q').style.display === 'none' ? '' : 'none';
    const a = f.querySelector('.bank-flash-a');
    a.style.display = a.style.display === 'none' ? '' : 'none';
  };
}

function renderDiag(d) {
  if (d.k === 'flow') return `<div class="ans-diag">${d.d.split('→').map(s => `<span class="dg-box">${escapeHtml(s.trim())}</span>`).join('<span class="dg-ar">→</span>')}</div>`;
  if (d.k === 'hub') {
    const [c, ...sp] = d.d.split('|');
    return `<div class="ans-diag hub"><span class="dg-box hubc">${escapeHtml(c.trim())}</span><div class="dg-spokes">${sp.map(s => `<span class="dg-box">${escapeHtml(s.trim())}</span>`).join('')}</div></div>`;
  }
  return `<div class="ans-diag"><pre class="tiny">${escapeHtml(d.d)}</pre></div>`;
}

/* ---------- audio: linearise Full view into the shared speech engine ---------- */
let saved = null, bankPlaying = false;
function answerLines(a, q) {
  const L = ['Question. ' + q.q];
  if (a.intro?.[0]) L.push(plain(a.intro[0].x));
  (a.body || []).forEach(s => { L.push(plain(s.h) + ':'); s.p.forEach(pt => L.push(plain(pt.x))); });
  if (a.wf?.length) { L.push('Way forward:'); a.wf.forEach(x => L.push(plain(x))); }
  if (a.conc) L.push('In conclusion. ' + plain(a.conc));
  return L;
}
function toggleBankAudio(a, q) {
  if (bankPlaying) { stopBankAudio(); return; }
  saved = { onLine: speech.onLine, onWord: speech.onWord, onLineDone: speech.onLineDone, onState: speech.onState, onFinish: speech.onFinish };
  speech.onWord = () => {}; speech.onLineDone = () => {};
  speech.onLine = (i) => root.querySelectorAll('#bk-answer li, #bk-answer p, #bk-answer h4').forEach(el => el.classList.remove('ans-hl'));
  speech.onState = (on) => { const b = root.querySelector('#bk-audio'); if (b) b.textContent = on ? '⏸ Pause' : '🔊 Listen'; };
  speech.onFinish = () => stopBankAudio();
  speech.load(answerLines(a, q));
  speech.play();
  bankPlaying = true;
}
function stopBankAudio() {
  if (!bankPlaying) return;
  speech.stop();
  Object.assign(speech, saved || {});
  saved = null; bankPlaying = false;
  const b = root.querySelector('#bk-audio'); if (b) b.textContent = '🔊 Listen';
}

/* ---------- ✨ OpenAI actions (opt-in, user's key) ---------- */
function aiSheet(a, q) {
  if (!openaiAvailable()) {
    sheet(`<h3>✨ AI actions</h3><p class="muted">Add your OpenAI API key in <b>Library ▸ ⚙️ Settings</b> to enable
      Polish, Extra points, Diagramise and Re-angle on any answer. The key stays in this browser.</p>
      <div class="row"><div class="spacer"></div><button class="btn primary" id="ok">OK</button></div>`,
      r => r.querySelector('#ok').onclick = closeSheet);
    return;
  }
  const full = answerLines(a, q).join('\n');
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
          out.textContent = await callOpenAI(
            `${acts[b.dataset.a][1]}\n\nQUESTION: ${q.q}\n\nANSWER:\n${full}`);
        } catch (e) { out.textContent = '❌ ' + e.message; }
      });
    });
}
