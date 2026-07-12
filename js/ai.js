// Optional AI enhancement — rewrites rule-based cards into polished 50–70 word
// memorisation cards via the Anthropic Messages API (direct browser access).
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-8';

export function aiAvailable() { return !!localStorage.getItem('anthropic-key'); }
export function setApiKey(k) {
  if (k) localStorage.setItem('anthropic-key', k.trim());
  else localStorage.removeItem('anthropic-key');
}
export function getApiKey() { return localStorage.getItem('anthropic-key') || ''; }

async function callClaude(cardsBatch) {
  const schema = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
    required: ['cards'],
    additionalProperties: false,
  };

  const prompt = `You are helping a UPSC CSE Mains 2026 aspirant memorise their notes.
Rewrite each flashcard below into a single crisp 50-70 word memorisation card:
- Keep EVERY named fact: articles, cases, years, data, thinkers, committees, schemes.
- Use the "keyword → mechanism → named example" scoring spine.
- Make it flow as one readable passage (no bullet symbols), punchy and easy to recall while doomscrolling.
- Return exactly ${cardsBatch.length} cards, in the same order.

Cards:
${cardsBatch.map((c, i) => `${i + 1}. [${c.theme} — ${c.label}] ${c.text}`).join('\n\n')}`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('Model declined the request');
  const text = (data.content || []).find(b => b.type === 'text')?.text || '{}';
  return JSON.parse(text).cards || [];
}

export async function enhanceDocCards(doc, ruleCards) {
  const out = [];
  const BATCH = 20;
  for (let i = 0; i < ruleCards.length; i += BATCH) {
    const batch = ruleCards.slice(i, i + BATCH);
    const rewritten = await callClaude(batch);
    batch.forEach((c, k) => {
      out.push({ ...c, text: (rewritten[k] && rewritten[k].text) || c.text, ai: true });
    });
  }
  return out;
}
