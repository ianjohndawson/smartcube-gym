import { applyMoves, newSolved } from '../src/engine-api.ts';
import { genScramble } from '../src/steps.ts';

const N = 6000;
const target: Record<number, number> = { 2: 3.22, 4: 24.17, 6: 45.12, 8: 24.17, 10: 3.22 }; // binomial (0/12 excluded, tiny)
for (const L of [10, 14, 18, 22, 26, 30]) {
  const h: Record<number, number> = {};
  let sum = 0;
  for (let i = 0; i < N; i++) {
    let cube;
    do { cube = applyMoves(newSolved(), genScramble(L)); } while (cube.EO.every(Boolean));
    const bad = cube.EO.filter((g) => !g).length;
    h[bad] = (h[bad] || 0) + 1; sum += bad;
  }
  const row = [2,4,6,8,10].map(k => `${k}:${((100*(h[k]||0))/N).toFixed(1).padStart(4)}`).join('  ');
  // chi-ish deviation from target
  const dev = [2,4,6,8,10].reduce((a,k)=>a+Math.abs((100*(h[k]||0))/N - target[k]),0);
  console.log(`L=${String(L).padStart(2)}  ${row}  mean=${(sum/N).toFixed(2)}  |dev|=${dev.toFixed(1)}`);
}
console.log(`target    2:3.2  4:24.2  6:45.1  8:24.2  10:3.2  mean=6.00`);
