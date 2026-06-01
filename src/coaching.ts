// AI coaching via the Anthropic API, called directly from the browser.
//
// The API key is stored in localStorage (entered by the user in Settings) and
// sent with the browser-direct-access header. This is fine for a personal
// single-user training tool; do not ship a shared key.

const MODEL = 'claude-sonnet-4-20250514';
const API_URL = 'https://api.anthropic.com/v1/messages';
const KEY_STORAGE = 'block-trainer.anthropic-key';

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? '';
}

export function setApiKey(key: string): void {
  if (key) localStorage.setItem(KEY_STORAGE, key);
  else localStorage.removeItem(KEY_STORAGE);
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

export interface CoachContext {
  method: string; // Petrus | Roux | LEOR | APB
  methodDescription: string;
  phaseName: string;
  phaseBlurb: string;
  scramble: string;
  movesDone: string[]; // the user's moves so far this phase
  ideal: string; // generated ideal solution for this phase, if available
  progress: number; // 0..1 toward the current block
  question?: string; // optional explicit user question
}

const SYSTEM = `You are a friendly, concise Rubik's cube block-building coach. You help a solver
learn intuitive block building (not algorithms) for their chosen method. Focus only on the
CURRENT phase. Keep answers short (2-4 sentences), encouraging, and specific to the pieces
involved. Use standard WCA move notation. Never dump long algorithm lists; teach the thinking.
Be aware of which method is selected and tailor advice to that method's block-building style:
- Petrus / APB: build a 2x2x2 corner block, then expand to a 2x2x3, all intuitively.
- Roux / LEOR: build 1x2x3 blocks on the left and right around the bottom centres.`;

function buildPrompt(ctx: CoachContext): string {
  const lines = [
    `Method: ${ctx.method} — ${ctx.methodDescription}`,
    `Current phase: ${ctx.phaseName} — ${ctx.phaseBlurb}`,
    `Scramble: ${ctx.scramble}`,
    `Progress toward this block: ${Math.round(ctx.progress * 100)}%`,
    ctx.movesDone.length ? `Moves the solver has done so far this phase: ${ctx.movesDone.join(' ')}` : 'The solver has not started this phase yet.',
    ctx.ideal ? `One known efficient solution for this phase (reference only — prefer teaching intuition over dictating these exact moves): ${ctx.ideal}` : '',
  ].filter(Boolean);
  if (ctx.question) lines.push(`The solver asks: "${ctx.question}"`);
  else lines.push('Give one short, actionable coaching tip for what to look for or do next in this phase.');
  return lines.join('\n');
}

export async function getCoaching(ctx: CoachContext): Promise<string> {
  const key = getApiKey();
  if (!key) throw new Error('No Anthropic API key set. Add one in Settings.');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(ctx) }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const blocks = data?.content ?? [];
  return blocks
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim();
}
