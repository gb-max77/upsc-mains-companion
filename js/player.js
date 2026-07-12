// Listen view: read-along player with theme navigation and speed control
import { DB } from './db.js';
import { parseStructure, classifyLine, cleanTitle, titleMeta, decorateLine } from './parser.js';
import { speech, SPEEDS } from './tts.js';
import { sheet, closeSheet } from './ui.js';

let el, doc = null, structure = null, autoScroll = true, saveTimer = null;

export async function mountListen(root) {
  el = root;
  el.innerHTML = `
    <div class="player-head">
      <select id="pl-doc"></select>
      <button class="btn sm" id="pl-themes">☰ Themes</button>
    </div>
    <div id="reader"><div class="empty">Loading…</div></div>
    <div id="pbar">
      <div class="prog"><i id="pl-prog"></i></div>
      <div class="ctr">
        <button class="pb wide" id="pl-speed">1×</button>
        <button class="pb" id="pl-prevth" title="Previous theme">⏮</button>
        <button class="pb" id="pl-prev">⬅︎</button>
        <button class="pb play" id="pl-play">▶</button>
        <button class="pb" id="pl-next">➡︎</button>
        <button class="pb" id="pl-nextth" title="Next theme">⏭</button>
        <button class="pb wide" id="pl-voice">🎙</button>
      </div>
      <div class="meta"><span class="nowline" id="pl-now"></span><span id="pl-pos"></span></div>
    </div>`;

  el.querySelector('#pl-doc').onchange = e => openDoc(e.target.value);
  el.querySelector('#pl-play').onclick = () => togglePlay();
  el.querySelector('#pl-next').onclick = () => speech.next();
  el.querySelector('#pl-prev').onclick = () => speech.prev();
  el.querySelector('#pl-nextth').onclick = () => jumpTheme(1);
  el.querySelector('#pl-prevth').onclick = () => jumpTheme(-1);
  el.querySelector('#pl-speed').onclick = showSpeedSheet;
  el.querySelector('#pl-voice').onclick = showVoiceSheet;
  el.querySelector('#pl-themes').onclick = showThemesSheet;

  const reader = el.querySelector('#reader');
  let scrollPause;
  reader.addEventListener('scroll', () => {
    // ignore events caused by our own smooth scrollIntoView (they stream for ~1s)
    if (Date.now() < (reader._autoUntil || 0)) return;
    autoScroll = false;
    clearTimeout(scrollPause);
    scrollPause = setTimeout(() => { autoScroll = true; }, 4500);
  }, { passive: true });

  wireSpeech();
  await refreshDocList();
}

async function refreshDocList(keepId, force = false) {
  const docs = await DB.allDocs();
  const sel = el.querySelector('#pl-doc');
  sel.innerHTML = docs.map(d => `<option value="${d.id}">${escapeHtml(d.title)}</option>`).join('');
  if (!docs.length) {
    el.querySelector('#reader').innerHTML = `<div class="empty">No documents yet.<br>Add notes in the <b>Library</b> tab.</div>`;
    doc = null;
    return;
  }
  const last = keepId || await DB.getKV('last-doc');
  const target = docs.find(d => d.id === last) ? last : docs[0].id;
  sel.value = target;
  if (force || !doc || doc.id !== target) await openDoc(target);
}

// force=true so an edited document is re-parsed and the audio adapts
export async function reloadListen() { if (el) await refreshDocList(doc && doc.id, true); }

async function openDoc(id) {
  speech.stop();
  doc = await DB.getDoc(id);
  if (!doc) return;
  await DB.setKV('last-doc', id);
  structure = parseStructure(doc.lines);
  renderReader();
  const pos = await DB.getKV('pos:' + id, 0);
  speech.load(doc.lines, pos);
  markCurrent(speech.idx, false);
  updateMeta();
}

function renderReader() {
  const reader = el.querySelector('#reader');
  const parts = [];
  for (const sec of structure.sections) {
    const real = doc.lines[sec.start] === sec.title; // section title is an actual line
    parts.push(`<div class="sec-head" ${real ? `data-idx="${sec.start}" id="ln-${sec.start}"` : ''}>${escapeHtml(cleanTitle(sec.title) || sec.title)}</div>`);
    const themeStarts = new Map(sec.themes.map(t => [t.start, t]));
    for (let i = real ? sec.start + 1 : sec.start; i < sec.end; i++) {
      const th = themeStarts.get(i);
      if (th && !th.pseudo) {
        const meta = titleMeta(doc.lines[i]);
        parts.push(`<div class="theme-head" data-idx="${i}" id="ln-${i}">${escapeHtml(cleanTitle(doc.lines[i]))}${meta ? `<span class="tmeta">${escapeHtml(meta)}</span>` : ''}</div>`);
        continue;
      }
      const kind = classifyLine(doc.lines[i]);
      parts.push(`<div class="rl k-${kind}" data-idx="${i}" id="ln-${i}">${decorateLine(doc.lines[i])}</div>`);
    }
  }
  reader.innerHTML = parts.join('');
  reader.onclick = (e) => {
    const t = e.target.closest('[data-idx]');
    if (!t) return;
    speech.seek(+t.dataset.idx);
    markCurrent(+t.dataset.idx, true);
  };
}

function wireSpeech() {
  speech.onLine = (i) => { markCurrent(i, true); updateMeta(); savePos(); };
  speech.onLineDone = (i) => {
    const n = el.querySelector(`#ln-${i}`);
    if (n) n.classList.add('done');
  };
  speech.onWord = (i, s, e2, len) => {
    const n = el.querySelector(`#ln-${i}`);
    if (!n || !n.classList.contains('rl')) return;
    // approximate mapping from spoken char position -> displayed text position
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
  // keep memorisation colours while reading: decorate the around-word segments
  node.innerHTML = decorateLine(text.slice(0, a))
    + '<span class="spoken">' + escapeHtml(text.slice(a, b)) + '</span>'
    + decorateLine(text.slice(b));
}

function markCurrent(i, scroll) {
  el.querySelectorAll('.rl.cur, .theme-head.cur').forEach(n => {
    n.classList.remove('cur');
    if (n._plain) { n.innerHTML = decorateLine(n._plain); n._plain = null; }
  });
  const n = el.querySelector(`#ln-${i}`);
  if (!n) return;
  n.classList.add('cur');
  n.classList.remove('done');
  if (scroll && autoScroll) {
    const reader = el.querySelector('#reader');
    reader._autoUntil = Date.now() + 600;
    reader.scrollTo(0, Math.max(0, n.offsetTop - reader.clientHeight / 2 + n.offsetHeight / 2));
  }
  updateMeta();
}

function updateMeta() {
  if (!doc) return;
  const i = speech.idx;
  el.querySelector('#pl-prog').style.width = (100 * i / Math.max(doc.lines.length - 1, 1)) + '%';
  el.querySelector('#pl-pos').textContent = `${i + 1} / ${doc.lines.length}`;
  const th = currentTheme();
  el.querySelector('#pl-now').textContent = th ? cleanTitle(th.title) : '';
  el.querySelector('#pl-speed').textContent = fmtSpeed(speech.rate);
}

function currentTheme() {
  for (const s of structure.sections)
    for (const t of s.themes)
      if (speech.idx >= t.start && speech.idx < t.end) return t;
  return null;
}

function togglePlay() {
  if (!doc) return;
  speech.toggle();
}

function jumpTheme(dir) {
  const ths = structure.sections.flatMap(s => s.themes);
  if (!ths.length) return;
  const cur = ths.findIndex(t => speech.idx >= t.start && speech.idx < t.end);
  const nxt = Math.max(0, Math.min(ths.length - 1, (cur < 0 ? 0 : cur + dir)));
  speech.seek(ths[nxt].start);
  markCurrent(ths[nxt].start, true);
}

function savePos() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (doc) DB.setKV('pos:' + doc.id, speech.idx); }, 800);
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

async function showThemesSheet() {
  const docs = await DB.allDocs();
  const parts = [];
  for (const d of docs) {
    const st = parseStructure(d.lines);
    const isCurrent = doc && d.id === doc.id;
    parts.push(`<div class="drawer-doc ${isCurrent ? 'cur' : ''}">${isCurrent ? '▶ ' : ''}${escapeHtml(d.title)}</div>`);
    let n = 0;
    for (const s of st.sections) {
      if (!s.themes.length) continue;
      parts.push(`<div class="drawer-sec">${escapeHtml(cleanTitle(s.title) || s.title)}</div>`);
      for (const t of s.themes) {
        n++;
        parts.push(`<div class="drawer-item" data-doc="${d.id}" data-i="${t.start}"><span class="n">${n}</span><span>${escapeHtml(cleanTitle(t.title))}</span></div>`);
      }
    }
  }
  sheet(`<h3>Jump to theme</h3>` + parts.join(''), (root) => {
    // open scrolled to the current document's block
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

function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
