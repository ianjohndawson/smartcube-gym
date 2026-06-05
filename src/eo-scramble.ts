// EO scrambles by *targeted bad-edge count*, not by length.
//
// Key fact: from an EO-solved cube (all edges good — which is always the case
// after finishing EO), the number of bad edges a sequence produces depends only
// on the sequence, not the permutation underneath. So we can pick the bad-edge
// count from the true (binomial) distribution and then use the SHORTEST sequence
// that produces that count — short scrambles with an exact distribution.
//
// We BFS the entire edge-orientation space (2^11 = 2048 reachable states, ≤8
// moves deep) once, recording the shortest sequence to each EO pattern.

import { Cube3x3, MOVESETS, type Move3x3 } from './engine-api.ts';

const eoKey = (c: Cube3x3): string => c.EO.map((good) => (good ? '0' : '1')).join('');
const badOf = (key: string): number => key.split('').filter((b) => b === '1').length;

let SHORTEST: Map<string, Move3x3[]> | null = null;
let BY_COUNT: Record<number, string[]> | null = null;

function build(): void {
  const moves = MOVESETS.RUFLDB;
  const shortest = new Map<string, Move3x3[]>();
  const start = new Cube3x3();
  shortest.set(eoKey(start), []);
  let frontier: Cube3x3[] = [start];
  while (frontier.length) {
    const next: Cube3x3[] = [];
    for (const c of frontier) {
      const seq = shortest.get(eoKey(c))!;
      for (const m of moves) {
        const nc = c.clone().applyMove(m);
        const k = eoKey(nc);
        if (!shortest.has(k)) {
          shortest.set(k, [...seq, m]);
          next.push(nc);
        }
      }
    }
    frontier = next;
  }
  const byCount: Record<number, string[]> = {};
  for (const key of shortest.keys()) {
    const b = badOf(key);
    (byCount[b] ??= []).push(key);
  }
  SHORTEST = shortest;
  BY_COUNT = byCount;
}

// Relative weights = C(12,k) (the random-state distribution), 0 excluded.
const COUNT_WEIGHTS: [number, number][] = [
  [2, 66],
  [4, 495],
  [6, 924],
  [8, 495],
  [10, 66],
  [12, 1],
];

function sampleCount(): number {
  const total = COUNT_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of COUNT_WEIGHTS) {
    r -= w;
    if (r < 0) return k;
  }
  return 6;
}

/** Shortest scramble producing a binomially-sampled number of bad edges. */
export function sampleEoScramble(): Move3x3[] {
  if (!SHORTEST || !BY_COUNT) build();
  const k = sampleCount();
  const keys = BY_COUNT![k];
  const key = keys[Math.floor(Math.random() * keys.length)];
  return [...SHORTEST!.get(key)!];
}

/** Exposed for tests/diagnostics. */
export function eoTableStats(): Record<number, number> {
  if (!BY_COUNT) build();
  const out: Record<number, number> = {};
  for (const k of Object.keys(BY_COUNT!).map(Number).sort((a, b) => a - b)) out[k] = BY_COUNT![k].length;
  return out;
}
