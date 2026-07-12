// Library — upload docx/pdf, edit (audio adapts), rename, delete, settings, seed pack
import { DB, uid } from './db.js';
import { extractLines } from './extract.js';
import { parseStructure } from './parser.js';
import { sheet, closeSheet, toast, escapeHtml } from './ui.js';
import { setApiKey, getApiKey } from './ai.js';

let el, onChange = () => {};

export function setLibraryChangeHandler(fn) { onChange = fn; }

export async function mountLibrary(root) {
  el = root;
  await render();
}

async function render() {
  const docs = await DB.allDocs();
  const models = await DB.allModelDocs();
  el.innerHTML = `
    <div class="pad" style="display:flex;flex-direction:column;gap:12px">
      <div class="row">
        <h2 class="vt">📚 Library</h2>
        <div class="spacer"></div>
        <button class="btn sm" id="lb-settings">⚙️ Settings</button>
      </div>
      <div id="drop" data-kind="notes">➕ <b>Add notes</b> — tap to upload .docx / .pdf / .txt<br><span class="tiny">They become audiobooks, flashcards & quizzes instantly</span></div>
      ${docs.length === 0 ? `<button class="btn blue" id="lb-seed">⚡ Load my 8 UPSC 2026 cheat-sheets (starter pack)</button>` : ''}
      <div style="display:flex;flex-direction:column;gap:10px">
        ${docs.map(d => docRow(d)).join('') || '<div class="empty">Library is empty.</div>'}
      </div>

      <div class="row" style="margin-top:14px"><h2 class="vt" style="font-size:17px">📝 Model Answers</h2></div>
      <p class="muted tiny" style="margin-top:-8px">Upload model-answer compilations here. The ✍️ Answer drill searches them for the best-matching answer to your question — and falls back to composing one from your notes.</p>
      <div id="drop-model" data-kind="model">➕ <b>Add model answers</b> — .docx / .pdf / .txt</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${models.map(d => docRow(d)).join('') || '<div class="empty tiny" style="padding:14px">No model-answer documents yet.</div>'}
      </div>
      <input type="file" id="lb-file" accept=".docx,.pdf,.txt,.md" multiple hidden>
    </div>`;

  const fileInput = el.querySelector('#lb-file');
  let uploadKind = 'notes';
  for (const drop of el.querySelectorAll('#drop, #drop-model')) {
    drop.onclick = () => { uploadKind = drop.dataset.kind; fileInput.click(); };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('hot'); };
    drop.ondragleave = () => drop.classList.remove('hot');
    drop.ondrop = e => {
      e.preventDefault(); drop.classList.remove('hot');
      handleFiles(e.dataTransfer.files, drop.dataset.kind);
    };
  }
  fileInput.onchange = () => handleFiles(fileInput.files, uploadKind);

  const seedBtn = el.querySelector('#lb-seed');
  if (seedBtn) seedBtn.onclick = loadSeed;
  el.querySelector('#lb-settings').onclick = showSettings;

  el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => action(b.dataset.act, b.dataset.id));
}

function docRow(d) {
  const words = d.lines.join(' ').split(/\s+/).length;
  const themes = parseStructure(d.lines).sections.reduce((n, s) => n + s.themes.filter(t => !t.pseudo).length, 0);
  return `
    <div class="card-ui doc-item">
      <div>
        <div class="doc-title">${escapeHtml(d.title)}</div>
        <div class="doc-meta">${d.lines.length} lines · ~${(words / 1000).toFixed(1)}k words · ${themes || '—'} themes · ~${Math.round(words / 150)} min listen</div>
      </div>
      <div class="row">
        <button class="btn sm" data-act="edit" data-id="${d.id}">✏️ Edit</button>
        <button class="btn sm" data-act="rename" data-id="${d.id}">Rename</button>
        <div class="spacer"></div>
        <button class="btn sm danger" data-act="del" data-id="${d.id}">Delete</button>
      </div>
    </div>`;
}

async function handleFiles(files, kind = 'notes') {
  for (const f of files) {
    try {
      toast(`Reading ${f.name}…`);
      const lines = await extractLines(f);
      if (!lines.length) throw new Error('No text found in file');
      const doc = {
        id: uid(),
        kind,
        title: f.name.replace(/\.(docx|pdf|txt|md)$/i, '').replace(/[_-]+/g, ' '),
        filename: f.name,
        createdAt: Date.now(),
        lines,
      };
      await DB.putDoc(doc);
      toast(`Added "${doc.title}" ${kind === 'model' ? '(model answers) ' : ''}✓`);
    } catch (e) {
      toast(`${f.name}: ${e.message}`, 4000);
    }
  }
  await render();
  onChange();
}

async function loadSeed() {
  try {
    toast('Loading starter pack…');
    const res = await fetch('data/seed.json');
    const seedDocs = await res.json();
    for (const s of seedDocs) {
      await DB.putDoc({ id: uid(), title: s.title, filename: s.filename, createdAt: Date.now(), lines: s.lines });
    }
    await DB.setKV('seed-loaded', true);
    toast(`Loaded ${seedDocs.length} documents ✓`);
    await render();
    onChange();
  } catch (e) {
    toast('Starter pack failed: ' + e.message, 4000);
  }
}

async function action(act, id) {
  const doc = await DB.getDoc(id);
  if (!doc) return;
  if (act === 'del') {
    if (!confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    await DB.delDoc(id);
    toast('Deleted');
    await render();
    onChange();
  } else if (act === 'rename') {
    const t = prompt('New title', doc.title);
    if (t && t.trim()) { doc.title = t.trim(); await DB.putDoc(doc); await render(); onChange(); }
  } else if (act === 'edit') {
    showEditor(doc);
  }
}

function showEditor(doc) {
  sheet(`
    <h3>✏️ Edit — ${escapeHtml(doc.title)}</h3>
    <p class="muted tiny" style="margin-bottom:10px">One line per row. Edits update the audiobook, read-along, cards and quizzes instantly. Theme lines look like <b>T1 · Title</b>; sections like <b>1 · SECTION</b>.</p>
    <textarea class="editor-ta" id="ed-ta" spellcheck="false">${escapeHtml(doc.lines.join('\n'))}</textarea>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="ed-cancel">Cancel</button>
      <div class="spacer"></div>
      <button class="btn primary" id="ed-save">Save changes</button>
    </div>`, (root) => {
    root.querySelector('#ed-cancel').onclick = closeSheet;
    root.querySelector('#ed-save').onclick = async () => {
      const lines = root.querySelector('#ed-ta').value.split('\n').map(s => s.trim()).filter(Boolean);
      if (!lines.length) { toast('Document cannot be empty'); return; }
      doc.lines = lines;
      await DB.putDoc(doc);
      await DB.setKV('aicards:' + doc.id, null); // stale AI cards
      closeSheet();
      toast('Saved — audio & cards updated ✓');
      await render();
      onChange();
    };
  });
}

function showSettings() {
  sheet(`
    <h3>⚙️ Settings</h3>
    <label class="tiny muted">Anthropic API key (optional — enables ✨ AI card polish)</label>
    <input type="password" id="st-key" placeholder="sk-ant-…" value="${escapeHtml(getApiKey())}" style="width:100%;margin:6px 0 4px">
    <p class="muted tiny" style="margin-bottom:14px">Stored only in this browser. Get one at console.anthropic.com.</p>
    <div class="row">
      <button class="btn danger sm" id="st-reset">Reset all app data</button>
      <div class="spacer"></div>
      <button class="btn primary" id="st-save">Save</button>
    </div>`, (root) => {
    root.querySelector('#st-save').onclick = () => {
      setApiKey(root.querySelector('#st-key').value);
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
