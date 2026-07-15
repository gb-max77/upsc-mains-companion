// Listen view: karaoke read-along player with focus mode, theme dots,
// Verbatim/Flow narration modes and cross-document theme navigation.
import { DB } from './db.js';
import { parseStructure, flowLines, classifyLine, cleanTitle, titleMeta, decorateLine } from './parser.js';
import { speech, SPEEDS } from './tts.js';
import { sheet, closeSheet, toast, escapeHtml } from './ui.js';

let el, doc = null, lines = [], structure = null, chunks = [], mode = 'verbatim';
let autoScroll = true, saveTimer = null;
let wordPrefix = [], wordFrac = 0; // for the elapsed/total time estimate
const WPM_BASE = 155; // average narration words/min at 1x speed

const modeKey = id => 'mode:' + id;
const posKey = (id, m) => `pos:${id}:${m}`;

export async function mountListen(root) {
  el = root;
  el.innerHTML = `
    <div class="player-head">
      <select id="pl-doc"></select>
      <button class="btn sm" id="pl-mode" title="Narration mode">🎞 Flow</button>
      <button class="btn sm" id="pl-allthemes" title="All themes — every subject">☰ All</button>
    </div>
    <div id="tdots"></div>
    <div id="reader"><div class="empty">Loading…</div></div>
    <div id="pbar">
      <div class="prog"><i id="pl-prog"></i></div>
      <div class="ctr">
        <button class="pb-corner" id="pl-themes" title="Themes in this document">☰<b>Themes</b></button>
        <div class="ctr-center">
          <button class="pb wide" id="pl-speed">1×</button>
          <button class="pb" id="pl-prevth" title="Previous theme">⏮</button>
          <button class="pb" id="pl-prev">⬅︎</button>
          <button class="pb play" id="pl-play">▶</button>
          <button class="pb" id="pl-next">➡︎</button>
          <button class="pb" id="pl-nextth" title="Next theme">⏭</button>
          <button class="pb wide" id="pl-voice">🎙</button>
        </div>
      </div>
      <div class="meta"><span class="nowline" id="pl-now"></span><span id="pl-time" title="elapsed / total (estimated)">0:00 / 0:00</span></div>
    </div>`;

  el.querySelector('#pl-doc').onchange = e => openDoc(e.target.value);
  el.querySelector('#pl-mode').onclick = toggleMode;
  el.querySelector('#pl-play').onclick = () => speech.toggle();
  el.querySelector('#pl-next').onclick = () => speech.next();
  el.querySelector('#pl-prev').onclick = () => speech.prev();
  el.querySelector('#pl-nextth').onclick = () => jumpTheme(1);
  el.querySelector('#pl-prevth').onclick = () => jumpTheme(-1);
  el.querySelector('#pl-speed').onclick = showSpeedSheet;
  el.querySelector('#pl-voice').onclick = showVoiceSheet;
  el.querySelector('#pl-themes').onclick = showCurrentThemesSheet;
  el.querySelector('#pl-allthemes').onclick = showAllThemesSheet;

  const reader = el.querySelector('#reader');
  let scrollPause;
  reader.addEventListener('scroll', () => {
    if (Date.now() < (reader._autoUntil || 0)) return;
    autoScroll = false;
    clearTimeout(scrollPause);
    scrollPause = setTimeout(() => { autoScroll = true; }, 4500);
  }, { passive: true });

  wireSpeech();
  await refreshDocList();
}

async function audioDocs() {
  return (await DB.allDocs()).filter(d => !d.uses || d.uses.audio !== false);
}

async function refreshDocList(keepId, force = false) {
  const docs = await audioDocs();
  const sel = el.querySelector('#pl-doc');
  sel.innerHTML = docs.map(d => `<option value="${d.id}">${escapeHtml(d.title)}</option>`).join('');
  if (!docs.length) {
    el.querySelector('#reader').innerHTML = `<div class="empty">No audio documents yet.<br>Add notes in the <b>Library</b> tab.</div>`;
    doc = null;
    return;
  }
  const last = keepId || await DB.getKV('last-doc');
  const target = docs.find(d => d.id === last) ? last : docs[0].id;
  sel.value = target;
  if (force || !doc || doc.id !== target) await openDoc(target);
}

export async function reloadListen() { if (el) await refreshDocList(doc && doc.id, true); }

async function openDoc(id) {
  speech.stop();
  doc = await DB.getDoc(id);
  if (!doc) return;
  await DB.setKV('last-doc', id);
  mode = localStorage.getItem(modeKey(id)) || doc.mode || 'verbatim';
  await applyMode();
}

async function applyMode() {
  lines = mode === 'flow' ? flowLines(doc.lines) : doc.lines;
  structure = parseStructure(lines);
  buildChunks();
  buildWordPrefix();
  renderModeBtn();
  renderReader();
  renderDots();
  const pos = await DB.getKV(posKey(doc.id, mode), 0);
  speech.load(lines, pos);
  markCurrent(speech.idx, true);
  updateMeta();
}

function renderModeBtn() {
  const b = el.querySelector('#pl-mode');
  b.textContent = mode === 'flow' ? '🎞 Flow' : '📜 Verbatim';
  b.classList.toggle('on-flow', mode === 'flow');
}

async function toggleMode() {
  mode = mode === 'flow' ? 'verbatim' : 'flow';
  localStorage.setItem(modeKey(doc.id), mode);
  const wasPlaying = speech.playing;
  speech.stop();
  await applyMode();
  toast(mode === 'flow'
    ? 'Flow mode: Intro → H1/H2/H3 with their points → Way-forward pack → Conclusion'
    : 'Verbatim mode: reading word-for-word in document order');
  if (wasPlaying) speech.play();
}

// ---------- structure → chunks (one per theme, gaps covered) ----------
function buildChunks() {
  chunks = [];
  for (const sec of structure.sections) {
    let cursor = sec.start;
    for (const th of sec.themes) {
      if (th.start > cursor) chunks.push({ start: cursor, end: th.start, theme: null });
      chunks.push({ start: th.start, end: th.end, theme: th.pseudo ? null : th });
      cursor = th.end;
    }
    if (cursor < sec.end) chunks.push({ start: cursor, end: sec.end, theme: null });
  }
}

function chunkOf(idx) {
  for (let c = 0; c < chunks.length; c++) if (idx >= chunks[c].start && idx < chunks[c].end) return c;
  return -1;
}

// ---------- time estimate (words-so-far ÷ effective words-per-minute) ----------
function buildWordPrefix() {
  wordPrefix = [0];
  let sum = 0;
  for (const l of lines) { sum += l.split(/\s+/).filter(Boolean).length; wordPrefix.push(sum); }
}

function computeTimes() {
  const total = wordPrefix[wordPrefix.length - 1] || 0;
  const i = Math.max(0, Math.min(speech.idx, wordPrefix.length - 2));
  const before = wordPrefix[i] || 0;
  const curWords = (wordPrefix[i + 1] || before) - before;
  const soFar = before + curWords * wordFrac;
  const wpm = WPM_BASE * (speech.rate || 1);
  return { elapsed: (soFar / wpm) * 60, total: (total / wpm) * 60 };
}

function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

// ---------- render ----------
function renderReader() {
  const reader = el.querySelector('#reader');
  const secTitles = new Map(structure.sections.map(s => [s.start, s]));
  const parts = [];
  chunks.forEach((ch, ci) => {
    const inner = [];
    for (let i = ch.start; i < ch.end; i++) {
      const sec = secTitles.get(i);
      if (sec && lines[i] === sec.title) {
        inner.push(`<div class="sec-head" data-idx="${i}" id="ln-${i}">${escapeHtml(cleanTitle(sec.title) || sec.title)}</div>`);
        continue;
      }
      if (ch.theme && i === ch.start) {
        const meta = titleMeta(lines[i]);
        inner.push(`<div class="theme-head" data-idx="${i}" id="ln-${i}">${escapeHtml(cleanTitle(lines[i]))}${meta ? `<span class="tmeta">${escapeHtml(meta)}</span>` : ''}</div>`);
        continue;
      }
      inner.push(`<div class="rl k-${classifyLine(lines[i])}" data-idx="${i}" id="ln-${i}">${decorateLine(lines[i])}</div>`);
    }
    parts.push(`<div class="t-chunk" data-c="${ci}">${inner.join('')}</div>`);
  });
  reader.innerHTML = parts.join('');
  reader.onclick = (e) => {
    const t = e.target.closest('[data-idx]');
    if (!t) return;
    speech.seek(+t.dataset.idx);
    speech.play(); // tap-to-jump always continues the narration from there
    markCurrent(+t.dataset.idx, true);
  };
}

function renderDots() {
  const box = el.querySelector('#tdots');
  const themes = chunks.filter(c => c.theme);
  if (themes.length < 2) { box.innerHTML = ''; box.style.display = 'none'; return; }
  box.style.display = '';
  box.innerHTML = themes.map((c, k) =>
    `<span class="tdot" data-start="${c.start}" title="${escapeHtml(cleanTitle(c.theme.title))}"></span>`).join('');
  box.querySelectorAll('.tdot').forEach(d => d.onclick = () => {
    speech.seek(+d.dataset.start);
    speech.play();
    markCurrent(+d.dataset.start, true);
  });
}

// ---------- speech wiring & highlight ----------
function wireSpeech() {
  speech.onLine = (i) => { wordFrac = 0; markCurrent(i, true); updateMeta(); savePos(); };
  speech.onLineDone = (i) => {
    const n = el.querySelector(`#ln-${i}`);
    if (n) n.classList.add('done');
  };
  speech.onWord = (i, s, e2, len) => {
    wordFrac = len ? Math.min(1, s / len) : 0;
    updateMeta();
    const n = el.querySelector(`#ln-${i}`);
    if (!n || !n.classList.contains('rl')) return;
    highlightWordAt(n, s / Math.max(len, 1));
  };
  speech.onState = (playing) => {
    el.querySelector('#pl-play').textContent = playing ? '⏸' : '▶';
  };
  speech.onFinish = () => updateMeta();
}

function highlightWordAt(node, frac) {
  if (!node._plain) node._plain = node.textContent;
  const text = node._plain;
  const pos = Math.min(Math.floor(frac * text.length), text.length - 1);
  let a = text.lastIndexOf(' ', pos) + 1;
  let b = text.indexOf(' ', pos); if (b < 0) b = text.length;
  node.innerHTML = decorateLine(text.slice(0, a))
    + '<span class="spoken">' + escapeHtml(text.slice(a, b)) + '</span>'
    + decorateLine(text.slice(b));
}

function markCurrent(i, scroll) {
  el.querySelectorAll('.rl.cur, .theme-head.cur, .sec-head.cur').forEach(n => {
    n.classList.remove('cur');
    if (n._plain) { n.innerHTML = decorateLine(n._plain); n._plain = null; }
  });
  const n = el.querySelector(`#ln-${i}`);
  if (n) {
    n.classList.add('cur');
    n.classList.remove('done');
    if (scroll && autoScroll) {
      const reader = el.querySelector('#reader');
      reader._autoUntil = Date.now() + 600;
      reader.scrollTo(0, Math.max(0, n.offsetTop - reader.clientHeight / 2 + n.offsetHeight / 2));
    }
  }
  // focus mode: active chunk full strength, done chunks faded, rest dimmed
  const ci = chunkOf(i);
  el.querySelectorAll('.t-chunk').forEach(c => {
    const k = +c.dataset.c;
    c.classList.toggle('active', k === ci);
    c.classList.toggle('done', k < ci);
  });
  // dots
  const themeChunks = chunks.filter(c => c.theme);
  let curStart = null;
  for (const c of themeChunks) { if (c.start <= i) curStart = c.start; else break; }
  el.querySelectorAll('.tdot').forEach(d => {
    d.classList.toggle('current', +d.dataset.start === curStart);
    d.classList.toggle('done', curStart !== null && +d.dataset.start < curStart);
  });
  updateMeta();
}

function updateMeta() {
  if (!doc) return;
  const i = speech.idx;
  el.querySelector('#pl-prog').style.width = (100 * i / Math.max(lines.length - 1, 1)) + '%';
  const { elapsed, total } = computeTimes();
  el.querySelector('#pl-time').textContent = `${fmtTime(elapsed)} / ${fmtTime(total)}`;
  const ci = chunkOf(i);
  const th = ci >= 0 && chunks[ci].theme;
  el.querySelector('#pl-now').textContent = th ? cleanTitle(th.title) : '';
  el.querySelector('#pl-speed').textContent = fmtSpeed(speech.rate);
}

function jumpTheme(dir) {
  const ths = chunks.filter(c => c.theme);
  if (!ths.length) return;
  const cur = ths.findIndex(c => speech.idx >= c.start && speech.idx < c.end);
  const nxt = Math.max(0, Math.min(ths.length - 1, (cur < 0 ? 0 : cur + dir)));
  speech.seek(ths[nxt].start);
  speech.play(); // theme jumps always continue narration seamlessly
  markCurrent(ths[nxt].start, true);
}

function savePos() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (doc) DB.setKV(posKey(doc.id, mode), speech.idx); }, 800);
}

// ---------- sheets ----------
function fmtSpeed(r) { return (r % 1 === 0 ? r.toFixed(0) : String(r)) + '×'; }

function showSpeedSheet() {
  sheet(`<h3>Playback speed</h3>` + SPEEDS.map(s =>
    `<div class="speed-opt ${s === speech.rate ? 'on' : ''}" data-s="${s}"><span>${fmtSpeed(s)}</span>${s === speech.rate ? '<span>✓</span>' : ''}</div>`
  ).join(''), (root) => {
    root.querySelectorAll('.speed-opt').forEach(n => n.onclick = () => {
      speech.setRate(parseFloat(n.dataset.s));
      updateMeta();
      closeSheet();
    });
  });
}

function showVoiceSheet() {
  const vs = speech.voices();
  sheet(`<h3>Voice</h3>` + (vs.length ? vs.map(v =>
    `<div class="speed-opt ${v.voiceURI === speech.voiceURI ? 'on' : ''}" data-v="${escapeHtml(v.voiceURI)}"><span>${escapeHtml(v.name)}</span><span class="tiny muted">${v.lang}</span></div>`
  ).join('') : '<p class="muted">No voices available yet — tap play once, then reopen.</p>'), (root) => {
    root.querySelectorAll('.speed-opt').forEach(n => n.onclick = () => { speech.setVoice(n.dataset.v); closeSheet(); });
  });
}

// themes of ONLY the currently open document (left-corner pbar button)
function showCurrentThemesSheet() {
  if (!doc || !structure) return;
  const ci = chunkOf(speech.idx);
  const curStart = ci >= 0 && chunks[ci].theme ? chunks[ci].start : -1;
  const parts = [];
  let n = 0;
  for (const s of structure.sections) {
    const real = s.themes.filter(t => !t.pseudo);
    if (!real.length) continue;
    parts.push(`<div class="drawer-sec">${escapeHtml(cleanTitle(s.title) || s.title)}</div>`);
    for (const t of real) {
      n++;
      const isCur = t.start === curStart;
      parts.push(`<div class="drawer-item ${isCur ? 'cur' : ''}" data-i="${t.start}"><span class="n">${n}</span><span>${isCur ? '▶ ' : ''}${escapeHtml(cleanTitle(t.title))}</span></div>`);
    }
  }
  sheet(`<h3>📖 ${escapeHtml(doc.title)}</h3>` + (parts.join('') || '<div class="empty">No themes detected in this document.</div>'), (root) => {
    const cur = root.querySelector('.drawer-item.cur');
    if (cur) cur.scrollIntoView({ block: 'center' });
    root.querySelectorAll('.drawer-item').forEach(nEl => nEl.onclick = () => {
      const i = +nEl.dataset.i;
      closeSheet();
      speech.seek(i);
      speech.play();
      markCurrent(i, true);
    });
  });
}

// themes across EVERY document (top player-head button)
async function showAllThemesSheet() {
  const docs = await audioDocs();
  const parts = [];
  for (const d of docs) {
    // index against the lines this doc will actually open with (its saved mode)
    let st;
    if (doc && d.id === doc.id) {
      st = structure;
    } else {
      const m = localStorage.getItem(modeKey(d.id)) || d.mode || 'verbatim';
      st = parseStructure(m === 'flow' ? flowLines(d.lines) : d.lines);
    }
    const isCurrent = doc && d.id === doc.id;
    parts.push(`<div class="drawer-doc ${isCurrent ? 'cur' : ''}">${isCurrent ? '▶ ' : ''}${escapeHtml(d.title)}</div>`);
    let n = 0;
    for (const s of st.sections) {
      const real = s.themes.filter(t => !t.pseudo);
      if (!real.length) continue;
      parts.push(`<div class="drawer-sec">${escapeHtml(cleanTitle(s.title) || s.title)}</div>`);
      for (const t of real) {
        n++;
        parts.push(`<div class="drawer-item" data-doc="${d.id}" data-i="${t.start}"><span class="n">${n}</span><span>${escapeHtml(cleanTitle(t.title))}</span></div>`);
      }
    }
  }
  sheet(`<h3>Jump to theme</h3>` + parts.join(''), (root) => {
    const cur = root.querySelector('.drawer-doc.cur');
    if (cur) cur.scrollIntoView({ block: 'start' });
    root.querySelectorAll('.drawer-item').forEach(nEl => nEl.onclick = async () => {
      const targetDoc = nEl.dataset.doc;
      const i = +nEl.dataset.i;
      closeSheet();
      if (!doc || doc.id !== targetDoc) {
        el.querySelector('#pl-doc').value = targetDoc;
        await openDoc(targetDoc);
      }
      speech.seek(i);
      speech.play();
      markCurrent(i, true);
    });
  });
}
