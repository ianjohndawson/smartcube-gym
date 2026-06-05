// Solving orientation (phase-flip). The model + scramble stay in the canonical
// white-top/green-front frame (the GAN cube reports moves in its fixed colour
// frame regardless of how it's held). When a solving orientation is active we
// only change what's DISPLAYED during the solve phase:
//   - the cube view is rotated,
//   - solution/hint/learn notation is translated into the held frame,
//   - manually-typed moves are translated back to the model frame.
//
// Currently a single static x2 (yellow-top / blue-front). Configurable later.

import { applyMoves, faceletString, type Cube3x3, type Move3x3 } from './engine-api.ts';
import { translateMoves, MOVE_PERMS } from './engine/puzzles/cube3x3/index.ts';

const ROT: Move3x3[] = ['x2'];

// Displayed facelet position d shows model facelet VIEW_PERM[d].
const VIEW_PERM: number[] = Array.from({ length: 54 }, (_, i) => i);
for (const [src, dst] of (MOVE_PERMS as Record<string, [number, number][]>)['x2']) VIEW_PERM[dst] = src;

export const ORIENT_LABEL = 'yellow-top / blue-front';

/** Model-frame moves -> what the solver should read/perform in the held frame. */
export function toDisplayMoves(moves: Move3x3[]): Move3x3[] {
  return translateMoves(moves, ['x2']);
}

/** Held-frame (typed) moves -> model frame (x2 is self-inverse). */
export function toModelMoves(moves: Move3x3[]): Move3x3[] {
  return translateMoves(moves, ['x2']);
}

/** Facelet string of the cube as seen in the held orientation. */
export function rotatedFacelets(cube: Cube3x3): string {
  return faceletString(applyMoves(cube, ROT));
}

/** Map model-frame highlight facelet indices to displayed (rotated) positions. */
export function rotateHighlight(model: Set<number>): Set<number> {
  const out = new Set<number>();
  for (let d = 0; d < 54; d++) if (model.has(VIEW_PERM[d])) out.add(d);
  return out;
}
