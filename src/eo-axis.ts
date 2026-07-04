// Axis-agnostic edge-orientation geometry: the EO orbit/line/cross index tables
// and the pure helpers that compute EO masks, count bad edges, classify free-EO
// steps and score optimal EO length per side axis. All evaluated in the MODEL
// frame (any held-frame rotation is display-only) and free of app state — the
// stateful EO mode/gesture/commit controllers live in main.ts.

import { type Cube3x3, type Cube3x3Mask, homePermutation, solveFromState } from './engine-api.ts';
import type { SolveAxis } from './orient.ts';
import type { StepDef } from './steps.ts';

// EO orbit facelets (mirror the engine's getEO) so we can highlight bad edges.
// Per edge: a PRIMARY sticker (U/D-facing for F/B-EO) and a SECONDARY sticker.
const EO_PRIMARY = [1, 3, 5, 7, 32, 24, 26, 30, 46, 48, 50, 52];
const EO_SECONDARY = [19, 10, 16, 13, 21, 23, 27, 29, 37, 34, 40, 43];
export function badEdgeStickers(c: Cube3x3): number[] {
  const out: number[] = [];
  c.EO.forEach((good, i) => {
    if (!good) out.push(EO_PRIMARY[i], EO_SECONDARY[i]);
  });
  return out;
}
// Free-EO bad-edge detection, per chosen side axis, computed in the MODEL frame.
// EO is axis-specific: the F/B orbit (above) is for the G/B "blue" axis; the R/O
// "red" axis uses the same orbit rotated by y (the y-image of the F/B orbit — the
// L/R-facing edge stickers). Both are evaluated WITHOUT rotating the state (the
// rotation is display-only); we identify each edge by colour via homePermutation
// and an edge is good iff its axis-PRIMARY sticker has a home in that axis's orbit.
// Derived as y(EO_PRIMARY)/y(EO_SECONDARY) and verified against a constructive
// {U,D,F,B,R2,L2}-only oracle (those moves preserve R/L-axis EO).
const EO_PRIMARY_RL = [5, 1, 7, 3, 29, 21, 23, 27, 48, 52, 46, 50];
const EO_SECONDARY_RL = [16, 19, 13, 10, 30, 32, 24, 26, 34, 43, 37, 40];
const AXIS_EO_PRIMARY: Record<SolveAxis, number[]> = { gb: EO_PRIMARY, ro: EO_PRIMARY_RL };
const AXIS_EO_SECONDARY: Record<SolveAxis, number[]> = { gb: EO_SECONDARY, ro: EO_SECONDARY_RL };
const AXIS_EO_ORBIT: Record<SolveAxis, number[]> = {
  gb: [...EO_PRIMARY].sort((a, b) => a - b),
  ro: [...EO_PRIMARY_RL].sort((a, b) => a - b),
};
const AXIS_EO_ORBIT_SET: Record<SolveAxis, Set<number>> = {
  gb: new Set(EO_PRIMARY),
  ro: new Set(EO_PRIMARY_RL),
};
// Centres-free EO mask for an axis (model frame). Centres are intentionally
// omitted — they don't constrain EO and any face turn leaves them put.
function axisEoMask(axis: SolveAxis): Cube3x3Mask {
  return { solvedFaceletIndices: [], eoFaceletIndices: AXIS_EO_ORBIT[axis] };
}
// Per-axis bottom line / cross placement targets (centres-free, model frame).
// CONVENTION: the free-EO solve view is rendered yellow-top (AXIS_ROTATION starts
// with x2), so the cross/line is built on the *bottom* of what you see — the WHITE
// (model-U) face — a standard white cross. The targets are therefore on the U face
// (the x2-image of the D-face sets): the blue (gb) line is UF+UB; the red (ro) line
// is its y-image UL+UR. The U-cross is the same set on both axes (y permutes the
// four U-edges among themselves), so a single centres-free cross target serves both.
const AXIS_LINE: Record<SolveAxis, number[]> = {
  gb: [1, 7, 13, 19],
  ro: [3, 5, 10, 16],
};
const CROSS_NC = [1, 3, 5, 7, 10, 13, 16, 19];
// EO target mask for a step on a chosen side axis. Full EO ('eo') keeps no
// pieces; EOLine/EOCross add the line/cross placement to the same axis's EO
// orbit so completion requires every edge oriented AND the line/cross placed
// — evaluated colour-identified in the model frame (rotation is display-only).
export function eoMaskForStep(s: StepDef | null, axis: SolveAxis): Cube3x3Mask {
  if (s?.id === 'eoline') return { solvedFaceletIndices: AXIS_LINE[axis], eoFaceletIndices: AXIS_EO_ORBIT[axis] };
  if (s?.id === 'eocross') return { solvedFaceletIndices: CROSS_NC, eoFaceletIndices: AXIS_EO_ORBIT[axis] };
  return axisEoMask(axis);
}
export function axisBad(c: Cube3x3, axis: SolveAxis): { count: number; stickers: number[] } {
  const home = homePermutation(c.stateData);
  const stickers: number[] = [];
  if (home.length === 0) return { count: 0, stickers };
  const P = AXIS_EO_PRIMARY[axis], S = AXIS_EO_SECONDARY[axis], orbit = AXIS_EO_ORBIT_SET[axis];
  let count = 0;
  for (let i = 0; i < 12; i++)
    if (!orbit.has(home[P[i]])) { count++; stickers.push(P[i], S[i]); }
  return { count, stickers };
}

/** Free side-axis EO steps: Full EO ('eo') plus the ZZ line/cross drills, all of
 * which orient every edge and so support the red/green axis choice, the 4-move
 * axis-pick spin, axis-aware scoring and the rotated (held-frame) display.
 * Block-keeping EO (eo123/eo223/petrus-eo) is fixed to the F/B axis and excluded. */
const FREE_EO_IDS = new Set(['eo', 'eoline', 'eocross']);
export function isFreeEo(s: StepDef | null): boolean {
  return s != null && FREE_EO_IDS.has(s.id);
}

// Axis-agnostic EO coach hint (free-EO). cube.EO / eoHint are F/B-axis only, so on
// the red axis they'd describe the wrong edges; phrase orientation relative to the
// *held* front/back face (the axis actually being solved) instead.
export function freeEoHint(bad: number): { name?: string; lines: string[] } {
  if (bad === 0) return { lines: ['All 12 edges are oriented for this axis — EO is done.'] };
  const lines = [
    `${bad} bad edge${bad === 1 ? '' : 's'} (relative to the front/back you’re holding).`,
    `An edge is bad if its front/back colour faces up, down or sideways — it can’t be solved with R, L, U, D alone.`,
    `Each front or back quarter turn flips the four edges on that face, so fix them in pairs.`,
  ];
  const name = bad === 2 ? '2 bad edges' : bad === 4 ? '4 bad edges' : `${bad} bad edges`;
  if (bad === 2) lines.push('Bring both bad edges onto the same F/B face, flip with one quarter turn, then rebuild.');
  else if (bad === 4) lines.push('Flip two at a time, or set up so a single F/B turn catches all four.');
  else lines.push('Roughly halve the bad count with each F/B turn (it flips four at once).');
  return { name, lines };
}

/** Optimal EO length for a given axis, from a start state. Evaluated in the MODEL
 * frame with that axis's centres-free orbit mask (the rotation is display-only). */
export function eoAxisOptimalLen(start: Cube3x3, _s: StepDef, axis: SolveAxis): number {
  const m = solveFromState(start, eoMaskForStep(_s, axis), _s.solver);
  return m ? m.length : 0;
}
