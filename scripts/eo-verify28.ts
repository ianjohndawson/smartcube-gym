import { applyMoves, newSolved } from '../src/engine-api.ts';
import { genScramble } from '../src/steps.ts';
const N = 8000;
const h: Record<number, number> = {}; let sum = 0;
for (let i=0;i<N;i++){ let c; do { c = applyMoves(newSolved(), genScramble(28)); } while (c.EO.every(Boolean)); const bad=c.EO.filter(g=>!g).length; h[bad]=(h[bad]||0)+1; sum+=bad; }
console.log('L=28 EO scramble distribution (', N, 'samples):');
for (const k of [2,4,6,8,10,12]) console.log(`  ${String(k).padStart(2)} bad: ${((100*(h[k]||0))/N).toFixed(2)}%`);
console.log('  mean bad:', (sum/N).toFixed(2));
console.log('  target :   2:3.22  4:24.17  6:45.12  8:24.17  10:3.22  mean:6.00');
