// Shared fact-entity extraction — used by Quiz (blanking) and the Knowledge
// Engine (cross-document analysis). One pattern set so both stay in sync.
// Each pattern is typed so a passage mixes fact KINDS (a case + a year + a
// committee) instead of four years. Order = blanking/analysis priority.
const ENTITY_PATTERNS = [
  // keyword lead-ins — the "write this" token that opens each point
  { t: 'keyword', re: /(?:^|·\s+)([A-Z][^:·—]{2,42}?):\s/g, group: 1 },
  { t: 'case', re: /\b[A-Z][A-Za-z.'']+(?:\s[A-Z][A-Za-z.'']+){0,3}\s(?:v\.?|vs\.?)\s[A-Z][A-Za-z.'']+/g },
  // named entity right before "(year)": Kesavananda (1973), NFHS-5 (2021)…
  { t: 'name', re: /\b[A-Z][\w.''&-]+(?:\s[A-Z][\w.''&-]+){0,3}(?=\s*\((?:1[89]|20)\d{2}\))/g },
  // theories & institutions: X Committee / Doctrine / Act / Theory / Model…
  { t: 'theory', re: /\b[A-Z][\w''-]+(?:\s(?:[A-Z][\w''-]+|of|the|and)){0,3}\s(?:Committee|Commission|Doctrine|Mission|Act|Bill|Policy|Model|Theory|Curve|Index|Report|Scheme|Yojana|Abhiyan|Convention|Protocol|Treaty|Agreement|Summit|Fund|Principle|Hypothesis)\b/g },
  // examples — the proof that earns marks: blank what follows "Ex:"
  { t: 'example', re: /\bEx:\s*([^·.;()]{4,60})/g, group: 1 },
  // thinker quotes: blank what was said
  { t: 'quote', re: /“([^”]{4,70})”/g, group: 1 },
  { t: 'article', re: /\bArts?\.?\s?\d+[A-Z]?(?:\(\w+\))?/g },
  { t: 'amendment', re: /\b\d+(?:st|nd|rd|th)\s(?:Amdt|Amendment|Schedule)\b/g },
  { t: 'data', re: /\b\d+(?:\.\d+)?\s?(?:%|crore|lakh|bn|mn|km)\b/g },
  { t: 'year', re: /\b(?:1[89]|20)\d{2}\b/g },
  // schemes & acronyms: MGNREGA, DPSP, NJAC…
  { t: 'acronym', re: /\b[A-Z]{3,}(?:-[A-Z0-9]{1,4})?\b/g },
];

// entity kinds worth cross-referencing across documents — keyword lead-ins
// and generic examples are too noisy/ubiquitous to make useful cross-links
export const LINKABLE_TYPES = new Set(['case', 'name', 'theory', 'article', 'amendment', 'acronym', 'quote']);

export function findEntities(text) {
  const out = [];
  for (const p of ENTITY_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text))) {
      const t = p.group ? m[p.group] : m[0];
      const start = p.group ? m.index + m[0].indexOf(t) : m.index;
      const end = start + t.length;
      if (!out.some(o => start < o.end && end > o.start)) out.push({ start, end, text: t, t: p.t });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function normalizeEntity(text) {
  return text.toLowerCase().replace(/[.'']/g, '').replace(/\s+/g, ' ').trim();
}
