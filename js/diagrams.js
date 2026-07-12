// Flow Diagrams — detect content in notes that works better as a hand-drawable
// visual (UPSC Mains style) and render it: arrow flow-chains, side-by-side
// comparison tables, and keyword maps. Everything is simple boxes/arrows/tables
// you can replicate by hand in the exam.
import { parseStructure, classifyLine, cleanTitle } from './parser.js';
import { escapeHtml } from './ui.js';

const wc = s => s.split(/\s+/).filter(Boolean).length;
const trim = (s, n = 64) => s.length > n ? s.slice(0, n - 1) + '…' : s;
const stripB = s => s.replace(/^[▪•‣]\s*/, '').trim();

// ---------- detectors ----------

// a line with 2+ arrows is a process chain: A → B → C
function flowChain(line) {
  const steps = stripB(line).split(/\s*(?:→|⇒|->)\s*/).map(s => s.trim()).filter(Boolean);
  if (steps.length < 3 || steps.length > 9) return null;
  if (steps.some(s => wc(s) > 12)) return null;
  return steps;
}

// theme with 2-3 heads whose bullets came from a side-by-side table
function comparison(headBlocks) {
  if (headBlocks.length < 2 || headBlocks.length > 3) return null;
  if (headBlocks.some(b => b.content.length < 2)) return null;
  return headBlocks;
}

// a head followed by 4+ "keyword: mechanism" bullets → keyword map
function keywordMap(block) {
  if (block.content.length < 4) return null;
  const items = block.content.map(l => {
    const m = stripB(l).match(/^([^:]{2,45}):\s*(.+)$/);
    return m ? { k: m[1].trim(), v: trim(m[2], 80) } : null;
  }).filter(Boolean);
  return items.length >= 4 ? items : null;
}

// ---------- per-document build ----------
export function buildDiagramsForDoc(doc) {
  const { sections } = parseStructure(doc.lines);
  const out = [];
  for (const sec of sections) {
    for (const th of sec.themes) {
      if (th.pseudo) continue;
      const themeTitle = cleanTitle(th.title);
      const diagrams = [];

      // group content under heads (round-robin de-interleave for adjacent heads,
      // same trick as Flow mode — reconstructs the original table columns)
      const blocks = [];
      let cur = null;
      const loose = [];
      for (let i = th.start + 1; i < th.end; i++) {
        const l = doc.lines[i];
        const kind = classifyLine(l);
        if (kind === 'h1' || kind === 'h2' || kind === 'h3') { cur = { head: l.replace(/^H\d\s*[—\-–:]*\s*/, '').replace(/:$/, ''), content: [] }; blocks.push(cur); }
        else if (kind === 'bullet' || kind === 'plain') { (cur ? cur.content : loose).push(l); }
        // arrows anywhere become flow chains
        const chain = flowChain(l);
        if (chain && kind !== 'h1' && kind !== 'h2') diagrams.push({ type: 'flow', steps: chain });
      }
      if (blocks.length > 1 && blocks.slice(0, -1).every(b => !b.content.length)
          && blocks[blocks.length - 1].content.length >= blocks.length) {
        const items = blocks[blocks.length - 1].content;
        blocks.forEach(b => { b.content = []; });
        items.forEach((it, k) => blocks[k % blocks.length].content.push(it));
      }

      // tables AND hub-spoke maps coexist — a theme can yield both
      const cmp = comparison(blocks);
      if (cmp) diagrams.push({ type: 'table', cols: cmp });
      for (const b of blocks) {
        const km = keywordMap(b);
        if (km) diagrams.push({ type: 'map', head: b.head, items: km });
      }

      if (diagrams.length) out.push({ theme: themeTitle, section: cleanTitle(sec.title) || sec.title, diagrams });
    }
  }
  return out;
}

// ---------- renderers ----------
export function renderDiagram(d) {
  if (d.type === 'flow') {
    return `<div class="dg dg-flow">${d.steps.map(s => `<span class="dg-box">${escapeHtml(trim(s, 42))}</span>`).join('<span class="dg-arrow">→</span>')}</div>`;
  }
  if (d.type === 'table') {
    const rows = Math.max(...d.cols.map(c => c.content.length));
    let body = '';
    for (let r = 0; r < rows; r++) {
      body += `<tr>${d.cols.map(c => `<td>${c.content[r] ? escapeHtml(trim(stripB(c.content[r]), 110)) : ''}</td>`).join('')}</tr>`;
    }
    return `<table class="dg dg-table"><thead><tr>${d.cols.map(c => `<th>${escapeHtml(trim(c.head, 60))}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
  }
  if (d.type === 'map') {
    return `<div class="dg dg-map"><div class="dg-hub">${escapeHtml(trim(d.head, 42))}</div><div class="dg-spokes">${
      d.items.map(it => `<div class="dg-spoke"><b>${escapeHtml(it.k)}</b><span>${escapeHtml(it.v)}</span></div>`).join('')}</div></div>`;
  }
  return '';
}
