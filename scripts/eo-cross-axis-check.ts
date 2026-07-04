// Oracle: free-EO line/cross placement is on the WHITE (model-U) face, matching
// the yellow-top solve view (the cross/line is built on the bottom of what you see).
//
// For each side axis (gb/ro) and many random scrambles we assert two things:
//   1. the placement target lives entirely on the WHITE (model-U) face — NOT the
//      old yellow (D) face (the "white cross on bottom" convention; this was the
//      EOCross "doesn't recognise EO + cross done" bug);
//   2. solving to the live free-EO mask yields a state the cheap live detector
//      (isEoSolvedFromState) agrees is solved on that axis.
//
// The oracle for (1) is the U-face facelet geometry, independent of the eo-axis tables.

import { newSolved, applyMoves, isEoSolvedFromState, solveFromState, type Move3x3 } from '../src/engine-api.ts';
import { eoMaskForStep } from '../src/eo-axis.ts';
import { TRAINERS } from '../src/steps.ts';

const FACES = ['U', 'D', 'L', 'R', 'F', 'B'], SUF = ['', '2', "'"];
const rnd = (n: number): Move3x3[] => {
  const o: string[] = []; let l = '';
  while (o.length < n) { const f = FACES[Math.floor(Math.random() * 6)]; if (f === l) continue; l = f; o.push(f + SUF[Math.floor(Math.random() * 3)]); }
  return o as Move3x3[];
};

// White (U) cross facelet set, centres-free — the convention guard: the free-EO
// placement target must live entirely here (a white cross on the bottom of the
// yellow-top view), never on the old yellow (D) face.
const U_CROSS = new Set([1, 3, 5, 7, 10, 13, 16, 19]);

const crossStep = TRAINERS.find(t => t.id === 'eocross')!.steps[0];
const lineStep = TRAINERS.find(t => t.id === 'eoline')!.steps[0];

let n = 0, fail = 0;
for (const step of [crossStep, lineStep]) {
  for (const axis of ['gb', 'ro'] as const) {
    const mask = eoMaskForStep(step, axis);
    // The placement target must live entirely on the white (U) face.
    if (!(mask.solvedFaceletIndices as number[]).every(i => U_CROSS.has(i))) {
      console.log(`MASK ${step.id}/${axis} not on white face:`, mask.solvedFaceletIndices); fail++;
    }
    for (let t = 0; t < 120; t++) {
      const start = applyMoves(newSolved(), rnd(12));
      const sol = solveFromState(start, mask, step.solver);
      if (!sol) continue; // unreachable within depth — skip (rare)
      const done = applyMoves(start, sol);
      n++;
      // The live cheap detector must agree the step is solved on this axis.
      if (!isEoSolvedFromState(done, mask)) { console.log(`undetected ${step.id}/${axis}`); fail++; }
    }
  }
}
console.log(`checks ${n}, mismatches ${fail}`);
console.log(fail === 0 ? 'EO-CROSS AXIS OK — placement on white face, live detector agrees' : 'EO-CROSS AXIS FAILED');
if (fail !== 0) process.exitCode = 1;
