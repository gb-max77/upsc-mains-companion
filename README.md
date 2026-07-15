# 🎯 UPSC Mains Companion

A personal revision app for **UPSC CSE Mains 2026** — audiobook narration, doomscroll flashcards, active-recall quizzes and answer-writing drills, generated from your own notes and cross-linked into a self-building knowledge base. Installable on phone & laptop, works offline, zero server cost.

**Live:** https://gb-max77.github.io/upsc-mains-companion/ — open on your phone, then **Share ▸ Add to Home Screen** to install it. Works offline after the first load.

Your 8 enriched cheat-sheets (GS1 Geography/History/Society, GS2 Polity/IR/GovSJ, PubAd 1/2) ship pre-bundled and load automatically on first open.

## Features

### 🎧 Listen (audiobook + read-along)
- Text-to-speech using your device's voices (free, offline; pick the voice with 🎙 — *en-IN Siri/Google voices sound best*)
- **📜 Verbatim** (word-for-word) or **🎞 Flow** mode per document — Flow reorders each theme into Intro → H1/H2/H3 with their points → Way-forward pack (way-forward + value-addition + ammo) → Conclusion
- **Read-along**: current sentence highlighted karaoke-style with word-by-word tracking; the rest of the document dims (focus mode) so only the active theme reads at full strength; a progress-dot strip shows your position across the whole document
- Bold gold **☰ Themes** button (bottom-left) jumps within the current document; **☰ All** (top) jumps across every subject — both continue playback seamlessly from the tap
- Speeds: 0.5× / 0.75× / 1× / 1.1× / 1.25× / 1.35× / 1.5× / 1.75× — switching mid-sentence resumes exactly where it left off
- Elapsed / total time estimate, per-document/per-mode resume position
- **Space** = play/pause, **←/→** = previous/next line

### 🃏 Cards (doomscroll revision)
- Notes auto-condensed into 50–85-word flowing-paragraph flashcards
- Full-screen vertical reel — swipe up like Reels/Hinge; collapsible **🎛 Options** panel (subject filter, shuffle, recall mode)
- **🫣 Recall mode** — card blurred until tapped
- **✨ AI polish** (optional): Anthropic API key in Settings rewrites cards into flowing memorisation passages
- **📊 Diagrams** sub-tab: notes are scanned for arrow chains, H1/H2 comparisons and keyword clusters, rendered as hand-repeatable flowcharts / tables / hub-and-spoke maps, organised by subject → theme

### 🧠 Quiz (active recall)
- Questions are 30+ word passages with 3–6 typed blanks — keywords, cases, theories/committees/acts, examples, quotes, Articles, amendments, data, years, acronyms — mixed, not just numbers
- Prev/Next navigation to revisit any question in the round; 🔗 cross-document hints show where the same fact appears in another subject

### ✍️ Answer (Mains writing drill)
- **🎯 Predicted questions** (mined from numbered question banks in your notes) or **📚 Themes**; independent time (7.5 / 9.5 min) and word-limit (150–300) chips
- ⏸ Pause / ⏹ Stop / restart the timer; it keeps running through Reveal so you can self-check against the clock
- **Reveal structure** (Intro → H1/H2 → Way-forward → Conclusion from your notes) or **📄 Full model answer**, sized to your word limit, from three sources: **📚 Notes only** (composed from the theme + Knowledge Bank + cross-document facts), **✨ Just Gemini**, or **🔗 Gemini + Notes** — all tuned with paper-specific tactics (GS1–4, PubAd, Essay)

### 🧠 Knowledge Engine
Every **Full Notes** upload is parsed for cases, Articles, committees/acts, theories, quotes and acronyms, then cross-linked against every other Full Notes document — so a fact from one subject can surface while quizzing or answering in another. Rebuilds automatically on upload/edit/delete; Library shows live stats (docs · themes · facts · cross-links).

### 📚 Library
- **Notes** tab splits into side-by-side **📖 Full Notes** (→ cards/quiz/answers/diagrams) and **🎙 Audio Files** (→ Flow audiobook) sub-tabs, each with its own drop zone; folders organise by GS1/GS2/GS3/GS4/PubAd/Essay
- **🧠 Knowledge Bank** tab: separate space for model answers, toppers' copies and value-addition material — mined by the Answer drill, never appears in Listen/Cards/Quiz
- **✏️ Edit** any document — audio, cards and quizzes update instantly — plus **📄 View original file**, which re-renders the actual uploaded file (styled via mammoth for .docx, or a download link) independent of any edits you've made
- Per-document **⚙︎ Options**: folder, narration mode, and which features it feeds
- **⚙️ Settings**: comfort themes (🌙 Midnight / 🕯 Warm / 📖 Sepia), reader text size, 20-20-20 break reminder, Gemini + Anthropic API keys
- Everything stored in your browser (IndexedDB); no accounts, no server

## Run locally

```bash
cd upsc-mains-companion
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy your own copy

The app is 100% static — any static host works. Netlify Drop, Vercel, or GitHub Pages (what the live instance above uses) all take a couple of minutes. Push to `main` on the GitHub Pages repo to redeploy.

> TTS voices differ per device. On iPhone, download higher-quality voices under Settings ▸ Accessibility ▸ Spoken Content ▸ Voices.

## Privacy
Documents never leave your device. The only network calls the app makes are optional: AI card polish (Anthropic API) and Gemini model-answer generation — both go straight from your browser to the provider using your own API key, stored only in local browser storage.
