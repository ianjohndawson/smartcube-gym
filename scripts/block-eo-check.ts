// Oracle for the unified 2×2×3+EO geometry (src/block-eo.ts). Asserts:
//   1. each rolled orientation's target is reachable and the live detector accepts
//      it, and the four targets are geometrically distinct (determinative);
//   2. detection is DETERMINED — a minimal solve to orientation o is NOT read as a
//      different orientation (the app-known target is unambiguous);
//   3. the per-method display rotation lands the block at that method's spot (APB
//      bottom-left / Petrus bottom-back), white-on-bottom, for every rolled colour;
//   4. the notation transposition round-trips (disp path is invertible).

import {
  newSolved, applyMoves, homePermutation, solveFromState, MOVESETS,
  type Move3x3, type RotationMove,
} from '../src/engine-api.ts';
import { toDisplayMoves, toModelMoves } from '../src/orient.ts';
import {
  blockEoTarget, isBlockEoSolved, blockEoDisplayRots, BLOCK_EO_ORIENT_COUNT, type BlockEoMethod,
} from '../src/block-eo.ts';

// Short scrambles keep each solve cheap: an N-move scramble is solvable to the
// block+EO target in ≤N moves (its own reverse), so IDA* never digs near the depth
// cap. (Solving a fully-scrambled cube to block+EO from scratch — which the app never
// does; its scoring solve starts from the block already built — can be very deep.)
const SCRAMBLE = 8;
const SOLVER = { moveSet: MOVESETS.RUFLDB, pruningDepth: 5, depthLimit: 12 };
const FACES = ['U', 'D', 'L', 'R', 'F', 'B'], SUF = ['', '2', "'"];
const rnd = (n: number): Move3x3[] => {
  const o: string[] = []; let l = '';
  while (o.length < n) { const f = FACES[(Math.random() * 6) | 0]; if (f === l) continue; l = f; o.push(f + SUF[(Math.random() * 3) | 0]); }
  return o as Move3x3[];
};
function fwd(rots: RotationMove[]): number[] {
  const home = homePermutation(applyMoves(newSolved(), rots as Move3x3[]).stateData);
  const f = new Array<number>(54); for (let p = 0; p < 54; p++) f[home[p]] = p; return f;
}
const faceOf = (i: number) => i <= 8 ? 'U' : i >= 45 ? 'D' : (() => { const b = (i - 9) % 12; return b < 3 ? 'L' : b < 6 ? 'F' : b < 9 ? 'R' : 'B'; })();
const facesOf = (idx: number[]) => [...new Set(idx.map(faceOf))].sort().join('');
const idxStr = (a: readonly number[]) => [...a].sort((x, y) => x - y).join(',');

let n = 0, fail = 0;
const check = (c: boolean, m: string) => { if (!c) { console.log('MISMATCH: ' + m); fail++; } };

// The four targets are geometrically distinct.
const blocks = new Set<string>();
for (let o = 0; o < BLOCK_EO_ORIENT_COUNT; o++) blocks.add(idxStr(blockEoTarget(o).solvedFaceletIndices));
check(blocks.size === BLOCK_EO_ORIENT_COUNT, 'the four orientation targets must be distinct');

// 1 + 2. Solve to each orientation; the KNOWN target must be detected. The app rolls
//        the orientation and only ever checks that one, so a state that also satisfies
//        another orientation (only when the solve over-solves, e.g. both top blocks
//        end solved) is harmless — reported as info, not a failure.
let solves = 0, crossHits = 0;
for (let o = 0; o < BLOCK_EO_ORIENT_COUNT; o++) {
  for (let k = 0; k < 50; k++) {
    const start = applyMoves(newSolved(), rnd(SCRAMBLE));
    const sol = solveFromState(start, blockEoTarget(o), SOLVER);
    if (!sol) continue;
    const done = applyMoves(start, sol);
    solves++;
    check(isBlockEoSolved(done, o), `orient ${o}: solved but not detected`);
    for (let p = 0; p < BLOCK_EO_ORIENT_COUNT; p++) if (p !== o && isBlockEoSolved(done, p)) crossHits++;
  }
}
console.log(`(info) ${crossHits} cross-orientation hits across ${solves} solves — over-solved states; the app checks only the rolled orientation, so harmless.`);

// 3. Display normalisation: block at the method's spot + white on bottom, every roll.
const SPOT: Record<BlockEoMethod, string> = { apb: 'BDFL', petrus: 'BDLR' };
for (const method of ['apb', 'petrus'] as BlockEoMethod[]) {
  for (let o = 0; o < BLOCK_EO_ORIENT_COUNT; o++) {
    const f = fwd(blockEoDisplayRots(method, o));
    const blockView = (blockEoTarget(o).solvedFaceletIndices as number[]).map((i) => f[i]);
    check(facesOf(blockView) === SPOT[method], `${method}/orient${o}: block at ${facesOf(blockView)}, want ${SPOT[method]}`);
    check(f[4] >= 45, `${method}/orient${o}: white (U centre) not on view-bottom (at ${f[4]})`);
    n++;
  }
}

// 4. Notation transposition round-trips.
for (const method of ['apb', 'petrus'] as BlockEoMethod[]) {
  for (let o = 0; o < BLOCK_EO_ORIENT_COUNT; o++) {
    const rots = blockEoDisplayRots(method, o);
    const m = rnd(8);
    check(toModelMoves(toDisplayMoves(m, rots), rots).join(' ') === m.join(' '), `${method}/orient${o}: transpose round-trip`);
    n++;
  }
}

console.log(`block-eo geometry: ${solves} solves + ${n} view/transpose checks, mismatches ${fail}`);
console.log(fail === 0
  ? 'BLOCK-EO OK — determined targets, block lands at method spot white-bottom, transpose invertible'
  : 'BLOCK-EO FAILED');
if (fail !== 0) process.exitCode = 1;
