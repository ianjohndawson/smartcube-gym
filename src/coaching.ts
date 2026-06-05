// AI coaching via the Anthropic API, called directly from the browser.
//
// The solver is the source of truth for optimality/efficiency; the AI's job is
// to explain the *thinking* — which piece to look at and how to pair/insert it —
// in a patient, encouraging way. The prompt forbids the model from claiming
// optimality or inventing move counts.
//
// The API key is stored in localStorage (entered in Settings).

const MODEL = 'claude-sonnet-4-20250514';
const API_URL = 'https://api.anthropic.com/v1/messages';
const KEY_STORAGE = 'cube-trainer.anthropic-key';
const LEGACY_KEY_STORAGE = 'block-trainer.anthropic-key';

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? localStorage.getItem(LEGACY_KEY_STORAGE) ?? '';
}

export function setApiKey(key: string): void {
  if (key) localStorage.setItem(KEY_STORAGE, key);
  else {
    localStorage.removeItem(KEY_STORAGE);
    localStorage.removeItem(LEGACY_KEY_STORAGE);
  }
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

export interface CoachContext {
  method: string; // Petrus | Roux | LEOR | APB
  methodDescription: string;
  stepName: string;
  stepBlurb: string;
  scramble: string;
  movesDone: string[]; // the solver's moves so far this step
  /** Solver's efficient continuation from the current position (reference only). */
  optimalContinuation: string;
  /** Description of the next piece to place, e.g. "orange-green edge". */
  nextPiece?: string;
  progress: number; // 0..1 toward the current block
  question?: string;
}

export const SYSTEM = `You are a warm, patient block-building coach for an adult cuber who is improving
toward sub-20, turns at a relaxed pace, and is learning Petrus and LEOR. The goal is INTUITION,
not memorising algorithms: help them SEE the next corner-edge pair and internalise the small
recurring "pair it up, then insert" moves until those become automatic.

Style: 2-4 short sentences, encouraging and concrete, about THIS position and the specific piece
in question. Use standard WCA notation sparingly when illustrating a join/insert idea. Do not
dump long algorithm lists.

Important boundaries:
- The application's solver is the sole authority on optimal solutions, move counts and efficiency.
  NEVER claim something is "optimal", and never state move counts as fact. Talk about the idea and
  the technique, not the numbers.
- Tailor to the method: Petrus/APB build a 2x2x2 then expand to a 2x2x3; Roux/LEOR build 1x2x3
  blocks around the bottom centres.`;

export function buildPrompt(ctx: CoachContext): string {
  const lines = [
    `Method: ${ctx.method} — ${ctx.methodDescription}`,
    `Current step: ${ctx.stepName} — ${ctx.stepBlurb}`,
    `Scramble: ${ctx.scramble}`,
    `Progress toward this block: ${Math.round(ctx.progress * 100)}%`,
    ctx.movesDone.length
      ? `Moves the solver has done so far this step: ${ctx.movesDone.join(' ')}`
      : 'They have not started this step yet.',
    ctx.nextPiece ? `The next piece to place is the ${ctx.nextPiece}.` : '',
    ctx.optimalContinuation
      ? `For your reference only (an efficient continuation the app found — do NOT quote it verbatim or call it optimal; use it to ground your advice about the idea): ${ctx.optimalContinuation}`
      : '',
  ].filter(Boolean);
  if (ctx.question) lines.push(`They ask: "${ctx.question}"`);
  else lines.push('Give one short, encouraging tip: which piece to look for next and how to think about pairing and inserting it — teach the intuition, don\'t just give moves.');
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
