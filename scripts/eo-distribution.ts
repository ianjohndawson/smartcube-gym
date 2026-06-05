import { Cube3x3, MOVESETS, applyMoves, newSolved, optimalToMask, type Move3x3 } from '../src/engine-api.ts';
import { MASKS } from '../src/engine/puzzles/cube3x3/index.ts';
import { genScramble } from '../src/steps.ts';

const EO = MASKS.EO as any;
const cfg = { moveSet: MOVESETS.RUFLDB, pruningDepth: 4, depthLimit: 8 };
const N = 4000;

const badHist: Record<number, number> = {};
const lenHist: Record<number, number> = {};
let badSum = 0, lenSum = 0;

for (let i = 0; i < N; i++) {
  // mirror makeScramble for EO: genScramble(10), reject already-solved EO
  let scr: Move3x3[];
  let cube: Cube3x3;
  do {
    scr = genScramble(10);
    cube = applyMoves(newSolved(), scr);
  } while (cube.EO.every(Boolean)); // reject 0 bad edges
  const bad = cube.EO.filter((g) => !g).length;
  const sol = optimalToMask(scr, EO, cfg) ?? [];
  badHist[bad] = (badHist[bad] || 0) + 1;
  lenHist[sol.length] = (lenHist[sol.length] || 0) + 1;
  badSum += bad; lenSum += sol.length;
}

const pct = (n: number) => ((100 * n) / N).toFixed(1).padStart(5);
console.log(`Sample: ${N} EO scrambles (genScramble(10), 0-bad rejected)\n`);
console.log('Bad edges  count   %');
for (const k of Object.keys(badHist).map(Number).sort((a,b)=>a-b)) console.log(`   ${String(k).padStart(2)}     ${String(badHist[k]).padStart(5)}  ${pct(badHist[k])}`);
console.log(`   mean: ${(badSum/N).toFixed(2)}\n`);
console.log('Opt moves  count   %');
for (const k of Object.keys(lenHist).map(Number).sort((a,b)=>a-b)) console.log(`   ${String(k).padStart(2)}     ${String(lenHist[k]).padStart(5)}  ${pct(lenHist[k])}`);
console.log(`   mean: ${(lenSum/N).toFixed(2)}`);
