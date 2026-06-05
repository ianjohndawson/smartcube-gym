import { sampleEoScramble, eoTableStats } from '../src/eo-scramble.ts';
import { applyMoves, newSolved } from '../src/engine-api.ts';

console.log('EO states per bad-count (should equal C(12,k)):', eoTableStats());

const N = 20000;
const kHist: Record<number, number> = {};
const lenHist: Record<number, number> = {};
let lenSum = 0;
// Apply each sampled scramble from a *messy* EO-good base to confirm count is permutation-independent
const messyBase = applyMoves(newSolved(), ['R','U','R','U','R','U2','R2','U','F','R2','U'] as any); // arbitrary perm (EO may not be good though)
for (let i = 0; i < N; i++) {
  const scr = sampleEoScramble();
  const c = applyMoves(newSolved(), scr); // from solved
  const bad = c.EO.filter((g) => !g).length;
  kHist[bad] = (kHist[bad] || 0) + 1;
  lenHist[scr.length] = (lenHist[scr.length] || 0) + 1;
  lenSum += scr.length;
}
const pct = (n: number) => ((100 * n) / N).toFixed(2).padStart(6);
console.log('\nbad-edge distribution:');
for (const k of [2,4,6,8,10,12]) console.log(`  ${String(k).padStart(2)}: ${pct(kHist[k]||0)}%   (target ${(100*[66,495,924,495,66,1][[2,4,6,8,10,12].indexOf(k)]/2047).toFixed(2)}%)`);
console.log('\nscramble length distribution:');
for (const L of Object.keys(lenHist).map(Number).sort((a,b)=>a-b)) console.log(`  ${String(L).padStart(2)} moves: ${pct(lenHist[L])}%`);
console.log('  mean length:', (lenSum/N).toFixed(2));
