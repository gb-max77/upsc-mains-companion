// Knowledge Engine — every "Full Notes" document is fully parsed and its
// facts (cases, Articles, committees/acts, theories, quotes, acronyms) are
// indexed and cross-linked against every OTHER Full Notes document. Uploaded
// notes stop being isolated files: Quiz surfaces "also appears in…" links,
// Cards badge cross-referenced points, and Answer-writing pulls matching
// material from your whole corpus — not just the single theme in view.
import { DB } from './db.js';
import { parseStructure, cleanTitle } from './parser.js';
import { findEntities, normalizeEntity, LINKABLE_TYPES } from './entities.js';
import { categoryOf } from './taxonomy.js';

let indexCache = null; // { crossRefs: {norm: [{docId,docTitle,theme,type,text}]}, stats }

export async function analyzeDoc(doc) {
  const { sections } = parseStructure(doc.lines);
  const entities = [];
  let themeCount = 0;
  for (const sec of sections) {
    for (const th of sec.themes) {
      if (th.pseudo) continue;
      themeCount++;
      const themeTitle = cleanTitle(th.title);
      for (let i = th.start; i < th.end; i++) {
        for (const e of findEntities(doc.lines[i])) {
          if (!LINKABLE_TYPES.has(e.t)) continue;
          entities.push({ type: e.t, text: e.text, norm: normalizeEntity(e.text), theme: themeTitle });
        }
      }
    }
  }
  const wordCount = doc.lines.join(' ').split(/\s+/).filter(Boolean).length;
  return { docId: doc.id, title: doc.title, themeCount, entityCount: entities.length, wordCount, entities };
}

// re-scans every Full Notes document and rebuilds the cross-document index.
// Cheap (client-side regex over already-in-memory text) — safe to call after
// every upload, edit or delete of a Full Notes document.
export async function rebuildKnowledgeIndex() {
  const docs = (await DB.allDocs()).filter(d => categoryOf(d) === 'full');
  const perDoc = [];
  const byNorm = new Map(); // norm -> [{docId, docTitle, theme, type, text}]
  for (const d of docs) {
    const a = await analyzeDoc(d);
    perDoc.push(a);
    await DB.setKV('analysis:' + d.id, a);
    for (const e of a.entities) {
      if (!byNorm.has(e.norm)) byNorm.set(e.norm, []);
      const bucket = byNorm.get(e.norm);
      // dedupe same doc+theme+text (a fact repeated within one theme shouldn't inflate counts)
      if (!bucket.some(x => x.docId === d.id && x.theme === e.theme)) {
        bucket.push({ docId: d.id, docTitle: d.title, theme: e.theme, type: e.type, text: e.text });
      }
    }
  }
  // keep only entities that genuinely cross-link ≥2 distinct documents
  const crossRefs = {};
  let crossLinks = 0;
  for (const [norm, arr] of byNorm) {
    const distinctDocs = new Set(arr.map(x => x.docId));
    if (distinctDocs.size >= 2) { crossRefs[norm] = arr; crossLinks++; }
  }
  const stats = {
    docs: docs.length,
    themes: perDoc.reduce((n, a) => n + a.themeCount, 0),
    entities: perDoc.reduce((n, a) => n + a.entityCount, 0),
    crossLinks,
    builtAt: Date.now(),
  };
  indexCache = { crossRefs, stats };
  await DB.setKV('knowledge-index', indexCache);
  return stats;
}

// call once before first synchronous use (buildPool/rebuild/mount) — cheap,
// just reads the last-built index back out of IndexedDB
export async function ensureIndexLoaded() {
  if (indexCache) return indexCache;
  indexCache = await DB.getKV('knowledge-index', null)
    || { crossRefs: {}, stats: { docs: 0, themes: 0, entities: 0, crossLinks: 0 } };
  return indexCache;
}

export function getStats() {
  return (indexCache && indexCache.stats) || { docs: 0, themes: 0, entities: 0, crossLinks: 0 };
}

// synchronous cross-reference lookup for a passage/theme — call
// ensureIndexLoaded() at least once beforehand (mount-time is enough)
export function crossRefsFor(text, excludeDocId, max = 4) {
  if (!indexCache) return [];
  const found = findEntities(text).filter(e => LINKABLE_TYPES.has(e.t));
  const seen = new Set();
  const out = [];
  for (const e of found) {
    const hits = indexCache.crossRefs[normalizeEntity(e.text)];
    if (!hits) continue;
    for (const h of hits) {
      if (h.docId === excludeDocId) continue;
      const key = h.docId + '|' + h.theme;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(h);
      if (out.length >= max) return out;
    }
  }
  return out;
}
