// Text-to-speech engine over Web Speech API.
// Speaks one line per utterance (avoids Chrome's long-utterance cutoff),
// tracks word boundaries for read-along, and supports mid-line speed change
// that resumes exactly where it left off.
//
// A generation counter guards every utterance callback: cancel() fires stale
// onend/onerror events asynchronously, and without the guard a rapid
// play/pause/speed tap sequence could double-advance or wedge the player.

export const SPEEDS = [0.5, 0.75, 1, 1.1, 1.25, 1.35, 1.5, 1.75];

export class Speech {
  constructor() {
    this.rate = parseFloat(localStorage.getItem('tts-rate') || '1');
    this.voiceURI = localStorage.getItem('tts-voice') || '';
    this.playing = false;
    this.lines = [];          // display lines
    this.idx = 0;             // current line index
    this.charAt = 0;          // last boundary charIndex within current utterance
    this._offset = 0;         // spoken-char offset the current utterance started at
    this._gen = 0;            // generation counter — invalidates stale callbacks
    this._u = null;           // keep a reference (Chrome GC bug silences speech otherwise)
    this.onLine = () => {};
    this.onWord = () => {};
    this.onLineDone = () => {};
    this.onState = () => {};
    this.onFinish = () => {};
    if ('speechSynthesis' in window) {
      speechSynthesis.onvoiceschanged = () => {};
      speechSynthesis.getVoices();
    }
  }

  get supported() { return 'speechSynthesis' in window; }

  voices() {
    return speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
  }

  pickVoice() {
    const all = speechSynthesis.getVoices();
    if (this.voiceURI) {
      const v = all.find(v => v.voiceURI === this.voiceURI);
      if (v) return v;
    }
    return all.find(v => v.lang === 'en-IN')
        || all.find(v => v.lang === 'en-GB')
        || all.find(v => v.lang.startsWith('en')) || null;
  }

  setVoice(uri) {
    this.voiceURI = uri;
    localStorage.setItem('tts-voice', uri);
    if (this.playing) this._restartLine(this._offset + this.charAt);
  }

  load(lines, startIdx = 0) {
    this.stop();
    this.lines = lines;
    this.idx = Math.max(0, Math.min(startIdx, lines.length - 1));
    this.charAt = 0; this._offset = 0;
  }

  speechText(line) {
    return line
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\((covers|PYQ)[^)]*\)/gi, ' ')
      .replace(/[★■▪‣]/g, ' ')
      .replace(/＋/g, ' plus: ')
      .replace(/→/g, ', leads to, ')
      .replace(/↔/g, ' versus ')
      .replace(/·/g, '. ')
      .replace(/&/g, ' and ')
      .replace(/\bArts?\.?\s(?=\d)/g, 'Article ')
      .replace(/\bAmdt\b/g, 'Amendment')
      .replace(/\bFRs?\b/g, 'Fundamental Rights')
      .replace(/\bDPSP\b/g, 'Directive Principles')
      .replace(/\bSC\b/g, 'Supreme Court')
      .replace(/\bHC\b/g, 'High Court')
      .replace(/\bvs?\.\s/g, ' versus ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  play() {
    if (!this.supported || !this.lines.length || this.playing) return;
    this.playing = true;
    this.onState(true);
    this._speakCurrent(this._offset);
  }

  pause() {
    this._gen++;
    if (this.supported) speechSynthesis.cancel();
    this.playing = false;
    this.onState(false);
    this._offset = this._offset + this.charAt; // resume point = last spoken word
    this.charAt = 0;
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  stop() {
    this._gen++;
    if (this.supported) speechSynthesis.cancel();
    this.playing = false;
    this.charAt = 0; this._offset = 0;
    this.onState(false);
  }

  seek(idx) {
    const wasPlaying = this.playing;
    this._gen++;
    if (this.supported) speechSynthesis.cancel();
    this.idx = Math.max(0, Math.min(idx, this.lines.length - 1));
    this.charAt = 0; this._offset = 0;
    this.onLine(this.idx);
    if (wasPlaying) this._speakCurrent(0);
  }

  next() { if (this.idx < this.lines.length - 1) this.seek(this.idx + 1); }
  prev() { this.seek(this.idx - 1); }

  setRate(r) {
    this.rate = r;
    localStorage.setItem('tts-rate', String(r));
    if (this.playing) this._restartLine(this._offset + this.charAt);
  }

  // restart the current line from a spoken-char offset (speed / voice change)
  _restartLine(fromChar) {
    const spoken = this.speechText(this.lines[this.idx] || '');
    let at = Math.min(fromChar, spoken.length);
    while (at > 0 && spoken[at - 1] !== ' ') at--; // back to word start
    this._speakCurrent(at);
  }

  _speakCurrent(fromChar) {
    if (this.idx >= this.lines.length) { this._finish(); return; }
    const gen = ++this._gen;
    if (this.supported) speechSynthesis.cancel();

    const fullSpoken = this.speechText(this.lines[this.idx]);
    if (!fullSpoken) { this._advance(gen); return; }
    let start = Math.min(fromChar, fullSpoken.length);
    if (!fullSpoken.slice(start).trim()) start = 0;
    const text = fullSpoken.slice(start);
    this._offset = start;
    this.charAt = 0;

    const u = new SpeechSynthesisUtterance(text);
    this._u = u;
    u.rate = this.rate;
    const v = this.pickVoice();
    if (v) u.voice = v;

    u.onboundary = (e) => {
      if (gen !== this._gen) return;
      if (e.name && e.name !== 'word') return;
      this.charAt = e.charIndex;
      this.onWord(this.idx, this._offset + e.charIndex,
        this._offset + e.charIndex + (e.charLength || 6), fullSpoken.length);
    };
    u.onend = () => {
      if (gen !== this._gen) return;
      this.onLineDone(this.idx);
      this._advance(gen);
    };
    u.onerror = (e) => {
      if (gen !== this._gen) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      this._advance(gen); // skip a line the engine can't speak
    };

    this.onLine(this.idx);
    // small delay after cancel() — Safari/Chrome drop an immediate speak()
    setTimeout(() => {
      if (gen !== this._gen) return;
      speechSynthesis.speak(u);
    }, 60);
  }

  _advance(gen) {
    if (gen !== this._gen) return;
    this.charAt = 0; this._offset = 0;
    if (this.idx < this.lines.length - 1) {
      this.idx++;
      if (this.playing) this._speakCurrent(0);
      else this.onLine(this.idx);
    } else {
      this._finish();
    }
  }

  _finish() {
    this.playing = false;
    this.onState(false);
    this.onFinish();
  }
}

export const speech = new Speech();
