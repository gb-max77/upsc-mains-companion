// Library — folders, Notes/Model tabs, uploads with per-doc generation options,
// in-app editing (audio adapts), settings, starter pack.
import { DB, uid } from './db.js';
import { extractLines } from './extract.js';
import { parseStructure } from './parser.js';
import { sheet, closeSheet, toast, escapeHtml } from './ui.js';
import { setApiKey, getApiKey, setGeminiKey, getGeminiKey, setOpenAIKey, getOpenAIKey } from './ai.js';
import { FOLDER_ORDER, suggestFolder, folderOf, categoryOf } from './taxonomy.js';
import { rebuildKnowledgeIndex, ensureIndexLoaded, getStats } from './analysis.js';

export { suggestFolder, categoryOf }; // re-exported — practice.js/others import these from here

let el, onChange = () => {}, tab = 'notes', notesSub = 'full';
const collapsed = new Set(JSON.parse(localStorage.getItem('lib-collapsed') || '[]'));

export function setLibraryChangeHandler(fn) { onChange = fn; }

export async function mountLibrary(root) {
  el = root;
  const idx = await ensureIndexLoaded();
  // first run / pre-existing docs uploaded before the Knowledge Engine existed
  const docs = await DB.allDocs();
  const hasFullNotes = docs.some(d => categoryOf(d) === 'full');
  if (hasFullNotes && !idx.stats.builtAt) await rebuildKnowledgeIndex();
  await render();
}

function groupByFolder(items) {
  const folders = new Map();
  for (const d of items) {
    const f = folderOf(d);
    if (!folders.has(f)) folders.set(f, []);
    folders.get(f).push(d);
  }
  const names = [...folders.keys()].sort((a, b) => {
    const ia = FOLDER_ORDER.indexOf(a), ib = FOLDER_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return names.map(f => ({ name: f, items: folders.get(f) }));
}

async function render() {
  const docs = await DB.allDocs();
  const models = await DB.allModelDocs();
  const isNotes = tab === 'notes';
  const fullNotes = docs.filter(d => categoryOf(d) === 'full');
  const audioFiles = docs.filter(d => categoryOf(d) === 'audio');

  el.innerHTML = `
    <div class="pad" style="display:flex;flex-direction:column;gap:12px">
      <div class="row">
        <h2 class="vt">📚 Library</h2>
        <div class="spacer"></div>
        <button class="btn sm" id="lb-settings">⚙️ Settings</button>
      </div>
      <div class="seg">
        <button class="seg-btn ${isNotes ? 'on' : ''}" data-tab="notes">📓 Notes (${docs.length})</button>
        <button class="seg-btn ${!isNotes ? 'on' : ''}" data-tab="model">🧠 Knowledge Bank (${models.length})</button>
      </div>

      ${isNotes ? `
        ${docs.length === 0 ? `<button class="btn blue" id="lb-seed">⚡ Load my 8 UPSC 2026 cheat-sheets (starter pack)</button>` : ''}
        <div class="seg" id="notes-sub-seg">
          <button class="seg-btn ${notesSub === 'full' ? 'on' : ''}" data-sub="full">📖 Full Notes (${fullNotes.length})</button>
          <button class="seg-btn ${notesSub === 'audio' ? 'on' : ''}" data-sub="audio">🎙 Audio Files (${audioFiles.length})</button>
        </div>
        ${notesSub === 'full' ? `
          <div id="drop-full" class="drop-zone" data-kind="notes" data-cat="full">➕ <b>Add Full Notes</b> — drop or tap to upload .docx / .pdf / .txt<br>
            <span class="tiny">Becomes cards · quiz · answers · diagrams</span></div>
          ${knowledgeEngineStrip()}
          ${groupByFolder(fullNotes).map(g => folderBlock(g.name, g.items)).join('') || '<div class="empty tiny" style="padding:10px">None yet.</div>'}
        ` : `
          <div id="drop-audio" class="drop-zone" data-kind="notes" data-cat="audio">➕ <b>Add Audio Files</b> — drop or tap to upload .docx / .pdf / .txt<br>
            <span class="tiny">Becomes a Flow-mode audiobook</span></div>
          ${groupByFolder(audioFiles).map(g => folderBlock(g.name, g.items)).join('') || '<div class="empty tiny" style="padding:10px">None yet.</div>'}
        `}
      ` : `
        <p class="muted tiny">Your answer-writing brain: model answers, toppers' copies, value-addition material, current-affairs compilations. The ✍️ Answer drill mines these files for matching model answers and value-addition points; they never appear in Listen, Cards or Quiz.</p>
        <div id="drop-model" class="drop-zone" data-kind="model">➕ <b>Add to Knowledge Bank</b> — .docx / .pdf / .txt</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${models.map(d => docRow(d)).join('') || '<div class="empty tiny" style="padding:14px">No model-answer documents yet.</div>'}
        </div>
      `}
      <input type="file" id="lb-file" accept=".docx,.pdf,.txt,.md" multiple hidden>
    </div>`;

  el.querySelectorAll('.seg:not(#notes-sub-seg) > .seg-btn').forEach(b => b.onclick = async () => { tab = b.dataset.tab; await render(); });
  el.querySelectorAll('#notes-sub-seg .seg-btn').forEach(b => b.onclick = async () => { notesSub = b.dataset.sub; await render(); });

  const fileInput = el.querySelector('#lb-file');
  let activeDropKind = 'notes', activeDropCat = 'full';
  el.querySelectorAll('.drop-zone').forEach(drop => {
    drop.onclick = () => { activeDropKind = drop.dataset.kind; activeDropCat = drop.dataset.cat || 'full'; fileInput.click(); };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('hot'); };
    drop.ondragleave = () => drop.classList.remove('hot');
    drop.ondrop = e => {
      e.preventDefault(); drop.classList.remove('hot');
      intake(e.dataTransfer.files, drop.dataset.kind, drop.dataset.cat || 'full');
    };
  });
  fileInput.onchange = () => intake(fileInput.files, activeDropKind, activeDropCat);

  const seedBtn = el.querySelector('#lb-seed');
  if (seedBtn) seedBtn.onclick = loadSeed;
  el.querySelector('#lb-settings').onclick = showSettings;

  el.querySelectorAll('[data-folder-toggle]').forEach(h => h.onclick = () => {
    const f = h.dataset.folderToggle;
    collapsed.has(f) ? collapsed.delete(f) : collapsed.add(f);
    localStorage.setItem('lib-collapsed', JSON.stringify([...collapsed]));
    render();
  });
  el.querySelectorAll('[data-act]').forEach(b => b.onclick = (e) => { e.stopPropagation(); action(b.dataset.act, b.dataset.id); });
  const reanalyze = el.querySelector('#kb-reanalyze');
  if (reanalyze) reanalyze.onclick = async () => {
    toast('🧠 Re-analyzing your notes…');
    const stats = await rebuildKnowledgeIndex();
    toast(`Analyzed ${stats.docs} documents · ${stats.crossLinks} cross-linked facts ✓`);
    await render();
  };
}

// visible proof the engine actually studied your uploads — updates whenever
// a Full Notes document is added, edited or removed
function knowledgeEngineStrip() {
  const s = getStats();
  if (!s.docs) return '';
  return `
    <div class="kb-strip">
      <span>🧠 <b>Knowledge engine</b> — ${s.docs} docs · ${s.themes} themes · ${s.entities} facts extracted · <b>${s.crossLinks}</b> cross-linked across documents</span>
      <button class="btn sm ghost" id="kb-reanalyze">🔄</button>
    </div>`;
}

function folderBlock(name, items) {
  const closed = collapsed.has(name);
  return `
    <div class="folder">
      <div class="folder-head" data-folder-toggle="${escapeHtml(name)}">
        <span>${closed ? '▸' : '▾'} 📁 ${escapeHtml(name)}</span><span class="tiny muted">${items.length}</span>
      </div>
      ${closed ? '' : `<div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">${items.map(d => docRow(d)).join('')}</div>`}
    </div>`;
}

function usesBadges(d) {
  const u = d.uses || {};
  const on = k => u[k] !== false;
  const parts = [];
  if (d.kind !== 'model') {
    if (on('audio')) parts.push('🎧');
    if (on('cards')) parts.push('🃏');
    if (on('quiz')) parts.push('🧠');
    if (on('answer')) parts.push('✍️');
    if (on('diagrams')) parts.push('📊');
  }
  return parts.join(' ');
}

function docRow(d) {
  const words = d.lines.join(' ').split(/\s+/).length;
  const themes = parseStructure(d.lines).sections.reduce((n, s) => n + s.themes.filter(t => !t.pseudo).length, 0);
  return `
    <div class="card-ui doc-item">
      <div>
        <div class="doc-title">${escapeHtml(d.title)} <span class="tiny">${usesBadges(d)}</span></div>
        <div class="doc-meta">${d.lines.length} lines · ~${(words / 1000).toFixed(1)}k words · ${themes || '—'} themes${d.kind === 'model' ? ' · model answers' : ''}</div>
      </div>
      <div class="row">
        <button class="btn sm" data-act="edit" data-id="${d.id}">✏️ Edit</button>
        <button class="btn sm" data-act="opts" data-id="${d.id}">⚙︎ Options</button>
        <div class="spacer"></div>
        <button class="btn sm danger" data-act="del" data-id="${d.id}">Delete</button>
      </div>
    </div>`;
}

function folderDatalist() {
  return `<datalist id="up-folders">${FOLDER_ORDER.map(f => `<option>${f}</option>`).join('')}</datalist>`;
}

// ---------- upload intake with options ----------
// category is pre-decided by which drop zone received the file — no more
// "what is this file?" question, just folder + mode + uses (still editable)
async function intake(files, kind, category = 'full') {
  const list = [...files];
  if (!list.length) return;
  let addedFull = false;
  for (const f of list) {
    try {
      toast(`Reading ${f.name}…`);
      const lines = await extractLines(f);
      if (!lines.length) throw new Error('No text found in file');
      const title = f.name.replace(/\.(docx|pdf|txt|md)$/i, '').replace(/[_-]+/g, ' ');
      if (kind === 'model') {
        await DB.putDoc({ id: uid(), kind: 'model', title, filename: f.name, createdAt: Date.now(), lines, fileBlob: f });
        toast(`Added "${title}" to Knowledge Bank ✓`);
      } else {
        await showUploadOptions({ title, filename: f.name, lines, category, fileBlob: f });
        if (category === 'full') addedFull = true;
      }
    } catch (e) {
      toast(`${f.name}: ${e.message}`, 4000);
    }
  }
  if (addedFull) {
    const stats = await rebuildKnowledgeIndex();
    toast(`🧠 Studied ${stats.docs} documents · ${stats.crossLinks} cross-linked facts ✓`, 3500);
  }
  await render();
  onChange();
}

function showUploadOptions(pending) {
  return new Promise((resolve) => {
    const sug = suggestFolder(pending.title);
    const cat = pending.category;
    const USE_DEFS = [['audio', '🎧 Audio'], ['cards', '🃏 Cards'], ['quiz', '🧠 Quiz'], ['answer', '✍️ Answer writing'], ['diagrams', '📊 Diagrams']];
    const preset = cat === 'audio'
      ? { audio: true, cards: false, quiz: false, answer: false, diagrams: false }
      : { audio: false, cards: true, quiz: true, answer: true, diagrams: true };
    sheet(`
      <h3>${cat === 'audio' ? '🎙' : '📖'} ${escapeHtml(pending.title)}</h3>
      <p class="muted tiny" style="margin-bottom:12px">${cat === 'audio' ? 'Adding to Audio Files — narrated as a Flow audiobook.' : 'Adding to Full Notes — generates cards, quiz, answers & diagrams.'}</p>
      <label class="tiny muted">Folder</label>
      <input id="up-folder" value="${escapeHtml(sug)}" style="width:100%;margin:6px 0 12px" list="up-folders">
      ${folderDatalist()}
      <label class="tiny muted">Narration mode (Listen tab)</label>
      <div class="chiprow" style="margin:6px 0 12px">
        <button class="chip ${cat === 'audio' ? '' : 'on'}" data-mode="verbatim">📜 Verbatim</button>
        <button class="chip ${cat === 'audio' ? 'on' : ''}" data-mode="flow">🎞 Flow — Intro → H1/H2/H3 → Way-fwd → Conclusion</button>
      </div>
      <label class="tiny muted">Generate from this document</label>
      <div class="chiprow" id="up-uses" style="margin:6px 0 16px;flex-wrap:wrap">
        ${USE_DEFS.map(([k, label]) => `<button class="chip ${preset[k] ? 'on' : ''}" data-use="${k}">${label}</button>`).join('')}
      </div>
      <div class="row"><div class="spacer"></div><button class="btn primary" id="up-save">Add to library</button></div>
    `, (root) => {
      root.querySelectorAll('[data-use]').forEach(c => c.onclick = () => c.classList.toggle('on'));
      root.querySelectorAll('[data-mode]').forEach(c => c.onclick = () => {
        root.querySelectorAll('[data-mode]').forEach(x => x.classList.remove('on'));
        c.classList.add('on');
      });
      root.querySelector('#up-save').onclick = async () => {
        const uses = {};
        root.querySelectorAll('[data-use]').forEach(c => { uses[c.dataset.use] = c.classList.contains('on'); });
        const modeChip = root.querySelector('[data-mode].on');
        await DB.putDoc({
          id: uid(), kind: 'notes', category: cat,
          title: pending.title, filename: pending.filename, createdAt: Date.now(),
          folder: root.querySelector('#up-folder').value.trim() || 'General',
          mode: modeChip ? modeChip.dataset.mode : 'verbatim',
          uses, lines: pending.lines,
          fileBlob: pending.fileBlob || null, // original upload — kept for "View original"
        });
        closeSheet();
        toast(`Added "${pending.title}" ✓`);
        resolve();
      };
    });
  });
}

// per-doc options editor (folder / mode / uses) for existing docs
function showDocOptions(d) {
  const u = d.uses || {};
  const on = k => u[k] !== false;
  sheet(`
    <h3>⚙︎ ${escapeHtml(d.title)}</h3>
    <label class="tiny muted">Title</label>
    <input id="op-title" value="${escapeHtml(d.title)}" style="width:100%;margin:6px 0 12px">
    ${d.kind === 'model' ? '' : `
    <label class="tiny muted">Type</label>
    <div class="chiprow" style="margin:6px 0 12px">
      <button class="chip ${categoryOf(d) === 'full' ? 'on' : ''}" data-cat="full">📖 Full notes</button>
      <button class="chip ${categoryOf(d) === 'audio' ? 'on' : ''}" data-cat="audio">🎙 Audio file</button>
    </div>
    <label class="tiny muted">Folder</label>
    <input id="op-folder" value="${escapeHtml(folderOf(d))}" style="width:100%;margin:6px 0 12px" list="up-folders">
    ${folderDatalist()}
    <label class="tiny muted">Default narration mode</label>
    <div class="chiprow" style="margin:6px 0 12px">
      <button class="chip ${(d.mode || 'verbatim') === 'verbatim' ? 'on' : ''}" data-mode="verbatim">📜 Verbatim</button>
      <button class="chip ${d.mode === 'flow' ? 'on' : ''}" data-mode="flow">🎞 Flow</button>
    </div>
    <label class="tiny muted">Generates</label>
    <div class="chiprow" style="margin:6px 0 16px;flex-wrap:wrap">
      <button class="chip ${on('audio') ? 'on' : ''}" data-use="audio">🎧 Audio</button>
      <button class="chip ${on('cards') ? 'on' : ''}" data-use="cards">🃏 Cards</button>
      <button class="chip ${on('quiz') ? 'on' : ''}" data-use="quiz">🧠 Quiz</button>
      <button class="chip ${on('answer') ? 'on' : ''}" data-use="answer">✍️ Answer</button>
      <button class="chip ${on('diagrams') ? 'on' : ''}" data-use="diagrams">📊 Diagrams</button>
    </div>`}
    <div class="row"><div class="spacer"></div><button class="btn primary" id="op-save">Save</button></div>
  `, (root) => {
    root.querySelectorAll('[data-mode]').forEach(c => c.onclick = () => {
      root.querySelectorAll('[data-mode]').forEach(x => x.classList.remove('on'));
      c.classList.add('on');
    });
    root.querySelectorAll('[data-use]').forEach(c => c.onclick = () => c.classList.toggle('on'));
    root.querySelectorAll('[data-cat]').forEach(c => c.onclick = () => {
      root.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('on', x === c));
    });
    root.querySelector('#op-save').onclick = async () => {
      d.title = root.querySelector('#op-title').value.trim() || d.title;
      if (d.kind !== 'model') {
        const cc = root.querySelector('[data-cat].on');
        if (cc) d.category = cc.dataset.cat;
        d.folder = root.querySelector('#op-folder').value.trim() || 'General';
        const mc = root.querySelector('[data-mode].on');
        if (mc) d.mode = mc.dataset.mode;
        const uses = {};
        root.querySelectorAll('[data-use]').forEach(c => { uses[c.dataset.use] = c.classList.contains('on'); });
        d.uses = uses;
      }
      await DB.putDoc(d);
      closeSheet();
      toast('Saved ✓');
      if (d.kind !== 'model') await rebuildKnowledgeIndex();
      await render();
      onChange();
    };
  });
}

async function loadSeed() {
  try {
    toast('Loading starter pack…');
    const res = await fetch('data/seed.json');
    const seedDocs = await res.json();
    for (const s of seedDocs) {
      await DB.putDoc({
        id: uid(), title: s.title, filename: s.filename, createdAt: Date.now(),
        folder: suggestFolder(s.title), lines: s.lines,
      });
    }
    await DB.setKV('seed-loaded', true);
    toast(`Loaded ${seedDocs.length} documents — analyzing…`);
    const stats = await rebuildKnowledgeIndex();
    toast(`🧠 Studied ${stats.docs} documents · ${stats.crossLinks} cross-linked facts ✓`, 3500);
    await render();
    onChange();
  } catch (e) {
    toast('Starter pack failed: ' + e.message, 4000);
  }
}

async function action(act, id) {
  const d = await DB.getDoc(id);
  if (!d) return;
  if (act === 'del') {
    if (!confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
    const wasFull = categoryOf(d) === 'full';
    await DB.delDoc(id);
    await DB.setKV('analysis:' + id, null);
    toast('Deleted');
    if (wasFull) await rebuildKnowledgeIndex();
    await render();
    onChange();
  } else if (act === 'opts') {
    showDocOptions(d);
  } else if (act === 'edit') {
    showEditor(d);
  }
}

function showEditor(doc, presetText) {
  const text = presetText != null ? presetText : doc.lines.join('\n');
  sheet(`
    <h3>✏️ Edit — ${escapeHtml(doc.title)}</h3>
    <div class="row" style="margin-bottom:8px">
      <button class="btn sm" id="ed-view-original">📄 View original file</button>
    </div>
    <p class="muted tiny" style="margin-bottom:10px">One line per row. Edits update the audiobook, read-along, cards and quizzes instantly. Theme lines look like <b>T1 · Title</b>; sections like <b>1 · SECTION</b>.</p>
    <textarea class="editor-ta" id="ed-ta" spellcheck="false">${escapeHtml(text)}</textarea>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="ed-cancel">Cancel</button>
      <div class="spacer"></div>
      <button class="btn primary" id="ed-save">Save changes</button>
    </div>`, (root) => {
    root.querySelector('#ed-view-original').onclick = () => showOriginalView(doc, root.querySelector('#ed-ta').value);
    root.querySelector('#ed-cancel').onclick = closeSheet;
    root.querySelector('#ed-save').onclick = async () => {
      const lines = root.querySelector('#ed-ta').value.split('\n').map(s => s.trim()).filter(Boolean);
      if (!lines.length) { toast('Document cannot be empty'); return; }
      doc.lines = lines;
      await DB.putDoc(doc);
      await DB.setKV('aicards:' + doc.id, null);
      closeSheet();
      toast('Saved — audio & cards updated ✓');
      if (categoryOf(doc) === 'full') await rebuildKnowledgeIndex();
      await render();
      onChange();
    };
  });
}

// read-only view of the ORIGINAL uploaded file — re-extracted fresh from the
// stored blob every time, so later edits to doc.lines never affect it
async function showOriginalView(doc, returnText) {
  if (!(doc.fileBlob instanceof Blob)) {
    sheet(`
      <h3>📄 Original file</h3>
      <p class="muted small" style="margin-bottom:12px">This document was added before "View Original" existed, so the original file wasn't kept — showing the extracted text instead.</p>
      <div class="orig-body">${doc.lines.map(l => `<p>${escapeHtml(l)}</p>`).join('')}</div>
      <div class="row" style="margin-top:14px"><button class="btn" id="orig-back">‹ Back to edit</button></div>
    `, (root) => { root.querySelector('#orig-back').onclick = () => showEditor(doc, returnText); });
    return;
  }
  const filename = doc.fileBlob.name || doc.filename || (doc.title + '.txt');
  const isDocx = /\.docx$/i.test(filename);
  const url = URL.createObjectURL(doc.fileBlob);
  sheet(`
    <h3>📄 ${escapeHtml(doc.title)} — Original</h3>
    <div class="row" style="margin-bottom:10px;gap:8px">
      <button class="btn sm" id="orig-back">‹ Back to edit</button>
      <a class="btn sm primary" href="${url}" download="${escapeHtml(filename)}">⬇ Download original</a>
    </div>
    <div class="orig-body" id="orig-body"><p class="muted">Loading full document…</p></div>
  `, async (root) => {
    root.querySelector('#orig-back').onclick = () => showEditor(doc, returnText);
    const box = root.querySelector('#orig-body');
    try {
      if (isDocx && window.mammoth) {
        const buf = await doc.fileBlob.arrayBuffer();
        const { value } = await window.mammoth.convertToHtml({ arrayBuffer: buf });
        box.innerHTML = value || '<p class="muted">No content extracted.</p>';
      } else {
        const freshLines = await extractLines(doc.fileBlob);
        box.innerHTML = freshLines.map(l => `<p>${escapeHtml(l)}</p>`).join('');
      }
    } catch (e) {
      box.innerHTML = `<p class="muted">Couldn't render a preview (${escapeHtml(e.message)}). Use "Download original" above to open it in Word/Adobe.</p>`;
    }
  });
}

function showSettings() {
  sheet(`
    <h3>⚙️ Settings</h3>
    <label class="tiny muted">Display — pick what's easiest on your eyes for long sessions</label>
    <div class="chiprow" id="st-theme" style="margin:6px 0 10px">
      ${['midnight|🌙 Midnight', 'warm|🕯 Warm (night)', 'sepia|📖 Sepia (day)'].map(o => {
        const [v, l] = o.split('|');
        return `<button class="chip ${(localStorage.getItem('ui-theme') || 'midnight') === v ? 'on' : ''}" data-th="${v}">${l}</button>`;
      }).join('')}
    </div>
    <label class="tiny muted">Reader text size</label>
    <div class="chiprow" id="st-size" style="margin:6px 0 10px">
      ${['s|A', 'm|A', 'l|A', 'xl|A'].map((o, i) => {
        const [v] = o.split('|');
        return `<button class="chip ${(localStorage.getItem('ui-rsize') || 'm') === v ? 'on' : ''}" data-sz="${v}" style="font-size:${11 + i * 2.5}px">A</button>`;
      }).join('')}
    </div>
    <div class="chiprow" style="margin:6px 0 16px">
      <button class="chip ${localStorage.getItem('break-reminder') !== 'off' ? 'on' : ''}" id="st-break">👀 20-20-20 break reminder (every 25 min)</button>
    </div>
    <label class="tiny muted">Gemini API key (enables ✨ AI model answers in the Answer drill)</label>
    <input type="password" id="st-gkey" placeholder="AIza…" value="${escapeHtml(getGeminiKey())}" style="width:100%;margin:6px 0 4px">
    <p class="muted tiny" style="margin-bottom:12px">Free: sign in at <b>aistudio.google.com/apikey</b> with your Google account → Create API key → paste here. Stored only in this browser.</p>
    <label class="tiny muted">Anthropic API key (optional — enables ✨ AI card polish)</label>
    <input type="password" id="st-key" placeholder="sk-ant-…" value="${escapeHtml(getApiKey())}" style="width:100%;margin:6px 0 4px">
    <p class="muted tiny" style="margin-bottom:12px">Get one at console.anthropic.com. Stored only in this browser.</p>
    <label class="tiny muted">OpenAI API key (optional — enables AI Polish in Answer Writing ▸ Model answers)</label>
    <input type="password" id="st-okey" placeholder="sk-…" value="${escapeHtml(getOpenAIKey())}" style="width:100%;margin:6px 0 4px">
    <p class="muted tiny" style="margin-bottom:14px">Use only your own key. It is kept for this browser session and cleared when the tab is closed.</p>
    <p class="muted tiny" style="margin-bottom:14px">⌨️ Shortcuts: <b>Space</b> play/pause · <b>←/→</b> previous / next line</p>
    <div class="row">
      <button class="btn danger sm" id="st-reset">Reset all app data</button>
      <div class="spacer"></div>
      <button class="btn primary" id="st-save">Save</button>
    </div>`, (root) => {
    root.querySelectorAll('#st-theme .chip').forEach(c => c.onclick = () => {
      localStorage.setItem('ui-theme', c.dataset.th);
      document.documentElement.dataset.theme = c.dataset.th;
      root.querySelectorAll('#st-theme .chip').forEach(x => x.classList.toggle('on', x === c));
    });
    root.querySelectorAll('#st-size .chip').forEach(c => c.onclick = () => {
      localStorage.setItem('ui-rsize', c.dataset.sz);
      document.documentElement.dataset.rsize = c.dataset.sz;
      root.querySelectorAll('#st-size .chip').forEach(x => x.classList.toggle('on', x === c));
    });
    root.querySelector('#st-break').onclick = () => {
      const off = localStorage.getItem('break-reminder') === 'off';
      localStorage.setItem('break-reminder', off ? 'on' : 'off');
      root.querySelector('#st-break').classList.toggle('on', off);
    };
    root.querySelector('#st-save').onclick = () => {
      setApiKey(root.querySelector('#st-key').value);
      setGeminiKey(root.querySelector('#st-gkey').value);
      setOpenAIKey(root.querySelector('#st-okey').value);
      closeSheet();
      toast('Settings saved');
    };
    root.querySelector('#st-reset').onclick = async () => {
      if (!confirm('Delete ALL documents and progress?')) return;
      indexedDB.deleteDatabase('upsc-companion');
      localStorage.clear();
      location.reload();
    };
  });
}
