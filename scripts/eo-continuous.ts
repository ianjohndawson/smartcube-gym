import { applyMoves, newSolved, optimalToMask, MOVESETS, parseMoves, type Move3x3 } from '../src/engine-api.ts';
import { MASKS } from '../src/engine/puzzles/cube3x3/index.ts';
import { genScramble } from '../src/steps.ts';
const EO = MASKS.EO as any; const cfg = { moveSet: MOVESETS.RUFLDB, pruningDepth:4, depthLimit:8 };
const N = 4000;
// Simulate continuous reps: start from a (messy permutation, EO-good) state,
// then apply a SHORT scramble of length L and measure the EO distribution.
for (const L of [10, 14, 18, 22]) {
  const h: Record<number, number> = {}; let sum = 0;
  for (let i=0;i<N;i++){
    // make a messy state then solve its EO -> messy perm, EO good
    let hist = genScramble(30);
    const sol = optimalToMask(hist, EO, cfg) ?? [];
    hist = [...hist, ...sol]; // EO now good, permutation messy
    // apply short next-scramble from there
    let c; do { c = applyMoves(newSolved(), [...hist, ...genScramble(L)]); } while (c.EO.every(Boolean));
    const bad = c.EO.filter(g=>!g).length; h[bad]=(h[bad]||0)+1; sum+=bad;
  }
  const row = [2,4,6,8,10].map(k=>`${k}:${((100*(h[k]||0))/N).toFixed(1).padStart(4)}`).join('  ');
  console.log(`from messy+EOgood, next L=${String(L).padStart(2)}  ${row}  mean=${(sum/N).toFixed(2)}`);
}
console.log(`target                              2: 3.2  4:24.2  6:45.1  8:24.2  10: 3.2  mean=6.00`);
