// Oracle: the pedagogy router (humanSolveFromState) must NOT send the block-
// preserving EO steps through block build-then-extend pedagogy. Their masks reuse a
// block's exact solvedFaceletIndices, so before the sig() fix they collided with the
// pure block mask and took the wrong branch. EO steps must fall through to PLAIN
// OPTIMAL (byte-identical to solveFromState); real block steps keep staged pedagogy.
//
// States are built by applying a short random sequence to solved, so a solution to
// the (subset) mask is always reachable within the step's depth limit.

import { newSolved, applyMoves, solveFromState, isMaskSolvedState, type Move3x3 } from '../src/engine-api.ts';
import { humanSolveFromState } from '../src/human-solve.ts';
import { genScramble, TRAINERS, type StepDef } from '../src/steps.ts';

const stepById = (id: string): StepDef => TRAINERS.flatMap((t) => t.steps).find((s) => s.id === id)!;
const eq = (a: Move3x3[], b: Move3x3[]) => a.length === b.length && a.every((m, i) => m === b[i]);

let n = 0, fail = 0;

// Block-preserving EO steps: humanSolve must equal plain optimal, and reach the mask.
// (eo223 is now the unified 2×2×3+EO, whose canonicalMask carries the orient-0 EO orbit.)
for (const id of ['eo123', 'eo223', 'petrus-eo']) {
  const step = stepById(id);
  const mask = step.canonicalMask;
  for (let t = 0; t < 40; t++) {
    const cube = applyMoves(newSolved(), genScramble(10));
    const o = solveFromState(cube, mask, step.solver);
    if (!o) continue; // unreachable within depth — skip
    const h = humanSolveFromState(cube, mask, step.solver);
    n++;
    if (!h || !eq(h, o)) { console.log(`ROUTING ${id}: humanSolve != plain optimal (${h?.length} vs ${o.length})`); fail++; continue; }
    if (!isMaskSolvedState(applyMoves(cube, h), mask)) { console.log(`REACH ${id}: humanSolve doesn't reach the EO mask`); fail++; }
  }
}

// Sanity: a genuine block step still routes through its pedagogy and reaches the block.
const blk = stepById('223');
for (let t = 0; t < 20; t++) {
  const cube = applyMoves(newSolved(), genScramble(9));
  const o = solveFromState(cube, blk.canonicalMask, blk.solver);
  if (!o) continue;
  const h = humanSolveFromState(cube, blk.canonicalMask, blk.solver);
  n++;
  if (!h || !isMaskSolvedState(applyMoves(cube, h), blk.canonicalMask)) { console.log('BLOCK 223: humanSolve broken'); fail++; }
}

console.log(`human-solve routing: ${n} checks, mismatches ${fail}`);
console.log(fail === 0
  ? 'HUMAN-SOLVE EO OK — EO steps use plain optimal; block pedagogy intact'
  : 'HUMAN-SOLVE EO FAILED');
if (fail !== 0) process.exitCode = 1;
