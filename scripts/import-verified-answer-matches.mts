import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { finalBank } from '../../../app/data/finalBank';
import corpus from '../../../app/data/finalQuestions.json' with { type: 'json' };

const banks = JSON.parse(readFileSync('data/banks.json', 'utf8'));
const oldQuestions = new Map((corpus as any).questions.map((q: any) => [q.id, q.question]));
const old = finalBank.map(a => ({ answer: a, question: oldQuestions.get(a.questionId) || '' }));
const stop = new Set('the a an and or of to in for with on as is are was were be been by from that this its their india indian discuss examine critically analyse analyze evaluate assess comment how what why role impact implications challenges measures reference light'.split(' '));
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(x => x.length > 2 && !stop.has(x)));
const similarity = (a: string, b: string) => { const x=tokens(a), y=tokens(b); let common=0; for(const t of x) if(y.has(t)) common++; return common / Math.sqrt(x.size*y.size || 1); };
const imported: any[] = [];
mkdirSync('data/answers', { recursive: true });
for (const paper of banks) {
  const answers: Record<string, any> = {};
  for (const q of paper.sections.flatMap((s: any) => s.qs)) {
    let best: any = null, score = 0;
    for (const candidate of old) { const value = similarity(q.q, candidate.question); if (value > score) { score = value; best = candidate; } }
    // Conservative gate: only near-identical stems are reused. Everything else stays pending.
    if (score < 0.70) continue;
    answers[q.id] = { ...best.answer, questionId: q.id, importedFrom: best.answer.questionId, matchScore: +score.toFixed(3) };
    imported.push({ questionId: q.id, importedFrom: best.answer.questionId, matchScore: +score.toFixed(3), question: q.q, sourceQuestion: best.question });
  }
  writeFileSync(`data/answers/${paper.id}.json`, JSON.stringify(answers, null, 2) + '\n');
}
writeFileSync('data/answers/import-audit.json', JSON.stringify({ imported: imported.length, pending: 458 - imported.length, rows: imported }, null, 2) + '\n');
console.log(JSON.stringify({ imported: imported.length, pending: 458 - imported.length }, null, 2));
