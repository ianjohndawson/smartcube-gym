// Oracle implementations for the validation harnesses — NOT app code.
//
// detect-parity.ts checks the app's live, state-based detection
// (isMaskSolvedState, in engine-api.ts) against these independent reference
// implementations. They lived in engine-api.ts but are used only by harnesses,
// so they're kept out of the production facade (and the shipped bundle).

import { Cube3x3, type Cube3x3Mask, type Move3x3 } from '../src/engine-api.ts';

function maskSolved(state: Cube3x3, mask: Cube3x3Mask): boolean {
  return state.clone().applyMask(mask).isSolved();
}

/** Index of the first candidate mask that is solved in `state`, or -1. */
export function detectIndex(state: Cube3x3, masks: Cube3x3Mask[]): number {
  for (let i = 0; i < masks.length; i++) if (maskSolved(state, masks[i])) return i;
  return -1;
}

export function anySolved(state: Cube3x3, masks: Cube3x3Mask[]): boolean {
  return detectIndex(state, masks) >= 0;
}

/**
 * History-based detection. EO (and other orientation) masks must be applied to a
 * SOLVED cube and then the move history replayed, so the orientation markers get
 * permuted — applying the mask to an already-scrambled state would read EO as
 * trivially solved. Correct for blocks too.
 */
export function isMaskSolvedFromHistory(history: Move3x3[], mask: Cube3x3Mask): boolean {
  return new Cube3x3().applyMask(mask).applyMoves([...history]).isSolved();
}
