// App shell: tabs, first-run seed import, service worker
import { DB } from './db.js';
import { mountListen, reloadListen } from './player.js';
import { mountCards, reloadCards } from './cards.js';
import { mountQuiz, reloadQuiz } from './quiz.js';
import { mountPractice, reloadPractice } from './practice.js';
import { mountLibrary, setLibraryChangeHandler } from './library.js';
import { speech } from './tts.js';

const mounts = {
  listen: { fn: mountListen, done: false },
  cards: { fn: mountCards, done: false },
  quiz: { fn: mountQuiz, done: false },
  practice: { fn: mountPractice, done: false },
  library: { fn: mountLibrary, done: false },
};

async function showView(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  const m = mounts[name];
  if (!m.done) { m.done = true; await m.fn(document.getElementById('view-' + name)); }
  if (name !== 'listen' && speech.playing) {
    // keep audio running in background — that's a feature (listen while scrolling cards)
  }
}

document.querySelectorAll('.tab').forEach(t => t.onclick = () => showView(t.dataset.view));

// #views is overflow:hidden but can still be scrolled programmatically (e.g. by
// focus/scrollIntoView on inner elements) — pin it so the layout never drifts
const viewsEl = document.getElementById('views');
viewsEl.addEventListener('scroll', () => { viewsEl.scrollTop = 0; viewsEl.scrollLeft = 0; });

setLibraryChangeHandler(async () => {
  if (mounts.listen.done) await reloadListen();
  if (mounts.cards.done) await reloadCards();
  if (mounts.quiz.done) await reloadQuiz();
  if (mounts.practice.done) await reloadPractice();
});

// first run: auto-load bundled starter pack (the user's 8 enriched cheat-sheets)
async function firstRun() {
  const loaded = await DB.getKV('seed-loaded');
  const docs = await DB.allDocs();
  if (!loaded && !docs.length) {
    try {
      const res = await fetch('data/seed.json');
      if (res.ok) {
        const seedDocs = await res.json();
        for (const s of seedDocs) {
          await DB.putDoc({
            id: 'seed-' + s.filename.replace(/\W+/g, ''),
            title: s.title, filename: s.filename, createdAt: Date.now(), lines: s.lines,
          });
        }
        await DB.setKV('seed-loaded', true);
      }
    } catch { /* offline first run without cache — Library still offers the button */ }
  }
}

(async () => {
  await firstRun();
  await showView('listen');
})();

// keyboard controls: space = play/pause, ←/→ = previous/next line
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (/(INPUT|TEXTAREA|SELECT)/.test(t.tagName) || t.isContentEditable)) return;
  if (e.code === 'Space') { e.preventDefault(); speech.toggle(); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); speech.next(); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); speech.prev(); }
});

// stop speech when app is closed / hidden for long (keep playing on tab switch within app)
window.addEventListener('pagehide', () => speech.stop());

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
