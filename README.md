# 🎯 UPSC Mains Companion

A personal revision app for **UPSC CSE Mains 2026** — audiobook narration, doomscroll flashcards, active-recall quizzes and answer-writing drills, generated from your own notes. Installable on phone & laptop, works offline, zero server cost.

Your 8 enriched cheat-sheets (GS1 Geography/History/Society, GS2 Polity/IR/GovSJ, PubAd 1/2) ship pre-bundled — the app loads them automatically on first open.

## Features

### 🎧 Listen (audiobook + read-along)
- Text-to-speech using your device's voices (free, offline; pick the voice with 🎙 — *en-IN Siri/Google voices sound best*)
- **Read-along mode**: current line highlighted with word-by-word karaoke tracking, auto-scroll, keyword emphasis (years, Articles, %s glow gold)
- Structure-aware: documents are split into **Sections → Themes → Lines**; ☰ Themes lists every theme — tap to start reading from there
- Speeds: 0.5× / 0.75× / 1× / 1.1× / 1.25× / 1.35× / 1.5× / 1.75× — switching mid-sentence resumes exactly where it left off (YouTube-style)
- Resume: the app remembers your position per document, even after closing
- ⏮ ⏭ jump between themes; ⬅︎ ➡︎ move line by line; tap any line to read from it

### 🃏 Cards (doomscroll revision)
- Your notes are auto-condensed into ~50–70-word flashcards (2000+ from the starter pack)
- Full-screen vertical reel — swipe up like Reels/Hinge
- 🔀 Shuffle, per-subject filters, **🫣 Recall mode** (card blurred until you tap — recall first, then check)
- **✨ AI polish** (optional): add an Anthropic API key in Library ▸ Settings and Claude rewrites cards into flowing memorisation passages

### 🧠 Quiz (active recall)
- Key facts (years, Articles, cases, percentages, amendments) are blanked out of your own notes
- Recall aloud → tap to reveal → self-mark; 12 questions per round with a score

### ✍️ Answer (Mains writing drill)
- Any theme becomes a question with a 7 / 8.5 / 11-minute timer
- When time's up, your notes' ready-made Intro → H1/H2 → Way-Forward → Conclusion structure is revealed for self-evaluation

### 📚 Library
- Upload more .docx / .pdf / .txt notes — they instantly become audiobooks, cards and quizzes
- **Edit any document in-app** — the audio, cards and quizzes adapt immediately
- Everything is stored in your browser (IndexedDB); no accounts, no server

## Run locally

```bash
cd upsc-mains-companion
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy free (so your phone can use it anywhere)

The app is 100% static. Any of these takes ~2 minutes:

**Netlify (easiest):** go to https://app.netlify.com/drop and drag the `upsc-mains-companion` folder onto the page. Done — you get an https URL.

**Vercel:** `npx vercel` inside the folder.

**GitHub Pages:** push the folder to a repo → Settings ▸ Pages ▸ deploy from branch.

Then on your phone, open the URL in Safari/Chrome → **Share ▸ Add to Home Screen**. It installs as a full-screen app and works offline after the first load (service worker caches everything, including your 8 documents).

> Note: TTS voices differ per device. On iPhone, download higher-quality voices under Settings ▸ Accessibility ▸ Spoken Content ▸ Voices.

## Privacy
Documents never leave your device. The only network call the app can make is the optional AI card polish, straight from your browser to the Anthropic API using your own key.
