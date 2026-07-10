// Placement-aware candidate selection for block steps.
//
// Block completion accepts a block built in ANY of a step's candidate
// placements (main.ts solvedStepMask), but coaching used to aim at the
// canonical placement only — so a solver building anywhere else saw a progress
// meter stuck at zero and hints telling them to abandon a perfectly good
// block. This module decides WHICH placement the user is actually going for,
// so progress, the ideal count, hints and Learn can follow the user.
//
// The pick is deliberately conservative (hysteresis): the incumbent placement
// keeps the job unless a challenger has STRICTLY more whole pieces placed.
// Whole pieces — not facelet matches — because facelet counts fluctuate with
// every turn of a scrambled cube and would make the coaching target flap
// mid-solve. When nothing is decided yet (step start, all zeros), ties fall
// back to facelet matches, then the caller's preferred index (the canonical
// placement today; a user-committed pick once inspection training exists).
//
// Pure geometry over the live cube state — no app state, no solver calls.
// Guarded by scripts/placement-check.ts (invariants: the pick always carries
// the max placed count; it changes only when strictly beaten; finishing any
// candidate means the pick's own mask is solved).

import { SOLVED_FACELET_CUBE, type Cube3x3, type Cube3x3Mask } from './engine-api.ts';
import { NET_COORDS } from './blocks.ts';

// Facelets grouped into movable cubies (pieces): coordinate groups with more
// than one facelet. Centres are fixed and carry no placement signal.
const PIECES: number[][] = (() => {
  const by = new Map<string, number[]>();
  NET_COORDS.forEach((c, i) => {
    const k = c.join(',');
    (by.get(k) ?? by.set(k, []).get(k)!).push(i);
  });
  return [...by.values()].filter((g) => g.length > 1);
})();

// The pieces a mask covers, cached by mask identity — candidate masks are
// module-level constants (steps.ts), so identity is stable for the app's life.
const piecesCache = new WeakMap<Cube3x3Mask, number[][]>();
function piecesFor(mask: Cube3x3Mask): number[][] {
  let p = piecesCache.get(mask);
  if (!p) {
    const set = new Set(mask.solvedFaceletIndices);
    p = PIECES.filter((g) => g.some((i) => set.has(i)));
    piecesCache.set(mask, p);
  }
  return p;
}

export interface PlacementScore {
  placed: number; // whole pieces of the mask sitting solved
  total: number; // pieces the mask covers
  matched: number; // mask facelets currently showing their solved colour
}

export function scorePlacement(cube: Cube3x3, mask: Cube3x3Mask): PlacementScore {
  const f = cube.stateData;
  const pieces = piecesFor(mask);
  let placed = 0;
  for (const g of pieces) if (g.every((i) => f[i] === SOLVED_FACELET_CUBE[i])) placed++;
  let matched = 0;
  for (const i of mask.solvedFaceletIndices) if (f[i] === SOLVED_FACELET_CUBE[i]) matched++;
  return { placed, total: pieces.length, matched };
}

/** Index of `canonical` within `candidates` (by facelet signature), or 0. */
export function canonicalIndexIn(candidates: Cube3x3Mask[], canonical: Cube3x3Mask): number {
  const sig = (m: Cube3x3Mask) => [...m.solvedFaceletIndices].sort((a, b) => a - b).join(',');
  const want = sig(canonical);
  const at = candidates.findIndex((m) => sig(m) === want);
  return at >= 0 ? at : 0;
}

/**
 * The placement the user is currently building. `prev` threads the last pick
 * (null at step start); `preferred` seeds the incumbent before any signal
 * exists. Returns an index into `candidates`.
 */
export function activePlacement(
  cube: Cube3x3,
  candidates: Cube3x3Mask[],
  prev: number | null,
  preferred: number,
): number {
  if (candidates.length <= 1) return 0;
  const clamp = (i: number) => Math.min(Math.max(i, 0), candidates.length - 1);
  const incumbent = clamp(prev ?? preferred);
  const scores = candidates.map((m) => scorePlacement(cube, m));
  let maxPlaced = 0;
  for (const s of scores) if (s.placed > maxPlaced) maxPlaced = s.placed;
  // Hysteresis: the incumbent holds the job unless strictly beaten.
  if (scores[incumbent].placed >= maxPlaced) return incumbent;
  let best = -1;
  for (let i = 0; i < candidates.length; i++) {
    if (scores[i].placed !== maxPlaced) continue;
    if (best === -1 || scores[i].matched > scores[best].matched) best = i;
  }
  return best;
}
