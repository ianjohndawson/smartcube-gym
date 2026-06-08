// True distribution of OPTIMAL edge-orientation length over all EO states.
// Each of the 2^11 = 2048 reachable EO states is equally likely on a random cube,
// so a histogram of the shortest-solve length over all states IS the real
// distribution of "ideal EO move count". Confirms whether our targeted-count
// scrambles match reality and whether 6/7/8-move cases exist.
import { Cube3x3, MOVESETS, type Move3x3 } from '../src/engine-api.ts';

const eoKey = (c: Cube3x3) => c.EO.map((g) => (g ? '0' : '1')).join('');
const bad = (k: string) => k.split('').filter((b) => b === '1').length;

const moves = MOVESETS.RUFLDB;
const depth = new Map<string, number>();
const start = new Cube3x3();
depth.set(eoKey(start), 0);
let frontier = [start];
let d = 0;
while (frontier.length) {
  const next: Cube3x3[] = [];
  for (const c of frontier) for (const m of moves as Move3x3[]) {
    const nc = c.clone().applyMove(m);
    const k = eoKey(nc);
    if (!depth.has(k)) { depth.set(k, d + 1); next.push(nc); }
  }
  frontier = next; d++;
}

const total = depth.size;
const byDepth: Record<number, number> = {};
const byDepthNoSolved: Record<number, number> = {};
for (const [k, dd] of depth) {
  byDepth[dd] = (byDepth[dd] ?? 0) + 1;
  if (bad(k) > 0) byDepthNoSolved[dd] = (byDepthNoSolved[dd] ?? 0) + 1;
}
const nonSolved = total - 1;
console.log(`reachable EO states: ${total} (expected 2048)`);
console.log('\noptimal length : #states : % of all : % of non-solved (what you actually get)');
const depths = Object.keys(byDepth).map(Number).sort((a, b) => a - b);
for (const dd of depths) {
  const all = byDepth[dd];
  const ns = byDepthNoSolved[dd] ?? 0;
  console.log(`  ${dd} moves     : ${String(all).padStart(4)}    : ${(100 * all / total).toFixed(1).padStart(5)}%  : ${(100 * ns / nonSolved).toFixed(1).padStart(5)}%`);
}
const meanNS = depths.reduce((s, dd) => s + dd * (byDepthNoSolved[dd] ?? 0), 0) / nonSolved;
console.log(`\nmean ideal length (non-solved states): ${meanNS.toFixed(2)}`);
