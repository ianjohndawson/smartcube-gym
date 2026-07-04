// Pedagogical (human) solving for the Learn walkthrough + hint focus piece.
//
// The global optimal is the right ruler for *scoring* but a poor *teacher* for
// blocks: empirically it's regrip-maximal and leans on back/bottom (D/B) moves a
// learner can't see or turn. This module produces the trail Learn actually walks:
//
//   • 2×2×2  — the human-RANKED optimal. There are ~150+ equally-short optimal
//     solutions; we pick the one with the fewest D/B moves (and face switches).
//     Free win: same length as optimal, ~0 awkward moves.
//
//   • 2×2×3 / 1×2×3 — BUILD-THEN-EXTEND. The optimal here is nearly forced and
//     stays awkward, so we instead build a clean (ranked) milestone first — the
//     2×2×2 for a 2×2×3, the 1×2×2 square for a 1×2×3 — then rank a short
//     extension. This costs a few moves over optimal but teaches the method's
//     actual structure (exactly Lars Petrus's Step 1 → Step 2). Scoring still
//     uses the true optimal (engine-api), so the efficiency gap stays visible.
//
//   • Everything else (EO, EOLine, EOCross, non-standard block orientations) —
//     plain optimal, unchanged. The EO trainer is untouched.
//
// Drop-in for solveFromState: same (cube, mask, cfg) signature, returns the
// pedagogical trail or null (caller can fall back). Hops whose milestone is
// already built are skipped, so mid-solve and pre-built-prereq drills walk only
// the remaining work.

import {
  blockMaskFromRanges,
  MASK_123_LEFT,
  MASK_222_DLF,
  MASK_223_BOTTOM_LEFT,
} from './blocks.ts';
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

// The 1×2×2 left square — the milestone built before a 1×2×3 first block.
const SQUARE_1x2x2 = blockMaskFromRanges([0], [0, 1], [1, 2]);

// Signature of a mask for the pedagogy tables below. MUST include the EO orbit:
// the block-preserving EO masks (MASK_223_EO etc.) reuse a block's exact
// solvedFaceletIndices array, so keying on placement alone collides them with the
// pure block mask — routing an EO step through block build-then-extend pedagogy.
// EO edges make the key distinct, so EO steps fall through to plain optimal (which
// is what this module intends for EO — see the header).
function sig(m: Cube3x3Mask): string {
  return [...m.solvedFaceletIndices].sort((a, b) => a - b).join(',') +
    '|' + [...(m.eoFaceletIndices ?? [])].sort((a, b) => a - b).join(',');
}

// Optional milestone to build first (build-then-extend). Keyed by canonical mask.
const VIA = new Map<string, Cube3x3Mask>([
  [sig(MASK_223_BOTTOM_LEFT), MASK_222_DLF], // 2×2×3: build the 2×2×2 first
  [sig(MASK_123_LEFT), SQUARE_1x2x2], //        1×2×3: build the 1×2×2 square first
]);
// Block masks we human-rank even single-stage (the free win). 2×2×2 + the via masks.
const RANKED = new Set<string>([
  sig(MASK_222_DLF),
  sig(MASK_223_BOTTOM_LEFT),
  sig(MASK_123_LEFT),
  sig(SQUARE_1x2x2),
]);

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
function rankedComfort(cube: Cube3x3, mask: Cube3x3Mask, cfg: StepSolverConfig): Move3x3[] | null {
  const sols = solveFromStateMulti(cube, mask, cfg, RANK_COUNT);
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
): Move3x3[] | null {
  const key = sig(mask);

  // Not a block mask we specialise (EO et al.) — plain optimal, unchanged.
  if (!RANKED.has(key)) return solveFromState(cube, mask, cfg);

  const via = VIA.get(key);
  if (!via) {
    // Single-stage: human-ranked optimal (the 2×2×2 free win).
    return rankedComfort(cube, mask, cfg) ?? solveFromState(cube, mask, cfg);
  }

  // Two-stage build-then-extend. Skip stage 1 if the milestone is already built
  // (mid-solve, or a pre-built prereq drill).
  const stage1 = isMaskSolvedState(cube, via) ? [] : rankedComfort(cube, via, cfg);
  if (stage1 === null) return solveFromState(cube, mask, cfg); // milestone unsolvable → fall back
  const mid = applyMoves(cube, stage1);
  const stage2 = rankedComfort(mid, mask, cfg);
  if (stage2 === null) return solveFromState(cube, mask, cfg);

  const trail = [...stage1, ...stage2];
  // Safety: the staged trail must actually reach the goal; if not, fall back.
  if (!isMaskSolvedState(applyMoves(cube, trail), mask)) return solveFromState(cube, mask, cfg);
  return trail;
}
