# Model Answer Scheme — Mains 2026 Bank

The generation contract for every model answer in `data/answers/*.json`. Built from
topper-copy analysis, evaluation-process reporting and directive-word conventions
(sources at bottom), fused with the user's own enriched cheat-sheet format so the
answer bank and the cheat sheets reinforce the same memory structures.

## The one governing fact

Examiners spend ~90 seconds per answer. An answer must score on a skim: underlined
keywords, headings and the first body points carry the marks. Therefore the
**Skeleton view is the design target** — the Full answer is the skeleton fleshed
out, never prose that hides its skeleton.

## Universal rules (every paper)

- **Word budget = 15 × marks** (±10%): 10m→150w · 15m→250w (GS) / 225w (PubAd) · 20m→300w.
  Counted as exam-written words: ONE intro + headings + points + way forward + conclusion.
  The app shows a live `written/limit` chip on every answer — out-of-budget renders red; fix before shipping a batch.
  **Time budget = 0.72 min × marks** (250 marks in 180 min): 10m≈7min · 15m≈11min · 20m≈14min.
- **Density budget (handwritability):** 10m = 6–7 content points · 15m = 9–10 · 20m = 12–14.
  A point = keyword lead-in → mechanism → named example/data/case. Core of a point ≤ 12 words.
  Never denser than a tired hand can reproduce at ~22 words/min.
- **Structure:** Intro (1–2 lines, two alternative openings: concept/thinker OR data/event)
  → Body in 2–4 headed sections, bullet points, strongest points FIRST
  → Way forward (2–3 actionables, where the directive invites)
  → Conclusion (1–2 lines, forward-looking, tied to constitutional value / national goal).
- **Directive shapes the body:**
  - *Discuss* — both sides, multiple dimensions, reasoned position.
  - *Examine* — break into components, probe cause/effect, evidence-led finding.
  - *Critically examine/analyse* — merits → limits → balanced verdict (verdict is mandatory).
  - *Comment* — brief unpacking → your substantiated stand.
  - *Elucidate/Explain* — make the linkage clear with mechanism + examples; no debate needed.
  - *Evaluate/Assess* — weigh against explicit criteria, end with judgement.
  - *Compare/Contrast* — table or paired points, criteria-wise, never serial description.
- **Every point carries one value-add**, tagged: doctrine/theory · committee/report ·
  case/judgment · data · scheme/current initiative (≤18 months old).
- **Verification policy (hard):** every named fact is tagged `n` (from user's notes),
  `w` (web-verified), or `u` (⚠ could not verify — rendered with a warning, never
  silently included). No invented committees, data, articles, cases. When in doubt, omit.
- **No repetition** inside an answer: a fact appears once; intro/conclusion never restate body lines.
- **Keyword tiers:** `**gold**` = load-bearing, must reproduce in exam (drives Skeleton +
  Flashcard views); plain = connective tissue, reproducible in your own words.

## Per-paper deltas

**GS1 Geography** — process mechanism first (diagram-friendly); name regions/case sites;
map/diagram spec wherever the bank's coverage notes flag one.
**GS1 History** — chronological spine + historiographical verdict (nationalist/subaltern
lens where apt); anniversaries as hooks; culture Qs name monuments/styles/texts.
**GS2 Polity** — Article numbers + SC judgments + commissions (Punchhi/Sarkaria/NCRWC);
doctrine-first intros; sensitive topics answered on constitutional design, not politics.
**GS2 Governance/SJ** — scheme names + performance data + committee findings; vulnerable-
section lens; 2nd ARC quotes as authority.
**GS2 IR** — framework intro (doctrine/policy name) → convergences → frictions → way
forward; summit outcomes and groupings by exact name/year.
**GS3** — data-rich intros (Economic Survey/Budget 2026-27, NCRB, IPCC); scheme/mission
names; security Qs: threat anatomy → state response → gaps → reform.
**PubAd Paper I** — thinker-quote or paradigm intro; answer IN the discipline's vocabulary
(locus/focus, ideal type, prismatic…); every theory bridged to ONE Indian administrative
example ("Indian bridge"); scholarly critique mandatory (who challenged it, in what work);
20m Qs = mini-essays with 3 sections.
**PubAd Paper II** — constitutional/committee anchoring (2nd ARC first authority);
**Paper-I theory interlink in every answer** (the 300+ differentiator: e.g. Collector Q
cites Weber's ideal type strain, police reform cites accountability theory); current
administrative developments (16th FC, Karmayogi, DPDP) kept in the administrative lane.

## Cluster method

Banks group sibling questions (police reform ×5, Riggs ×5, 16th FC ×3…). Each cluster
gets ONE master content block; each sibling answer re-aims it at that stem's directive +
quote, with an `angle` note ("this stem wants the litigation-vs-legislation axis, not the
colonial-legacy axis"). Revise the cluster once; rehearse every angle.

## Answer JSON schema (`data/answers/<paperId>.json`)

```json
{ "pubad1-15": {
  "directive": "critically examine",
  "lens": "one line: what specifically fetches marks here",
  "intro": [ {"t":"thinker","x":"…"}, {"t":"concept","x":"…"} ],
  "body": [ { "h":"Section heading",
      "p": [ {"x":"point with **gold** spans","va":"Merton","vt":"thinker","vf":"n"} ] } ],
  "wf": ["way-forward point", "…"],
  "conc": "conclusion line",
  "diag": {"k":"flow|hub|table","d":"…spec…"},
  "mne": "OPTIONAL — only where a genuine ordered list exists (≥4 items someone would actually forget); never invent acronym gimmicks",
  "flash": ["5 load-bearing recall points"],
  "cluster": "weber — generation-internal only: reuse the cluster's master content, re-aimed at this stem; cluster/angle notes are NOT rendered in the app"
} }
```

`vf`: n=notes · w=web-verified · u=⚠unverified. Views derive: Skeleton = headings +
gold spans; Flashcard = question → `flash`; Audio = Full view linearised.

## Sources

- [PrepAiro topper-copy analysis](https://prepairo.ai/upsc/blogs/upsc-topper-copy-analysis-high-scoring-answer-sheets-2024/) · [InsightsIAS topper copies](https://www.insightsonindia.com/upsc-toppers-answer-copies-download-ias-topper-mains-copies-by-insightsias/) · [How UPSC evaluates](https://answerwriting.com/how-upsc-evaluates-mains-answers) · [Politics for India evaluation reality](https://politicsforindia.com/how-upsc-mains-copies-are-evaluated-in-real/)
- Directives: [PMF IAS](https://www.pmfias.com/directive-words/) · [InsightsIAS](https://www.insightsonindia.com/2014/07/04/directives-explained-examine-critically-examine-analyse-critically-analyse/) · [Lukmaan terminology PDF](https://lukmaanias.com/wp-content/uploads/2021/06/UNDERSTANDING-TERMINOLOGIES-USED-IN-QUESTIONS.pdf)
- PubAd method: [Legacy IAS PubAd strategy](https://www.legacyias.com/public-administration-optional-strategy/) · [GS Score PubAd](https://iasscore.in/upsc/optional-subjects/how-to-prepare-public-administration-optional-for-upsc) · Lukmaan toppers' copies convention (thinker fluency per Prasad & Prasad; P1↔P2 interlinking)
- Word limits: [SuperKalam PubAd pattern](https://superkalam.com/upsc-mains/optional-syllabus/upsc-mains-public-administration-optional-syllabus-paper-pattern-and-booklist) · [UPSC answer word-limit guide](https://upscanswercheck.com/upsc-answer-writing-word-limits)
