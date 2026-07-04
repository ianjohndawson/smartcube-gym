// Geometry for the unified "2×2×3 + EO" trainer: keep a 2×2×3 on the WHITE face
// (yellow-top / white-bottom view) while orienting all edges, in either method's
// viewpoint. The oriented target is ONE canonical model state; the two methods —
// APB (block on the left, fixed with F/B) and Petrus (cube turned so the block is at
// the bottom-back, fixed with R/L) — are the SAME physical solve seen from holds that
// differ by a whole-cube y. So detection/scoring is one target; the method only
// picks a display rotation, fed through the existing disp()/toDisplayMoves path
// (which transposes both the shown ideal and the recorded strokes).
//
// Per scramble the app rolls a random front colour — a y-orientation of the canonical
// — so the 2×3 long side varies. Because the APP chooses it, the target is KNOWN
// (determinative, not free): detection is a single mask, and the display undoes the
// roll so the block always sits at the method's spot whatever colour it is.
//
// Frame (blocks.ts coords): x 0=L 2=R, y 0=D 2=U, z 0=B 2=F. White = model-U (centre
// 4), yellow = model-D. Derived + verified in scripts/block-eo-check.ts.

import {
  newSolved, applyMoves, homePermutation, isEoSolvedFromState,
  type Cube3x3, type Cube3x3Mask, type Move3x3, type RotationMove,
} from './engine-api.ts';
import { blockMaskFromRanges } from './blocks.ts';
import type { SolveAxis } from './orient.ts';
import { MASKS, invertMoves } from './engine/puzzles/cube3x3/index.ts';

export type BlockEoMethod = 'apb' | 'petrus';

// Canonical model target: a 2×2×3 on the WHITE (model-U) face — left-2 × top-2 ×
// full-depth — plus the F/B edge-orientation orbit. White = model-U, so a yellow-top
// (x2) view renders the block white-on-bottom.
const CANON_BLOCK = blockMaskFromRanges([0, 1], [1, 2], [0, 1, 2]).solvedFaceletIndices as number[];
const EO_FB = MASKS.EO.eoFaceletIndices as number[];

// The four random front-colour orientations: whole-cube y turns of the canonical.
// White is on the y-axis, so every one keeps white on model-U (white-bottom in view).
const ORIENTS: RotationMove[][] = [[], ['y'], ['y2'], ["y'"]];
export const BLOCK_EO_ORIENT_COUNT = ORIENTS.length;

// Rotate a facelet-index set by a whole-cube rotation (colour-identified via a
// rotated solved cube — where each home sticker lands). Used only at module load.
function rotateIdx(idx: readonly number[], rots: RotationMove[]): number[] {
  const home = homePermutation(applyMoves(newSolved(), rots as Move3x3[]).stateData);
  const fwd = new Array<number>(54);
  for (let p = 0; p < 54; p++) fwd[home[p]] = p; // sticker from home[p] now sits at p
  return idx.map((i) => fwd[i]);
}

// Per-orientation target (block kept + all edges oriented) and block-only prereq.
const TARGETS: Cube3x3Mask[] = ORIENTS.map((r) => ({
  solvedFaceletIndices: rotateIdx(CANON_BLOCK, r).sort((a, b) => a - b),
  eoFaceletIndices: rotateIdx(EO_FB, r).sort((a, b) => a - b),
}));

/** The determined block+EO target for the rolled orientation. */
export function blockEoTarget(orient: number): Cube3x3Mask {
  return TARGETS[orient];
}
/** Block-only mask for the rolled orientation — the scramble pre-builds this. */
export function blockEoPrereq(orient: number): Cube3x3Mask {
  return { solvedFaceletIndices: TARGETS[orient].solvedFaceletIndices };
}
/** Solved? Colour-identified against the KNOWN target (block kept + edges oriented). */
export function isBlockEoSolved(cube: Cube3x3, orient: number): boolean {
  return isEoSolvedFromState(cube, TARGETS[orient]);
}
export function randomBlockEoOrient(): number {
  return Math.floor(Math.random() * ORIENTS.length);
}
/** The rolled orientation's EO axis in the MODEL, so main.ts can reuse the free-EO
 * bad-edge count/highlight (axisBad): the even (id/y2) rolls orient on F/B → gb, the
 * odd (y/y') on L/R → ro. Verified: each roll's orbit equals AXIS_EO_ORBIT[axis]. */
export function blockEoAxis(orient: number): SolveAxis {
  return orient % 2 === 0 ? 'gb' : 'ro';
}

// Method base views (model → held frame): APB shows the block bottom-left and reads
// the F/B orbit as F/B moves; Petrus adds a y so the block is bottom-back and the same
// orbit reads as R/L moves. Both are yellow-top (x2) → white-bottom.
const METHOD_VIEW: Record<BlockEoMethod, RotationMove[]> = {
  apb: ['x2'],
  petrus: ['x2', 'y'],
};
/** Display rotation for the chosen method + rolled orientation: undo the roll, then
 * apply the method view, so the block always sits at the method's spot (APB
 * bottom-left / Petrus bottom-back), white-bottom, whatever colour was rolled. */
export function blockEoDisplayRots(method: BlockEoMethod, orient: number): RotationMove[] {
  return [...invertMoves(ORIENTS[orient]), ...METHOD_VIEW[method]];
}
