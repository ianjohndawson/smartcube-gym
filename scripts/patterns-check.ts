// Ground-truth oracle for the pattern detector (src/patterns.ts): every named
// case on the source page (Ian's Lars Petrus mirror, #blox section) must
// classify as its own name — and never as a different one. Each exemplar is the
// page's own Roofpig case: start = alg⁻¹ from solved, route = the alg, piece
// scope = exactly the pieces the page colours (grey pieces are not part of the
// pattern). Plus a robustness sweep: taught routes on random scrambles classify
// without crashing and name only known patterns.

import {
  applyMoves, newSolved, parseMoves, MOVESETS, type Move3x3,
} from '../src/engine-api.ts';
import { classifyRoute, classifyRouteForPieces, traceRoute, type PatternName } from '../src/patterns.ts';
import { humanSolveFromState } from '../src/human-solve.ts';
import { all222Masks, NET_COORDS } from '../src/blocks.ts';

const faceOf = (i: number) =>
  i < 9 ? 'U' : i >= 45 ? 'D' : ['L', 'L', 'L', 'F', 'F', 'F', 'R', 'R', 'R', 'B', 'B', 'B'][(i - 9) % 12];
const byCoord = new Map<string, number[]>();
NET_COORDS.forEach((c, i) => {
  const k = c.join(',');
  (byCoord.get(k) ?? byCoord.set(k, []).get(k)!).push(i);
});
const GROUPS = [...byCoord.values()];
/** Home piece group named by its faces, e.g. 'UFR', 'UR'. */
function piece(name: string): number[] {
  const want = [...name].sort().join('');
  const g = GROUPS.find((g) => g.length === name.length && g.map(faceOf).sort().join('') === want);
  if (!g) throw new Error(`no piece ${name}`);
  return g;
}
const invert = (moves: Move3x3[]): Move3x3[] =>
  [...moves].reverse().map((m) => (m.endsWith('2') ? m : m.endsWith("'") ? (m[0] as Move3x3) : (`${m}'` as Move3x3)));

interface Case { name: PatternName; pieces: string[]; alg: string; }
const CASES: Case[] = [
  { name: 'Simple join', pieces: ['UFR', 'UR'], alg: 'F' },
  { name: 'Simple join', pieces: ['UFR', 'UR'], alg: 'F2' },
  { name: 'Double join', pieces: ['UFR', 'UR', 'UF'], alg: 'F' },
  { name: 'Double join', pieces: ['UFR', 'UR', 'UF'], alg: 'F2' },
  { name: 'Swing', pieces: ['DFR', 'DR', 'DF'], alg: 'R2 F2' },
  { name: 'Swing', pieces: ['DFR', 'DR', 'DF'], alg: "R' F2" },
  { name: 'Double swing', pieces: ['UBL', 'UL', 'UB'], alg: 'L2 F2 L2' },
  { name: 'Double swing', pieces: ['UBL', 'UL', 'UB'], alg: 'B2 R2 B2' },
  { name: 'Double swing', pieces: ['UBL', 'UL', 'UB'], alg: 'L F2 L2' },
  { name: 'Double swing', pieces: ['UBL', 'UL', 'UB'], alg: "R' L2 F2 L2" },
  { name: 'Roundabout', pieces: ['UR', 'UBR'], alg: "F' L' B'" },
  { name: 'Roundabout', pieces: ['UBR', 'UR', 'UB'], alg: "F' L' B'" },
  { name: 'Roundabout', pieces: ['UBR', 'UR', 'BR'], alg: "F' L' B'" },
  { name: 'Roundabout', pieces: ['UBR', 'UR', 'UB'], alg: "L' F' L' B'" },
  { name: 'Roundabout', pieces: ['UBR', 'UR', 'BR'], alg: "B F' L' B'" },
  { name: 'Parallel roundabout', pieces: ['UBR', 'UB', 'UFR', 'UR', 'FR'], alg: 'R U R U R' },
  { name: 'Parallel roundabout', pieces: ['UBR', 'UB', 'UFR', 'UR', 'FR'], alg: 'R U R U R U' },
  { name: 'Broken corner', pieces: ['UBR', 'UB', 'UR'], alg: "U R U' R" },
  { name: 'Broken corner', pieces: ['UBR', 'UB', 'UR'], alg: "U R2 U' R" },
  { name: 'Pillar', pieces: ['UFR', 'UR', 'FR'], alg: "R U' R U" },
  { name: 'Pillar', pieces: ['UFR', 'UR', 'FR'], alg: "R' U' R U" },
];

let n = 0, fail = 0;
for (const c of CASES) {
  const route = parseMoves(c.alg);
  const start = applyMoves(newSolved(), invert(route));
  const corners = c.pieces.filter((p) => p.length === 3).map(piece);
  const edges = c.pieces.filter((p) => p.length === 2).map(piece);
  const events = classifyRouteForPieces(start, route, corners, edges);
  n++;
  const names = events.map((e) => e.name).filter((x): x is PatternName => x != null);
  const ok = names.includes(c.name) && names.every((x) => x === c.name);
  if (!ok) {
    fail++;
    console.log(`MISMATCH ${c.name} [${c.alg}]: got [${events.map((e) => `${e.name ?? '·'}@${e.from}-${e.to}(p${e.placed})`).join(' ')}]`);
    for (const l of traceRoute(start, route, corners, edges)) console.log(l);
  }
}

// Robustness: taught routes over random scrambles — no crash, only known names.
const KNOWN = new Set(['Simple join', 'Double join', 'Swing', 'Double swing', 'Roundabout', 'Parallel roundabout', 'Broken corner', 'Pillar']);
const FACES = ['U', 'D', 'L', 'R', 'F', 'B'], SUF = ['', '2', "'"];
const rnd = (k: number): Move3x3[] => {
  const o: string[] = []; let l = '';
  while (o.length < k) { const f = FACES[(Math.random() * 6) | 0]; if (f === l) continue; l = f; o.push(f + SUF[(Math.random() * 3) | 0]); }
  return o as Move3x3[];
};
const masks = all222Masks();
const cfg = { moveSet: MOVESETS.RUFLDB, pruningDepth: 4, depthLimit: 11 };
let named = 0, segs = 0;
for (let t = 0; t < 12; t++) {
  const cube = applyMoves(newSolved(), rnd(12));
  const mask = masks[(Math.random() * masks.length) | 0];
  const trail = humanSolveFromState(cube, mask, cfg) ?? [];
  if (!trail.length) continue;
  const events = classifyRoute(cube, trail, mask);
  n++;
  segs += events.length;
  for (const e of events) {
    if (e.name != null && !KNOWN.has(e.name)) { fail++; console.log(`UNKNOWN name ${e.name}`); }
    if (e.name != null) named++;
  }
}

console.log(`patterns: ${n} checks (${CASES.length} source-page cases; ${segs} route segments, ${named} named), mismatches ${fail}`);
if (fail > 0) { console.log('PATTERNS FAIL'); process.exitCode = 1; }
else console.log('PATTERNS OK — every Lars Petrus case classifies as itself, and only itself');
