import { readFileSync, writeFileSync } from 'node:fs';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/build-final-questions.mjs <final.md>');
const lines = readFileSync(source, 'utf8').split(/\r?\n/);
const meta = {
  essay: ['Essay', 'Essay', '✒️', false],
  gs1: ['GS1', 'GS Paper 1', '🌏', false],
  gs2: ['GS2', 'GS Paper 2', '⚖️', false],
  gs3: ['GS3', 'GS Paper 3', '📈', false],
  gs4: ['GS4', 'GS Paper 4', '🧭', false],
  pubad1: ['PA1', 'Public Administration Paper 1', '🏛️', true],
  pubad2: ['PA2', 'Public Administration Paper 2', '🇮🇳', true],
};
const papers = Object.fromEntries(Object.entries(meta).map(([id, [short, title, icon, optional]]) => [id, { id, short, title, icon, optional, sections: [] }]));
let pid = null, section = '', current = null;
const clean = s => s.replace(/\*\*/g, '').replace(/\*([^*]+)\*/g, '$1').trim();

for (const raw of lines) {
  const line = raw.trim();
  if (/^# PAPER 0 — ESSAY/.test(line)) pid = 'essay';
  else if (/^# GS PAPER 1/.test(line)) pid = 'gs1';
  else if (/^# GS PAPER 2/.test(line)) pid = 'gs2';
  else if (/^# GS PAPER 3/.test(line)) pid = 'gs3';
  else if (/^# GS PAPER 4/.test(line)) pid = 'gs4';
  else if (/^# PUBLIC ADMINISTRATION — PAPER I:/.test(line)) pid = 'pubad1';
  else if (/^# PUBLIC ADMINISTRATION — PAPER II:/.test(line)) pid = 'pubad2';
  else if (pid && /^## /.test(line)) {
    section = clean(line.replace(/^##\s+/, ''));
    if (!papers[pid].sections.some(s => s.t === section)) papers[pid].sections.push({ t: section, qs: [] });
  }
  const m = line.match(/^\*\*([A-Z]*\d+)\.\s+\[T([123])(?:\s*·\s*(\d+)M)?\]\*\*\s+(.+)$/);
  if (pid && m) {
    const number = Number(m[1].replace(/\D/g, ''));
    const marks = m[3] ? Number(m[3]) : pid === 'essay' ? 125 : (pid === 'gs4' && /Case Studies/i.test(section) ? 20 : 10);
    const words = pid === 'essay' ? 1200 : pid.startsWith('pubad') ? 200 : marks >= 15 ? 250 : 150;
    const id = `${pid}-${String(number).padStart(2, '0')}`;
    current = { n: number, id, q: clean(m[4]), branch: [], tier: Number(m[2]), m: marks, w: words,
      lengths: pid.startsWith('pubad') ? [200, 350] : pid === 'essay' ? [1000, 1200] : [150, 250],
      src: 'UPSC CSE Mains 2026 Final Predicted Questions', topic: false };
    let sec = papers[pid].sections.find(s => s.t === section);
    if (!sec) { sec = { t: section || 'Questions', qs: [] }; papers[pid].sections.push(sec); }
    sec.qs.push(current);
  }
  const b = line.match(/^-\s+↳\s+\*Branch(?:\s*\([^)]*\))?:\*\s+(.+)$/);
  if (b && current) current.branch.push(clean(b[1]));
}

for (const p of Object.values(papers)) for (const s of p.sections) for (const q of s.qs) q.branch = q.branch.length ? q.branch.join('\n') : null;
const result = Object.values(papers);
const counts = Object.fromEntries(result.map(p => [p.id, p.sections.flatMap(s => s.qs).length]));
const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (total !== 458) throw new Error(`Expected 458 master questions, found ${total}: ${JSON.stringify(counts)}`);
writeFileSync('data/banks.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ total, counts }, null, 2));
