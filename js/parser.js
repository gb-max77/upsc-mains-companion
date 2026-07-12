// Structure parser: lines[] -> { sections: [{title, start, end, themes:[{title, start, end}]}] }
// Handles the four dialects found in the user's UPSC notes plus generic fallbacks:
//  A) sections "1 · CAPS", themes "T1 · Title"        (Polity, Geography, History, PubAd)
//  B) themes "Theme 1 · Title", ALL-CAPS sections     (IR)
//  C) sections "1 · CAPS", themes "1. Title [covers]" (GovSJ)
//  D) question banks "1. ★ long question?" must NOT become themes (Society)

const RE_THEME_T = /^T\d{1,3}\s*[·.:]\s*\S/;
const RE_THEME_WORD = /^Theme\s+\d{1,3}\s*[·.:\-–]\s*\S/i;
const RE_SEC_DOT = /^\d{1,2}\s*·\s+\S/;
const RE_NUMBERED = /^\d{1,3}\.\s+\S/;

function isAllCaps(line) {
  if (line.length < 6 || line.length > 110) return false;
  if (/[▪•‣]/.test(line)) return false;
  const letters = line.replace(/[^A-Za-z]/g, '');
  if (letters.length < 5) return false;
  const upper = line.replace(/[^A-Z]/g, '');
  return upper.length / letters.length > 0.85;
}

function looksLikeQuestion(line) {
  return /\?/.test(line) || /\b(Discuss|Examine|Elucidate|Comment|Analyse|Analyze|Evaluate|Critically)\b/i.test(line) || line.length > 130;
}

export function parseStructure(lines) {
  const n = lines.length;

  // Decide theme matcher
  let isTheme;
  if (lines.some(l => RE_THEME_T.test(l))) {
    isTheme = l => RE_THEME_T.test(l);
  } else if (lines.some(l => RE_THEME_WORD.test(l))) {
    isTheme = l => RE_THEME_WORD.test(l);
  } else {
    // numbered topics as themes — but only short, non-question lines
    const cand = lines.filter(l => RE_NUMBERED.test(l) && !looksLikeQuestion(l) && l.length < 110);
    isTheme = cand.length >= 4
      ? l => RE_NUMBERED.test(l) && !looksLikeQuestion(l) && l.length < 110
      : () => false;
  }

  // Decide section matcher (must not also be a theme)
  let isSection;
  if (lines.some(l => RE_SEC_DOT.test(l) && !isTheme(l))) {
    isSection = l => RE_SEC_DOT.test(l) && !isTheme(l);
  } else if (lines.some(l => isAllCaps(l) && !isTheme(l))) {
    isSection = l => isAllCaps(l) && !isTheme(l);
  } else {
    isSection = () => false;
  }

  const sections = [];
  let sec = null, th = null;

  const closeTheme = (i) => { if (th) { th.end = i; th = null; } };
  const closeSec = (i) => { closeTheme(i); if (sec) { sec.end = i; sec = null; } };

  for (let i = 0; i < n; i++) {
    const l = lines[i];
    if (isSection(l)) {
      closeSec(i);
      sec = { title: l, start: i, end: n, themes: [] };
      sections.push(sec);
    } else if (isTheme(l)) {
      closeTheme(i);
      if (!sec) { sec = { title: 'Overview', start: 0, end: n, themes: [] }; sections.push(sec); }
      th = { title: l, start: i, end: n };
      sec.themes.push(th);
    }
  }
  closeSec(n);

  // Front matter before first section
  if (sections.length && sections[0].start > 0) {
    sections.unshift({ title: 'Front matter', start: 0, end: sections[0].start, themes: [] });
  }

  // Fallbacks for unstructured docs
  if (!sections.length) {
    sections.push({ title: 'Document', start: 0, end: n, themes: [] });
  }
  for (const s of sections) {
    if (!s.themes.length) {
      // chunk section into pseudo-themes of ~30 lines so navigation & cards still work
      const size = 30;
      const body = s.end - s.start;
      if (body <= size + 10) {
        s.themes.push({ title: s.title, start: s.start, end: s.end, pseudo: true });
      } else {
        for (let a = s.start; a < s.end; a += size) {
          const first = lines[a] || '';
          s.themes.push({
            title: first.slice(0, 70) + (first.length > 70 ? '…' : ''),
            start: a, end: Math.min(a + size, s.end), pseudo: true,
          });
        }
      }
    }
  }
  return { sections };
}

// ---- line classification (styling / cards / speech) ----
export function classifyLine(line) {
  if (/^Intro\b/i.test(line)) return 'intro';
  if (/^H1\b/.test(line)) return 'h1';
  if (/^H2\b/.test(line)) return 'h2';
  if (/^Way\s?-?\s?F(or)?w(ar)?d/i.test(line) || /^Way fwd/i.test(line)) return 'way';
  if (/^Concl/i.test(line)) return 'concl';
  if (/^[＋+]\s?Ammo/i.test(line) || /^＋/.test(line)) return 'ammo';
  if (/^[▪•‣]/.test(line)) return 'bullet';
  return 'plain';
}

export function cleanTitle(t) {
  return t
    .replace(/^T\d{1,3}\s*[·.:]\s*/, '')
    .replace(/^Theme\s+\d+\s*[·.:\-–]\s*/i, '')
    .replace(/^\d{1,3}[.·]\s*/, '')
    .replace(/\((covers|PYQ)[^)]*\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/★[^·]*$/g, '')
    .replace(/·\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// theme metadata badges e.g. [15m], ★ cross-confirmed, (covers Q1)
export function titleMeta(t) {
  const m = [];
  const marks = t.match(/\[(\d+(?:\/\d+)?m)\]/); if (marks) m.push(marks[1] + ' marker');
  if (/★/.test(t)) m.push('★ high-probability');
  const cov = t.match(/\(covers[^)]*\)/i); if (cov) m.push(cov[0].replace(/[()]/g, ''));
  return m.join(' · ');
}

// Highlight memorisation cues in a displayed line (returns HTML).
// Mirrors the notes' scoring spine: KEYWORD lead-in → mechanism → named
// case/report/data. Each cue class gets its own colour in CSS so the eye
// learns to grab the write-this tokens first.
export function decorateLine(line) {
  let esc = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 1. keyword lead-in: "▪ Keyword phrase: mechanism…" → bold the lead-in
  esc = esc.replace(/^([▪•‣]\s*)([^:<]{2,60}?):(?!\/)/, '$1<b class="lead">$2</b>:');

  // 2. quoted phrases (thinker quotes / doctrines) → italic accent.
  // curly quotes only — straight quotes would match the HTML attributes
  // injected by step 1 and corrupt the markup
  esc = esc.replace(/“([^”]{3,140})”/g, '<span class="q">“$1”</span>')
           .replace(/‘([^’]{3,140})’/g, '<span class="q">‘$1’</span>');

  // 3. case citations "X v. Y" / "X vs Y"
  esc = esc.replace(/\b([A-Z][\w.&']+(?:\s[A-Z][\w.&']+){0,3}\s(?:v|vs)\.?\s[A-Z][\w.&']+)/g,
    '<span class="kw">$1</span>');

  // 4. examples: highlight the "Ex:" marker so examples pop out
  esc = esc.replace(/\b(Ex|e\.g)([.:])\s/g, '<span class="ex">$1$2</span> ');

  // 5. hard facts: years, Articles, %s, amendments/schedules
  esc = esc
    .replace(/\b((?:1[89]|20)\d{2})\b/g, '<span class="kw">$1</span>')
    .replace(/\b(Arts?\.?\s?\d+[A-Z]?(?:\(\w+\))?)/g, '<span class="kw">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?\s?%)/g, '<span class="kw">$1</span>')
    .replace(/\b(\d+(?:st|nd|rd|th)\s(?:Amdt|Amendment|Schedule))/g, '<span class="kw">$1</span>')
    .replace(/(§\s?\d+[A-Z]?)/g, '<span class="kw">$1</span>');

  // 6. acronyms / scheme names (3+ caps, not already inside a tag)
  esc = esc.replace(/\b([A-Z]{3,}(?:-[A-Z0-9]{2,})?)\b(?![^<]*>)/g, '<span class="ac">$1</span>');

  return esc;
}
