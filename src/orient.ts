// Solving orientation (phase-flip). The model + scramble stay in the canonical
// white-top/green-front frame (the GAN cube reports moves in its fixed colour
// frame regardless of how it's held). When a solve-frame rotation is active we
// only change what's DISPLAYED during the solve phase:
//   - the cube view is rotated by the rotation list,
//   - solution/hint/learn notation is translated into the held frame,
//   - manually-typed moves are translated back to the model frame.
//
// The rotation list (model -> held frame) is chosen per context by the caller:
//   - legacy phase-flip:  [] (white-top / green-front) or ['x2'] (yellow-top / blue-front)
//   - free-EO axis pick:  AXIS_ROTATION[axis] — always yellow-top, side axis to front.

import {
  applyMoves,
  faceletString,
  type Cube3x3,
  type Move3x3,
  type RotationMove,
} from './engine-api.ts';
import { translateMoves, invertMoves, MOVE_PERMS } from './engine/puzzles/cube3x3/index.ts';

// --- solve axes (extensible: add 'wy' (white/yellow up-front) later) ---
export type SolveAxis = 'gb' | 'ro';

/**
 * Model -> held rotation that brings the chosen *side* axis to the front, always
 * yellow-top (the EO trainer convention). Verified against the engine's own
 * CUBE_ORIENTATIONS_TO_ROTATIONS: YB = ['x2'] (blue front), YR = ['x2','y'] (red front).
 */
export const AXIS_ROTATION: Readonly<Record<SolveAxis, RotationMove[]>> = {
  gb: ['x2'],
  ro: ['x2', 'y'],
};
export const AXIS_LABEL: Readonly<Record<SolveAxis, string>> = {
  gb: 'yellow-top / blue-front',
  ro: 'yellow-top / red-front',
};
export const AXIS_SHORT: Readonly<Record<SolveAxis, string>> = { gb: 'Blue', ro: 'Red' };
export const OTHER_AXIS: Readonly<Record<SolveAxis, SolveAxis>> = { gb: 'ro', ro: 'gb' };

const IDENTITY = Array.from({ length: 54 }, (_, i) => i);

/** Displayed facelet position d shows model facelet viewPerm(rots)[d]. */
function viewPerm(rots: readonly RotationMove[]): number[] {
  let perm = IDENTITY.slice();
  for (const r of rots) {
    const next = perm.slice();
    for (const [src, dst] of (MOVE_PERMS as Record<string, [number, number][]>)[r]) next[dst] = perm[src];
    perm = next;
  }
  return perm;
}

/** Human label for the held frame ([] => white-top / green-front). */
export function orientLabel(rots: readonly RotationMove[]): string {
  if (rots.length === 0) return 'white-top / green-front';
  for (const a of Object.keys(AXIS_ROTATION) as SolveAxis[])
    if (AXIS_ROTATION[a].join(' ') === rots.join(' ')) return AXIS_LABEL[a];
  return 'rotated';
}

/** Model-frame moves -> what the solver should read/perform in the held frame. */
export function toDisplayMoves(moves: Move3x3[], rots: readonly RotationMove[]): Move3x3[] {
  return translateMoves(moves, rots);
}

/** Held-frame (typed) moves -> model frame. */
export function toModelMoves(moves: Move3x3[], rots: readonly RotationMove[]): Move3x3[] {
  return translateMoves(moves, invertMoves([...rots]));
}

/** Facelet string of the cube as seen in the held orientation. */
export function rotatedFacelets(cube: Cube3x3, rots: readonly RotationMove[]): string {
  return faceletString(applyMoves(cube, [...rots] as Move3x3[]));
}

/** Map model-frame highlight facelet indices to displayed (rotated) positions. */
export function rotateHighlight(model: Set<number>, rots: readonly RotationMove[]): Set<number> {
  const vp = viewPerm(rots);
  const out = new Set<number>();
  for (let d = 0; d < 54; d++) if (model.has(vp[d])) out.add(d);
  return out;
}
