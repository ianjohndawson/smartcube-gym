// Oracle for placement-aware candidate selection (src/placement.ts).
//
// Replays real solves move-by-move, threading the previous pick exactly the way
// main.ts will, and asserts the module's contract:
//   I1 the pick always carries the family's max placed-piece count;
//   I2 the pick changes ONLY when the previous pick is strictly beaten on whole
//      pieces (the hysteresis contract — drop hysteresis and this fires on the
//      first placed-count tie);
//   I3 after optimally solving a randomly chosen candidate, the pick's own mask
//      is solved (strong form when every candidate has the same piece total —
//      true for all app families since steps use side123Masks; the guarded form
//      placed==total ⟹ solved covers mixed-total candidate sets generally);
//   I4 single-candidate steps always pick index 0, and picks are deterministic.
// A random-walk phase after each solve re-asserts I1/I2 on messy states.

import {
  applyMove, applyMoves, isMaskSolvedState, newSolved, solveFromState, MOVESETS,
  type Cube3x3Mask, type Move3x3,
} from '../src/engine-api.ts';
import { activePlacement, canonicalIndexIn, scorePlacement } from '../src/placement.ts';
import {
  all222Masks, all223Masks, side123Masks,
  MASK_123_LEFT, MASK_222_DLF, MASK_223_BOTTOM_LEFT,
} from '../src/blocks.ts';

const SCRAMBLE = 10; // short keeps IDA* cheap: a solution never exceeds the scramble
const WALK = 20;

const FACES = ['U', 'D', 'L', 'R', 'F', 'B'], SUF = ['', '2', "'"];
const rnd = (n: number): Move3x3[] => {
  const o: string[] = []; let l = '';
  while (o.length < n) { const f = FACES[(Math.random() * 6) | 0]; if (f === l) continue; l = f; o.push(f + SUF[(Math.random() * 3) | 0]); }
  return o as Move3x3[];
};

let fail = 0;
const check = (c: boolean, m: string) => { if (!c) { console.log('MISMATCH: ' + m); fail++; } };

// 223 solves use pruningDepth 5 like the app (a pd-4 table lets the vendored
// solver's 1e6-node budget run out on depth-9+ cases → spurious nulls), and a
// fixed target subset so the harness builds 6 pruning tables, not all 12.
interface Family {
  name: string; candidates: Cube3x3Mask[]; canonical: Cube3x3Mask; trials: number;
  uniformTotals: boolean; pd: number; targets?: number[];
}
const FAMILIES: Family[] = [
  { name: '222', candidates: all222Masks(), canonical: MASK_222_DLF, trials: 40, uniformTotals: true, pd: 4 },
  { name: '223', candidates: all223Masks(), canonical: MASK_223_BOTTOM_LEFT, trials: 30, uniformTotals: true, pd: 5, targets: [0, 2, 4, 6, 8, 10] },
  { name: '123', candidates: side123Masks(), canonical: MASK_123_LEFT, trials: 25, uniformTotals: true, pd: 4 },
];

let solves = 0, movesChecked = 0;

for (const fam of FAMILIES) {
  const { candidates } = fam;
  const preferred = canonicalIndexIn(candidates, fam.canonical);
  check(
    [...candidates[preferred].solvedFaceletIndices].sort((a, b) => a - b).join(',') ===
    [...fam.canonical.solvedFaceletIndices].sort((a, b) => a - b).join(','),
    `${fam.name}: canonicalIndexIn must find the canonical placement`,
  );

  const solver = { moveSet: MOVESETS.RUFLDB, pruningDepth: fam.pd, depthLimit: 14 };
  const pool = fam.targets ?? candidates.map((_, i) => i);
  for (let t = 0; t < fam.trials; t++) {
    let cube = applyMoves(newSolved(), rnd(SCRAMBLE));
    const targetIdx = pool[(Math.random() * pool.length) | 0];
    const sol = solveFromState(cube, candidates[targetIdx], solver) ?? [];
    let prev: number | null = null;

    const stepAndAssert = (m: Move3x3, phase: string) => {
      cube = applyMove(cube, m);
      const pick = activePlacement(cube, candidates, prev, preferred);
      const pick2 = activePlacement(cube, candidates, prev, preferred);
      check(pick === pick2, `${fam.name} ${phase}: pick must be deterministic`);
      const scores = candidates.map((c) => scorePlacement(cube, c));
      const max = Math.max(...scores.map((s) => s.placed));
      check(scores[pick].placed === max, `${fam.name} ${phase}: pick placed ${scores[pick].placed} < max ${max}`);
      if (prev != null && pick !== prev) {
        check(scores[pick].placed > scores[prev].placed,
          `${fam.name} ${phase}: switched ${prev}->${pick} without strict improvement`);
      }
      prev = pick;
      movesChecked++;
    };

    for (const m of sol) stepAndAssert(m, 'solve');
    solves++;

    // End of the optimal solve: the chosen candidate is genuinely built…
    check(isMaskSolvedState(cube, candidates[targetIdx]), `${fam.name}: solver failed to build the target`);
    // …and the pick reflects a finished block (strong / guarded per family).
    if (sol.length > 0 && prev != null) {
      const s = scorePlacement(cube, candidates[prev]);
      if (fam.uniformTotals) {
        check(isMaskSolvedState(cube, candidates[prev]), `${fam.name}: finished, but the pick's mask is not solved`);
      } else if (s.placed === s.total) {
        check(isMaskSolvedState(cube, candidates[prev]), `${fam.name}: placed==total must mean the pick's mask is solved`);
      }
    }

    for (const m of rnd(WALK)) stepAndAssert(m, 'walk');
  }

  // I4: pinned steps (single candidate) always pick 0.
  const one = applyMoves(newSolved(), rnd(SCRAMBLE));
  check(activePlacement(one, [candidates[0]], 3, 5) === 0, `${fam.name}: single-candidate step must pick 0`);
}

console.log(`placement: ${solves} solves + walks, ${movesChecked} per-move checks, mismatches ${fail}`);
if (fail > 0) { console.log('PLACEMENT FAIL'); process.exitCode = 1; }
else console.log('PLACEMENT OK — max-placed pick, hysteresis holds, finished blocks are picked');
