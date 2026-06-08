// Rule-based, deterministic coaching (no AI). Turns the solver's facts +
// recognition rules into short "why / how" guidance for the Nudge level — it
// explains the case and the technique WITHOUT giving the exact moves (that's
// Reveal/Ideal). Grounded entirely in the cube state and the optimal solution.

import { type Cube3x3 } from './engine-api.ts';
import { type FocusPiece } from './pieces.ts';

export interface RuleHint {
  name?: string; // a short named callout (the technique/case)
  lines: string[];
}

// cube.EO order: indices 0–3 = U-layer edges, 4–7 = E-slice, 8–11 = D-layer
// (mirrors EO_PRIMARY in main.ts).
export function eoHint(cube: Cube3x3): RuleHint {
  const bad: number[] = [];
  cube.EO.forEach((good, i) => { if (!good) bad.push(i); });
  const n = bad.length;
  if (n === 0) return { lines: ['All 12 edges are oriented — EO is done.'] };
  const top = bad.filter((i) => i < 4).length;
  const mid = bad.filter((i) => i >= 4 && i < 8).length;
  const bot = bad.filter((i) => i >= 8).length;

  const lines = [
    `An edge is bad if its F/B colour faces up or down (or sideways) — it can’t be solved with R, L, U, D alone.`,
    `Each F or B quarter turn flips the four edges on that face, so fix them in pairs.`,
  ];
  let name: string;
  if (n === 2) { name = '2 bad edges'; lines.push('Bring both bad edges onto the same F/B face, flip them with one quarter turn, then rebuild.'); }
  else if (n === 4) { name = '4 bad edges'; lines.push('Either flip two at a time, or set up so a single F/B turn catches all four.'); }
  else { name = `${n} bad edges`; lines.push('Aim to roughly halve the bad count with each F/B turn (it flips 4 at once).'); }
  lines.unshift(`${n} bad — ${top} up, ${mid} in the middle, ${bot} down.`);
  return { name, lines };
}

// Block building: name the next piece + the technique to place it, sized by how
// many optimal moves it takes (a robust proxy for "how awkward" the case is).
export function blockHint(focus: FocusPiece | null, keepNote: boolean): RuleHint {
  if (!focus) return { lines: ['Nothing left to place here.'] };
  const m = focus.movesToPlace;
  let name: string;
  let how: string;
  if (m <= 1) { name = 'Drop-in'; how = 'It’s already lined up — just drop it into place.'; }
  else if (m <= 3) { name = 'Pair & insert'; how = 'Join the corner and edge into a pair, then insert them together.'; }
  else if (m <= 5) { name = 'Set up, then insert'; how = 'A short setup first to make the pair, then insert — don’t disturb what’s done.'; }
  else { name = 'Re-route'; how = 'It’s buried or blocked — bring it out, pair it, then insert the long way round.'; }
  const lines = [`Next: the ${focus.description}.`, how];
  if (keepNote) lines.push('Keep the pieces you’ve already placed.');
  return { name, lines };
}
