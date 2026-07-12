// Structure parser: lines[] -> { sections: [{title, start, end, themes:[{title, start, end}]}] }
// Handles the four dialects found in the user's UPSC notes plus generic fallbacks:
//  A) sections "1 · CAPS", themes "T1 · Title"        (Polity, Geography, History, PubAd)
//  B) themes "Theme 1 · Title", ALL-CAPS sections     (IR)
//  C) sections "1 · CAPS", themes "1. Title [covers]" (GovSJ)
//  D) question banks "1. ★ long question?" must NOT become themes (Society)

const RE_THEME_T = /^T\d{1,3}\s*[·.:]\s*\S/;
const RE_THEME_WORD = /^Theme\s+\d{1,3}\s*[·.:\-–]\s*\S/i;
const RE_THEME_MD = /^#{2,4}\s+\S/;                    // markdown ##/###/#### headings
const RE_THEME_TOPIC = /^(?:Topic|Chapter|Unit|Q)\s*\d{1,3}\s*[·.:\-–)]\s*\S/i;
const RE_THEME_DECIMAL = /^\d{1,2}\.\d{1,2}\s+\S/;     // 1.1 / 2.3 numbering
const RE_SEC_DOT = /^\d{1,2}\s*·\s+\S/;
const RE_SEC_MD = /^#\s+\S/;                           // markdown # heading
const RE_SEC_ROMAN = /^[IVX]{1,4}[.)]\s+[A-Z]/;        // I. / IV) …
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

  // Decide theme matcher — first candidate style with enough hits wins.
  // Explicit styles (T1 ·, Theme 1 ·) win on a single hit; generic styles
  // (markdown, decimals, bare numbering) need several hits so stray lines
  // don't hijack the structure.
  const themeCandidates = [
    { re: l => RE_THEME_T.test(l), min: 1 },
    { re: l => RE_THEME_WORD.test(l), min: 1 },
    { re: l => RE_THEME_MD.test(l), min: 2 },
    { re: l => RE_THEME_TOPIC.test(l), min: 2 },
    { re: l => RE_THEME_DECIMAL.test(l) && l.length < 110, min: 3 },
    { re: l => RE_NUMBERED.test(l) && !looksLikeQuestion(l) && l.length < 110, min: 4 },
    // short Title-Case line ending in ':' acting as a topic marker
    { re: l => /^[A-Z][^:]{4,70}:$/.test(l) && !/^H\d/.test(l), min: 5 },
  ];
  let isTheme = () => false;
  for (const c of themeCandidates) {
    if (lines.filter(c.re).length >= c.min) { isTheme = c.re; break; }
  }

  // Decide section matcher (must not also be a theme)
  const sectionCandidates = [
    l => RE_SEC_DOT.test(l),
    l => RE_SEC_MD.test(l),
    l => isAllCaps(l),
    l => RE_SEC_ROMAN.test(l),
  ];
  let isSection = () => false;
  for (const c of sectionCandidates) {
    if (lines.some(l => c(l) && !isTheme(l))) { isSection = l => c(l) && !isTheme(l); break; }
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

// ---- line classification (styling / cards / speech / flow) ----
export function classifyLine(line) {
  if (/^Intro\b/i.test(line)) return 'intro';
  if (/^H1\b/.test(line)) return 'h1';
  if (/^H2\b/.test(line)) return 'h2';
  if (/^H3\b/.test(line)) return 'h3';
  if (/^Way\s?-?\s?F(or)?w(ar)?d/i.test(line) || /^Way fwd/i.test(line)) return 'way';
  if (/^Concl/i.test(line)) return 'concl';
  if (/^Value\s?-?\s?Add(ition|n)?/i.test(line)) return 'value';
  if (/^[＋+]\s?Ammo/i.test(line) || /^＋/.test(line) || /^[＋+]?\s?20\d\d\s+(ammo|addition)/i.test(line)) return 'ammo';
  if (/^[▪•‣]/.test(line)) return 'bullet';
  return 'plain';
}

// ---- Flow mode: reorder each theme into the strict revision sequence ----
// Intro (all options) → H1 + its content → H2 + content → H3 + content →
// Way-Forward block (way fwd + value-addition + ammo + 2026 additions) →
// Conclusion. Unclassified lines fold into the nearest block so nothing
// from the notes is lost.
export function flowLines(lines) {
  const { sections } = parseStructure(lines);
  const out = [];
  for (const sec of sections) {
    const real = lines[sec.start] === sec.title;
    if (real) out.push(sec.title);
    const themeStarts = new Set(sec.themes.filter(t => !t.pseudo).map(t => t.start));
    for (const th of sec.themes) {
      if (th.pseudo) {
        // unstructured stretch — emit as-is (skip the section title we already emitted)
        for (let i = th.start; i < th.end; i++) {
          if (i === sec.start && real) continue;
          out.push(lines[i]);
        }
        continue;
      }
      out.push(lines[th.start]); // theme title
      const intros = [], blocks = [], way = [], concl = [];
      let cur = null;
      for (let i = th.start + 1; i < th.end; i++) {
        if (themeStarts.has(i)) break;
        const l = lines[i];
        switch (classifyLine(l)) {
          case 'intro': intros.push(l); break;
          case 'h1': case 'h2': case 'h3': cur = { head: l, content: [] }; blocks.push(cur); break;
          case 'way': case 'value': case 'ammo': way.push(l); break;
          case 'concl': concl.push(l); break;
          default:
            if (cur) cur.content.push(l);
            else intros.push(l); // fold pre-head misc into the intro block
        }
      }
      // Adjacent heads (H1 then H2 with no content between) mean the source
      // was a side-by-side table whose rows interleave col1,col2,col1,col2 —
      // deal the bullets back round-robin so each head gets ITS content.
      if (blocks.length > 1
          && blocks.slice(0, -1).every(b => !b.content.length)
          && blocks[blocks.length - 1].content.length >= blocks.length) {
        const items = blocks[blocks.length - 1].content;
        blocks.forEach(b => { b.content = []; });
        items.forEach((it, k) => blocks[k % blocks.length].content.push(it));
      }
      out.push(...intros);
      for (const b of blocks) { out.push(b.head, ...b.content); }
      out.push(...way, ...concl);
    }
  }
  return out;
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
