// Feature B — doomscroll flashcard reels (50–70 word cards, vertical snap scroll)
import { DB } from './db.js';
import { parseStructure, classifyLine, cleanTitle } from './parser.js';
import { escapeHtml, toast } from './ui.js';
import { aiAvailable, enhanceDocCards } from './ai.js';

const GRADIENTS = [
  'linear-gradient(160deg,#1c2340,#0e1524)',
  'linear-gradient(160deg,#2c1e3e,#131020)',
  'linear-gradient(160deg,#123328,#0a1a14)',
  'linear-gradient(160deg,#3a2417,#160f0a)',
  'linear-gradient(160deg,#12303e,#0a151c)',
  'linear-gradient(160deg,#331f2b,#150d12)',
];

let el, allCards = [], shownCards = [], filterDoc = 'all', shuffled = true, recall = false;

const wc = s => s.split(/\s+/).filter(Boolean).length;

// Build 50–85-word cards: each card is ONE flowing paragraph of keywords —
// the exact block you'd replicate in the exam. Pieces (intro / bullets under a
// heading / way-forward / conclusion) are packed until the card crosses 50
// words; a short tail merges into the previous card instead of standing alone.
const MIN_W = 50, MAX_W = 85;

export function buildCardsForDoc(doc) {
  const { sections } = parseStructure(doc.lines);
  const cards = [];

  for (const sec of sections) {
    for (const th of sec.themes) {
      const start = th.pseudo ? th.start : th.start + 1;
      let ctx = '';
      const pieces = []; // {label, text}
      for (let i = start; i < th.end; i++) {
        const raw = doc.lines[i];
        const kind = classifyLine(raw);
        if (kind === 'h1' || kind === 'h2') {
          ctx = raw.replace(/^H[12]\s*[—\-–:]*\s*/, '').replace(/:$/, '');
        } else if (kind === 'intro') {
          const flavor = raw.match(/^Intro\s*\(([^)]*)\)/i)?.[1];
          pieces.push({ label: flavor ? 'Intro · ' + flavor : 'Intro hook', text: raw.replace(/^Intro[^:]*:\s*/i, '') });
        } else if (kind === 'way') {
          pieces.push({ label: 'Way forward', text: raw.replace(/^Way\s?-?\s?F(or)?w(ar)?d\s*[:—\-–]*\s*/i, '') });
        } else if (kind === 'concl') {
          pieces.push({ label: 'Conclusion', text: raw.replace(/^Concl(usion)?\s*[:—\-–]*\s*/i, '') });
        } else if (kind === 'ammo') {
          pieces.push({ label: 'Extra ammo', text: raw.replace(/^[＋+]\s?(Ammo\s*[—\-–:]*)?\s*/i, '') });
        } else {
          pieces.push({ label: ctx || 'Key points', text: raw.replace(/^[▪•‣]\s*/, '') });
        }
      }

      // split any over-length piece at sentence boundaries first
      const chunks = [];
      for (const p of pieces) {
        const w = wc(p.text);
        if (!w) continue;
        if (w <= MAX_W) { chunks.push(p); continue; }
        // sentence split; fall back to clause/word windows for unpunctuated lines
        let sentences = p.text.split(/(?<=[.;!?])\s+/);
        sentences = sentences.flatMap(s => {
          if (wc(s) <= MAX_W) return [s];
          const clauses = s.split(/\s+[·—]\s+|,\s+(?=[A-Z])/);
          const out = []; let buf = [], bw = 0;
          for (const c of clauses.flatMap(c => {
            if (wc(c) <= MAX_W) return [c];
            const words = c.split(/\s+/); const parts = [];
            for (let a = 0; a < words.length; a += 60) parts.push(words.slice(a, a + 60).join(' '));
            return parts;
          })) {
            const cw = wc(c);
            if (bw && bw + cw > 70) { out.push(buf.join(', ')); buf = []; bw = 0; }
            buf.push(c); bw += cw;
          }
          if (buf.length) out.push(buf.join(', '));
          return out;
        });
        let buf = [], bw = 0;
        for (const s of sentences) {
          const sw = wc(s);
          if (bw && bw + sw > 70) { chunks.push({ label: p.label, text: buf.join(' ') }); buf = []; bw = 0; }
          buf.push(s); bw += sw;
        }
        if (buf.length) chunks.push({ label: p.label, text: buf.join(' ') });
      }

      // pack chunks into 50–85-word flowing paragraphs
      const packed = [];
      let curLabel = '', curParts = [], curW = 0;
      const flush = () => {
        if (!curParts.length) return;
        packed.push({ label: curLabel, text: curParts.join(' · ') });
        curLabel = ''; curParts = []; curW = 0;
      };
      for (const p of chunks) {
        const w = wc(p.text);
        if (curW && curW + w > MAX_W && curW >= MIN_W) flush();
        if (!curParts.length) curLabel = p.label;
        curParts.push(p.text.replace(/\s*\.$/, ''));
        curW += w;
      }
      flush();
      // merge under-length cards into a neighbour — min 50 words wins over max
      for (let k = packed.length - 1; k > 0; k--) {
        if (wc(packed[k].text) < MIN_W && wc(packed[k - 1].text) + wc(packed[k].text) <= 120) {
          packed[k - 1].text += ' · ' + packed[k].text;
          packed.splice(k, 1);
        }
      }

      for (const c of packed) {
        if (wc(c.text) < 15) continue; // drop fragments (tiny pseudo-themes)
        cards.push({
          doc: doc.title, docId: doc.id,
          section: cleanTitle(sec.title) || sec.title,
          theme: cleanTitle(th.title),
          label: c.label, text: c.text,
        });
      }
    }
  }
  return cards;
}

let subTab = 'cards';

export async function mountCards(root) {
  el = root;
  el.innerHTML = `
    <div class="cards-top">
      <div class="seg" style="margin-bottom:8px">
        <button class="seg-btn on" data-sub="cards">🃏 Cards</button>
        <button class="seg-btn" data-sub="diagrams">📊 Diagrams</button>
      </div>
      <div class="chiprow" id="cd-chips"></div>
    </div>
    <div id="reel"></div>
    <div id="diagrams" style="display:none;flex:1;overflow-y:auto"></div>`;
  el.querySelectorAll('[data-sub]').forEach(b => b.onclick = async () => {
    subTab = b.dataset.sub;
    el.querySelectorAll('[data-sub]').forEach(x => x.classList.toggle('on', x === b));
    el.querySelector('#reel').style.display = subTab === 'cards' ? '' : 'none';
    el.querySelector('#cd-chips').style.display = subTab === 'cards' ? '' : 'none';
    el.querySelector('#diagrams').style.display = subTab === 'diagrams' ? '' : 'none';
    if (subTab === 'diagrams') await renderDiagramsView();
  });
  await rebuild();
}

export async function reloadCards() { if (el) { await rebuild(); if (subTab === 'diagrams') await renderDiagramsView(); } }

async function rebuild() {
  const docs = (await DB.allDocs()).filter(d => !d.uses || d.uses.cards !== false);
  allCards = [];
  for (const d of docs) {
    const ai = await DB.getKV('aicards:' + d.id);
    allCards.push(...(ai && ai.length ? ai : buildCardsForDoc(d)));
  }
  renderChips(docs);
  applyFilter();
}

// ---------- diagrams sub-view ----------
async function renderDiagramsView() {
  const { buildDiagramsForDoc, renderDiagram } = await import('./diagrams.js');
  const box = el.querySelector('#diagrams');
  const docs = (await DB.allDocs()).filter(d => !d.uses || d.uses.diagrams !== false);
  const parts = [];
  for (const d of docs) {
    const groups = buildDiagramsForDoc(d);
    if (!groups.length) continue;
    const n = groups.reduce((a, g) => a + g.diagrams.length, 0);
    parts.push(`<details class="dg-doc"><summary>📊 ${escapeHtml(d.title)} <span class="tiny muted">(${n} diagrams)</span></summary>
      ${groups.map(g => `
        <div class="dg-theme">
          <div class="dg-theme-title">${escapeHtml(g.theme)}</div>
          ${g.diagrams.map(renderDiagram).join('')}
        </div>`).join('')}
    </details>`);
  }
  box.innerHTML = `<div class="pad">
    <p class="muted tiny" style="margin-bottom:10px">Hand-drawable visuals detected in your notes — arrow chains become flowcharts, H1/H2 columns become comparison tables, keyword bullets become maps. Replicate these in the exam for easy presentation marks.</p>
    ${parts.join('') || '<div class="empty">No diagram-able content detected yet. Upload notes with → chains, H1/H2 comparisons or keyword: bullets.</div>'}
  </div>`;
}

function renderChips(docs) {
  const chips = el.querySelector('#cd-chips');
  const docChips = [`<button class="chip ${filterDoc === 'all' ? 'on' : ''}" data-doc="all">All (${allCards.length})</button>`]
    .concat(docs.map(d => {
      const n = allCards.filter(c => c.docId === d.id).length;
      return `<button class="chip ${filterDoc === d.id ? 'on' : ''}" data-doc="${d.id}">${escapeHtml(shortTitle(d.title))} (${n})</button>`;
    }));
  chips.innerHTML =
    `<button class="chip ${shuffled ? 'on' : ''}" id="cd-shuffle">🔀 Shuffle</button>
     <button class="chip ${recall ? 'on' : ''}" id="cd-recall">🫣 Recall mode</button>
     <button class="chip" id="cd-ai">✨ AI polish</button>` + docChips.join('');
  chips.querySelector('#cd-shuffle').onclick = () => { shuffled = !shuffled; applyFilter(); };
  chips.querySelector('#cd-recall').onclick = () => { recall = !recall; renderChips(docsCache); renderReel(); };
  chips.querySelector('#cd-ai').onclick = () => runAiPolish();
  chips.querySelectorAll('[data-doc]').forEach(c => c.onclick = () => { filterDoc = c.dataset.doc; applyFilter(); });
  docsCache = docs;
}
let docsCache = [];

function shortTitle(t) { return t.replace(/·/g, '·').split('·').map(s => s.trim()).slice(-1)[0] || t; }

function applyFilter() {
  shownCards = filterDoc === 'all' ? allCards.slice() : allCards.filter(c => c.docId === filterDoc);
  if (shuffled) {
    for (let i = shownCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shownCards[i], shownCards[j]] = [shownCards[j], shownCards[i]];
    }
  }
  renderChips(docsCache);
  renderReel();
}

function renderReel() {
  const reel = el.querySelector('#reel');
  if (!shownCards.length) {
    reel.innerHTML = `<div class="empty" style="padding-top:30dvh">No cards yet — add documents in the Library tab.</div>`;
    return;
  }
  // render lazily in batches of 40 to keep DOM light
  reel.innerHTML = '';
  let rendered = 0;
  const renderBatch = () => {
    const frag = document.createDocumentFragment();
    const upto = Math.min(rendered + 40, shownCards.length);
    for (let i = rendered; i < upto; i++) frag.appendChild(cardNode(shownCards[i], i));
    reel.appendChild(frag);
    rendered = upto;
  };
  renderBatch();
  reel.onscroll = () => {
    if (rendered < shownCards.length && reel.scrollTop + reel.clientHeight * 3 > reel.scrollHeight) renderBatch();
  };
  reel.scrollTop = 0;
}

function cardNode(c, i) {
  const d = document.createElement('div');
  d.className = 'reel-card';
  d.style.background = GRADIENTS[i % GRADIENTS.length];
  d.innerHTML = `
    <div class="rc-tags"><span class="rc-label">${escapeHtml(c.label)}</span><span class="rc-doc">${escapeHtml(c.doc)}</span></div>
    <div class="rc-theme">${escapeHtml(c.theme)}</div>
    <div class="rc-text ${recall ? 'blur' : ''}">${escapeHtml(c.text)}</div>
    <div class="rc-foot"><span>${escapeHtml(c.section)}</span><span class="rc-count">${i + 1} / ${shownCards.length} · ${wc(c.text)}w</span></div>`;
  if (recall) d.onclick = () => d.querySelector('.rc-text').classList.toggle('blur');
  return d;
}

async function runAiPolish() {
  if (!aiAvailable()) {
    toast('Add your Anthropic API key in Library ▸ Settings to use AI polish');
    return;
  }
  const docs = filterDoc === 'all' ? docsCache : docsCache.filter(d => d.id === filterDoc);
  if (!docs.length) return;
  toast('AI is rewriting cards — this can take a minute…', 4000);
  try {
    for (const d of docs) {
      const cards = await enhanceDocCards(d, buildCardsForDoc(d));
      await DB.setKV('aicards:' + d.id, cards);
    }
    toast('AI cards ready ✨');
    await rebuild();
  } catch (e) {
    toast('AI polish failed: ' + e.message, 4000);
  }
}
