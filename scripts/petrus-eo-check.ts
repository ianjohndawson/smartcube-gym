// Verify the Petrus EO step: from a scramble, solve to the 2×2×3, then to the
// combined 2×2×3+EO target. Assert the block survives, all edges end oriented,
// and report solution-length distribution (so we know the depth limit is enough).
import { newSolved, applyMoves, optimalToMask, isMaskSolvedState, MOVESETS, type Cube3x3Mask, type Move3x3 } from '../src/engine-api.ts';
import { MASKS } from '../src/engine/puzzles/cube3x3/index.ts';
import { MASK_223_BOTTOM_LEFT, blockMaskFromRanges } from '../src/blocks.ts';

const FACES = ['U', 'D', 'L', 'R', 'F', 'B'], SUF = ['', '2', "'"];
function genScramble(n = 16): string[] {
  const out: string[] = [];
  let last = '';
  while (out.length < n) {
    const f = FACES[Math.floor(Math.random() * 6)];
    if (f === last) continue;
    last = f;
    out.push(f + SUF[Math.floor(Math.random() * 3)]);
  }
  return out;
}

const MASK_222 = blockMaskFromRanges([0, 1], [0, 1], [1, 2]); // DLF, mirrors blocks.ts
const MASK_223: Cube3x3Mask = MASK_223_BOTTOM_LEFT;
const MASK_223_EO: Cube3x3Mask = {
  solvedFaceletIndices: MASK_223_BOTTOM_LEFT.solvedFaceletIndices,
  eoFaceletIndices: MASKS.EO.eoFaceletIndices!,
};
const S222 = { moveSet: MOVESETS.RUFLDB, pruningDepth: 4, depthLimit: 11 };
const S223 = { moveSet: MOVESETS.RUFLDB, pruningDepth: 4, depthLimit: 14 };
const SEO = { moveSet: MOVESETS.RUFLDB, pruningDepth: 5, depthLimit: 14 };

const N = 40;
let ok = 0, blockKept = 0, eoFail = 0, skip = 0;
const lens: number[] = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  // Solve incrementally, exactly as the app's chained journey does.
  let hist = genScramble(16) as Move3x3[];
  const s222 = optimalToMask(hist, MASK_222, S222);
  if (!s222 || !s222.length) { skip++; continue; }
  hist = [...hist, ...s222];
  const s223 = optimalToMask(hist, MASK_223, S223);
  if (!s223 || !s223.length || !isMaskSolvedState(applyMoves(newSolved(), hist.concat(s223)), MASK_223)) { skip++; continue; }
  hist = [...hist, ...s223];

  const solEO = optimalToMask(hist, MASK_223_EO, SEO);
  if (!solEO || !solEO.length) { eoFail++; continue; }
  lens.push(solEO.length);
  const cubeEO = applyMoves(newSolved(), hist.concat(solEO));
  const eoGood = isMaskSolvedState(cubeEO, MASK_223_EO);
  const blkGood = isMaskSolvedState(cubeEO, MASK_223);
  if (eoGood) ok++; else eoFail++;
  if (blkGood) blockKept++;
}
lens.sort((a, b) => a - b);
const avg = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
console.log(`Petrus EO: ${ok}/${N - skip} solvable reached 223+EO, block kept ${blockKept}/${lens.length}, eoFail ${eoFail}, skipped(depth) ${skip}`);
console.log(`EO-step length: min ${lens[0]}, max ${lens[lens.length - 1]}, avg ${avg.toFixed(1)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
