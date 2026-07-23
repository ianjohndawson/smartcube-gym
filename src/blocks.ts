// Block-building masks for the crystalcube engine.
//
// crystalcube uses a "net order" 54-facelet layout. This maps each facelet to
// the cubie coordinate (x,y,z) it belongs to — axes: x 0=L 2=R, y 0=D 2=U,
// z 0=B 2=F — so we can generate 2x2x2 / 2x2x3 / 1x2x3 block masks from
// geometry. The map is cross-checked against the engine's own Cross/centre
// masks in scripts/parity-blocks.ts.

import type { Cube3x3Mask } from './engine/puzzles/cube3x3/index.ts';

// facelet index -> [x, y, z]
export const NET_COORDS: ReadonlyArray<readonly [number, number, number]> = [
  // U face (y=2), indices 0-8
  [0, 2, 0], [1, 2, 0], [2, 2, 0], [0, 2, 1], [1, 2, 1], [2, 2, 1], [0, 2, 2], [1, 2, 2], [2, 2, 2],
  // band row 1 (y=2): L(9-11) F(12-14) R(15-17) B(18-20)
  [0, 2, 0], [0, 2, 1], [0, 2, 2],
  [0, 2, 2], [1, 2, 2], [2, 2, 2],
  [2, 2, 2], [2, 2, 1], [2, 2, 0],
  [2, 2, 0], [1, 2, 0], [0, 2, 0],
  // band row 2 (y=1): L(21-23) F(24-26) R(27-29) B(30-32)
  [0, 1, 0], [0, 1, 1], [0, 1, 2],
  [0, 1, 2], [1, 1, 2], [2, 1, 2],
  [2, 1, 2], [2, 1, 1], [2, 1, 0],
  [2, 1, 0], [1, 1, 0], [0, 1, 0],
  // band row 3 (y=0): L(33-35) F(36-38) R(39-41) B(42-44)
  [0, 0, 0], [0, 0, 1], [0, 0, 2],
  [0, 0, 2], [1, 0, 2], [2, 0, 2],
  [2, 0, 2], [2, 0, 1], [2, 0, 0],
  [2, 0, 0], [1, 0, 0], [0, 0, 0],
  // D face (y=0), indices 45-53
  [0, 0, 2], [1, 0, 2], [2, 0, 2], [0, 0, 1], [1, 0, 1], [2, 0, 1], [0, 0, 0], [1, 0, 0], [2, 0, 0],
];

function inSet(v: number, allowed: number[]): boolean {
  return allowed.includes(v);
}

/** A block mask = every facelet whose cubie coordinate falls within the ranges. */
export function blockMaskFromRanges(xs: number[], ys: number[], zs: number[]): Cube3x3Mask {
  const solvedFaceletIndices: number[] = [];
  NET_COORDS.forEach(([x, y, z], i) => {
    if (inSet(x, xs) && inSet(y, ys) && inSet(z, zs)) solvedFaceletIndices.push(i);
  });
  return { solvedFaceletIndices };
}

const PAIRS = [
  [0, 1],
  [1, 2],
];
const SINGLES = [[0], [1], [2]];
const FULL = [0, 1, 2];

/** All 8 distinct 2x2x2 sub-blocks, as masks. */
export function all222Masks(): Cube3x3Mask[] {
  const out: Cube3x3Mask[] = [];
  for (const xs of PAIRS) for (const ys of PAIRS) for (const zs of PAIRS) out.push(blockMaskFromRanges(xs, ys, zs));
  return out;
}

/** All 12 distinct 2x2x3 sub-blocks, as masks. */
export function all223Masks(): Cube3x3Mask[] {
  const out: Cube3x3Mask[] = [];
  for (const ys of PAIRS) for (const zs of PAIRS) out.push(blockMaskFromRanges(FULL, ys, zs));
  for (const xs of PAIRS) for (const zs of PAIRS) out.push(blockMaskFromRanges(xs, FULL, zs));
  for (const xs of PAIRS) for (const ys of PAIRS) out.push(blockMaskFromRanges(xs, ys, FULL));
  return out;
}

/** All distinct 1x2x3 sub-blocks, as masks. Includes the 12 MIDDLE slabs
 *  (single axis = 1) — geometrically 1×2×3 but only two movable pieces (two
 *  edges, no corners). Kept complete for the geometry-sweep harnesses; steps
 *  must use side123Masks below. */
export function all123Masks(): Cube3x3Mask[] {
  const out: Cube3x3Mask[] = [];
  for (const ys of PAIRS) for (const zs of SINGLES) out.push(blockMaskFromRanges(FULL, ys, zs));
  for (const ys of SINGLES) for (const zs of PAIRS) out.push(blockMaskFromRanges(FULL, ys, zs));
  for (const xs of PAIRS) for (const zs of SINGLES) out.push(blockMaskFromRanges(xs, FULL, zs));
  for (const xs of SINGLES) for (const zs of PAIRS) out.push(blockMaskFromRanges(xs, FULL, zs));
  for (const xs of PAIRS) for (const ys of SINGLES) out.push(blockMaskFromRanges(xs, ys, FULL));
  for (const xs of SINGLES) for (const ys of PAIRS) out.push(blockMaskFromRanges(xs, ys, FULL));
  return out;
}

/** The 24 side-anchored 1x2x3 blocks — the valid TRAINING placements (Roux
 *  FB/SB, LEOR first block are all built against a face). Accepting the middle
 *  slabs would let a first-block step "complete" the moment two matching edges
 *  happen to land (e.g. DF+DB mid-solve), which is why steps use this list. */
export function side123Masks(): Cube3x3Mask[] {
  const SIDES = [[0], [2]];
  const out: Cube3x3Mask[] = [];
  for (const ys of PAIRS) for (const zs of SIDES) out.push(blockMaskFromRanges(FULL, ys, zs));
  for (const ys of SIDES) for (const zs of PAIRS) out.push(blockMaskFromRanges(FULL, ys, zs));
  for (const xs of PAIRS) for (const zs of SIDES) out.push(blockMaskFromRanges(xs, FULL, zs));
  for (const xs of SIDES) for (const zs of PAIRS) out.push(blockMaskFromRanges(xs, FULL, zs));
  for (const xs of PAIRS) for (const ys of SIDES) out.push(blockMaskFromRanges(xs, ys, FULL));
  for (const xs of SIDES) for (const ys of PAIRS) out.push(blockMaskFromRanges(xs, ys, FULL));
  return out;
}

// Canonical guided-target masks (fixed orientation, white-up / green-front):
export const MASK_222_DLF = blockMaskFromRanges([0, 1], [0, 1], [1, 2]); // down-left-front 2x2x2
export const MASK_223_BOTTOM_LEFT = blockMaskFromRanges([0, 1], [0, 1], [0, 1, 2]); // contains DLF block
export const MASK_123_LEFT = blockMaskFromRanges([0], [0, 1], [0, 1, 2]); // L-side 1x2x3 (Roux left)
export const MASK_123_RIGHT = blockMaskFromRanges([2], [0, 1], [0, 1, 2]); // R-side 1x2x3 (Roux right)

// Foundations-course masks: the beginner ladder around MASK_222_DLF's anchor
// corner (DLF — the orange-green-yellow corner). A *pair* is the corner plus
// ONE adjacent edge (a 1×1×2 box, two movable pieces); a *2×2×1* is the corner
// plus both of one face's edges on their centre (a 1×2×2 square — Lars Petrus's
// smallest named block). Each pair sits inside two of the squares, each square
// inside the 2×2×2 — the containment chain the course climbs.
export const MASK_PAIR_DF = blockMaskFromRanges([0, 1], [0], [2]); // DLF corner + DF edge
export const MASK_PAIR_DL = blockMaskFromRanges([0], [0], [1, 2]); // DLF corner + DL edge
export const MASK_PAIR_FL = blockMaskFromRanges([0], [0, 1], [2]); // DLF corner + FL edge
export const MASK_221_FRONT = blockMaskFromRanges([0, 1], [0, 1], [2]); // corner + DF + FL + F centre
export const MASK_221_BOTTOM = blockMaskFromRanges([0, 1], [0], [1, 2]); // corner + DF + DL + D centre
export const MASK_221_LEFT = blockMaskFromRanges([0], [0, 1], [1, 2]); // corner + DL + FL + L centre

// The 24 corner facelets (3 per corner). Used to blank corners on the EO view.
export const CORNER_FACELETS: number[] = (() => {
  const byCoord = new Map<string, number[]>();
  NET_COORDS.forEach((c, i) => {
    const k = c.join(',');
    (byCoord.get(k) ?? byCoord.set(k, []).get(k)!).push(i);
  });
  return [...byCoord.values()].filter((g) => g.length === 3).flat();
})();
