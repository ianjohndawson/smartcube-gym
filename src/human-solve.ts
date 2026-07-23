// Pedagogical (human) solving for the Learn walkthrough + hint focus piece.
//
// The global optimal is the right ruler for *scoring* but a poor *teacher* for
// blocks: empirically it's regrip-maximal and leans on back/bottom (D/B) moves a
// learner can't see or turn. This module produces the trail Learn actually walks:
//
//   • 2×2×2 (any placement) — the human-RANKED optimal. There are ~150+ equally-
//     short optimal solutions; we pick the one with the fewest D/B moves (and
//     face switches). Free win: same length as optimal, ~0 awkward moves.
//
//   • 2×2×3 / side 1×2×3 (any placement) — BUILD-THEN-EXTEND. The optimal here
//     is nearly forced and stays awkward, so we instead build a clean (ranked)
//     milestone first — a contained 2×2×2 for a 2×2×3, a contained 1×2×2 square
//     for a 1×2×3 — then rank a short extension. This costs a few moves over
//     optimal but teaches the method's actual structure (exactly Lars Petrus's
//     Step 1 → Step 2). Scoring still uses the true optimal (engine-api), so
//     the efficiency gap stays visible. Of the two possible milestones we take
//     the one the cube is already closer to (placement-aware coaching can enter
//     mid-build); tie → the front/top one, the classic route.
//
//   • Everything else — plain optimal, unchanged. Masks carrying
//     eoFaceletIndices are NEVER specialised: the block-keeping EO steps reuse a
//     block's exact solvedFaceletIndices, and routing them through block
//     pedagogy was a real bug (see scripts/human-solve-eo-check.ts). Middle-slab
//     1×2×3s (centre layer, no corner anchor) also fall through.
//
// The family and its milestones are derived from the mask's own box geometry,
// so this works for ANY placement — not just the canonical bottom-left the old
// hand-written table covered. Guarded by scripts/human-solve-blocks-check.ts
// (reaches the target + actually passes through a milestone) and
// scripts/human-solve-eo-check.ts (EO masks stay byte-identical to optimal).
//
// Drop-in for solveFromState: same (cube, mask, cfg) signature, returns the
// pedagogical trail or null (caller can fall back). A milestone that is already
// built is skipped, so mid-solve and pre-built-prereq drills walk only the
// remaining work.

import { blockMaskFromRanges, NET_COORDS } from './blocks.ts';
import { scorePlacement } from './placement.ts';
import {
  applyMoves,
  isMaskSolvedState,
  solveFromState,
  solveFromStateMulti,
  type Cube3x3,
  type Cube3x3Mask,
  type Move3x3,
  type StepSolverConfig,
} from './engine-api.ts';

// How many optimal solutions to rank over. The multi-solver returns a band of
// lengths (optimal .. optimal+2); RANK_COUNT just needs to be wide enough to
// include comfortable alternatives. The pruning table is cached, so this is cheap.
const RANK_COUNT = 96;
// Length slack above optimal we'll accept to dodge awkward moves. The comfort
// win lives in this band; the 2×2×2 has many such routes, which is why the
// staged 2×2×3 (built on a comfortable 2×2×2) can avoid back/bottom moves at all.
const SLACK = 2;

// Cubie coords that carry facelets — the core (1,1,1) doesn't — for validating
// that a mask covers a FULL box below.
const FACELET_COORDS = new Set(NET_COORDS.map((c) => c.join(',')));

// Per-axis sorted coordinate values of the box a mask covers.
type BlockBox = [number[], number[], number[]];

// Reconstruct the axis-aligned box a mask covers from its facelets' cubie
// coords, or null when the mask isn't a plain, contiguous, full box (or carries
// EO) — those must route to plain optimal.
function boxOf(mask: Cube3x3Mask): BlockBox | null {
  if (mask.eoFaceletIndices?.length) return null;
  if (mask.solvedFaceletIndices.length === 0) return null;
  const vals = [new Set<number>(), new Set<number>(), new Set<number>()];
  const covered = new Set<string>();
  for (const i of mask.solvedFaceletIndices) {
    const c = NET_COORDS[i];
    vals[0].add(c[0]);
    vals[1].add(c[1]);
    vals[2].add(c[2]);
    covered.add(c.join(','));
  }
  const ax = vals.map((s) => [...s].sort((a, b) => a - b)) as BlockBox;
  for (const a of ax) if (a[a.length - 1] - a[0] !== a.length - 1) return null; // contiguous only
  let inBox = 0;
  for (const x of ax[0]) for (const y of ax[1]) for (const z of ax[2]) {
    if (FACELET_COORDS.has(`${x},${y},${z}`)) inBox++;
  }
  if (covered.size !== inBox) return null; // holes → not a full box
  return ax;
}

// Family key: sorted axis sizes ('222', '223', '123', '122', …).
function familyOf(box: BlockBox): string {
  return box.map((a) => a.length).sort((a, b) => a - b).join('');
}

// The two candidate milestones of a long-axis box: the long axis restricted to
// its higher pair first (front/top — the classic route), then the lower pair.
// 2×2×3 → its two contained 2×2×2s; side 1×2×3 → its two 1×2×2 squares.
function milestonesOf(box: BlockBox): [Cube3x3Mask, Cube3x3Mask] {
  const long = box.findIndex((a) => a.length === 3);
  const sub = (pair: number[]) => {
    const r = box.map((a, i) => (i === long ? pair : a)) as BlockBox;
    return blockMaskFromRanges(r[0], r[1], r[2]);
  };
  return [sub([1, 2]), sub([0, 1])];
}

// Comfort cost (lower = friendlier). D/B moves (hard to see/turn) dominate, so
// a back/bottom-free route always wins even at +1/+2 length; among equally
// comfortable routes prefer the shorter, then fewer face switches (regrips).
function comfortCost(sol: Move3x3[]): number {
  let dB = 0;
  let switches = 0;
  for (let i = 0; i < sol.length; i++) {
    const f = sol[i][0];
    if (f === 'D' || f === 'B') dB++;
    if (i > 0 && f !== sol[i - 1][0]) switches++;
  }
  return dB * 100 + sol.length * 2 + switches;
}

/** Most comfortable solution within (optimal + SLACK) moves, or null if none.
 *  Bounding to the band keeps the length cost small while letting us trade a
 *  couple of moves to eliminate back/bottom turns. */
function rankedComfort(cube: Cube3x3, mask: Cube3x3Mask, cfg: StepSolverConfig, rankCount: number): Move3x3[] | null {
  const sols = solveFromStateMulti(cube, mask, cfg, rankCount);
  if (sols.length === 0) return null;
  let minLen = Infinity;
  for (const s of sols) if (s.length < minLen) minLen = s.length;
  let best: Move3x3[] | null = null;
  let bestCost = Infinity;
  for (const s of sols) {
    if (s.length > minLen + SLACK) continue; // bound the length cost
    const c = comfortCost(s);
    if (c < bestCost) {
      best = s;
      bestCost = c;
    }
  }
  return best;
}

/**
 * Pedagogical trail from `cube` to `mask`. Drop-in replacement for
 * solveFromState at the Learn / focus-piece call sites. Returns null only when
 * the optimal solver itself finds nothing (caller falls back).
 */
export function humanSolveFromState(
  cube: Cube3x3,
  mask: Cube3x3Mask,
  cfg: StepSolverConfig,
  // How many optimal-band solutions to rank comfort over. The default gives the
  // teaching surfaces the best route; bulk callers (case generation samples
  // dozens of scrambles) pass a small count — same route structure, ~10× cheaper.
  rankCount = RANK_COUNT,
): Move3x3[] | null {
  const box = boxOf(mask);
  if (!box) return solveFromState(cube, mask, cfg); // EO / irregular: plain optimal
  const family = familyOf(box);

  // Single-stage ranked families: the 2×2×2, the 1×2×2 square and the 1×1×2
  // corner–edge pair (the Foundations course's first two rungs).
  if (family === '222' || family === '122' || family === '112') {
    return rankedComfort(cube, mask, cfg, rankCount) ?? solveFromState(cube, mask, cfg);
  }
  if (family !== '223' && family !== '123') return solveFromState(cube, mask, cfg);
  if (family === '123') {
    // Middle-slab 1×2×3 (single axis in the centre layer): not a training
    // target — no corner anchor, no meaningful milestone.
    const one = box.find((a) => a.length === 1)![0];
    if (one === 1) return solveFromState(cube, mask, cfg);
  }

  // Two-stage build-then-extend; skip stage 1 if a milestone is already built
  // (mid-solve, or a pre-built prereq drill).
  const [front, back] = milestonesOf(box);
  const sf = scorePlacement(cube, front);
  const sb = scorePlacement(cube, back);
  const via = sb.placed > sf.placed || (sb.placed === sf.placed && sb.matched > sf.matched) ? back : front;
  const stage1 = isMaskSolvedState(cube, via) ? [] : rankedComfort(cube, via, cfg, rankCount);
  if (stage1 === null) return solveFromState(cube, mask, cfg); // milestone unsolvable → fall back
  const mid = applyMoves(cube, stage1);
  const stage2 = rankedComfort(mid, mask, cfg, rankCount);
  if (stage2 === null) return solveFromState(cube, mask, cfg);

  const trail = [...stage1, ...stage2];
  // Safety: the staged trail must actually reach the goal; if not, fall back.
  if (!isMaskSolvedState(applyMoves(cube, trail), mask)) return solveFromState(cube, mask, cfg);
  return trail;
}
