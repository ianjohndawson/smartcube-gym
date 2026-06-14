// Shell-facing API over the (vendored, MPL) crystalcube engine.
// This file is part of the GPL-3.0 application code.
//
// Provides: live state tracking, mask-based step detection, optimal solving to a
// mask (with a cached pruning table), nearest-block selection, and progress —
// the primitives the UI/coaching shell needs.

import {
  Cube3x3,
  MOVESETS,
  SOLVED_FACELET_CUBE,
  invertMoves,
  type Cube3x3Mask,
  type Move3x3,
  type RotationMove,
} from './engine/puzzles/cube3x3/index.ts';
import { genPruningTable, solve, type PruningTable } from './engine/search/index.ts';
import { NET_COORDS } from './blocks.ts';

export type { Move3x3, RotationMove, Cube3x3Mask };
export { Cube3x3, MOVESETS, SOLVED_FACELET_CUBE };

export interface StepSolverConfig {
  moveSet: readonly Move3x3[];
  pruningDepth: number;
  depthLimit: number;
}

// --- state helpers ---

export function newSolved(): Cube3x3 {
  return new Cube3x3();
}

/** Build a tracked cube directly from a net-order facelet string (for resync). */
export function cubeFromFacelets(netFacelets: string): Cube3x3 {
  return new Cube3x3(MOVESETS.Full, netFacelets.split('') as never);
}

/**
 * Find a short move sequence (<= maxDepth outer turns) that takes `from` to `to`,
 * for reconciling small BLE drift (a missed move or two) without losing the move
 * history. Returns the moves, or null if not reachable within the cap.
 */
export function findBridge(from: Cube3x3, to: Cube3x3, maxDepth = 4): Move3x3[] | null {
  const target = to.encode();
  if (from.encode() === target) return [];
  const moves = MOVESETS.RUFLDB;
  const dfs = (cube: Cube3x3, depth: number, last: string, path: Move3x3[]): Move3x3[] | null => {
    if (cube.encode() === target) return [...path];
    if (depth === 0) return null;
    for (const m of moves) {
      if (m[0] === last) continue;
      const r = dfs(cube.clone().applyMove(m), depth - 1, m[0], [...path, m]);
      if (r) return r;
    }
    return null;
  };
  for (let d = 1; d <= maxDepth; d++) {
    const r = dfs(from, d, '', []);
    if (r) return r;
  }
  return null;
}

/**
 * State-based "is this step solved?" — works from ANY cube state (no move history
 * needed), so it stays correct after a resync. A mask is solved when its
 * solved-facelets match the solved cube and (for EO masks) all edges are oriented.
 */
export function isMaskSolvedState(cube: Cube3x3, mask: Cube3x3Mask): boolean {
  const f = cube.stateData;
  for (const i of mask.solvedFaceletIndices) if (f[i] !== SOLVED_FACELET_CUBE[i]) return false;
  if (mask.eoFaceletIndices && !cube.EO.every((good) => good)) return false;
  return true;
}

/** State-based progress (0..1) toward a mask: solved-facelets matching + edges oriented. */
export function maskProgressState(cube: Cube3x3, mask: Cube3x3Mask): number {
  const f = cube.stateData;
  let total = 0;
  let ok = 0;
  for (const i of mask.solvedFaceletIndices) {
    total++;
    if (f[i] === SOLVED_FACELET_CUBE[i]) ok++;
  }
  if (mask.eoFaceletIndices) {
    cube.EO.forEach((good) => {
      total++;
      if (good) ok++;
    });
  }
  return total === 0 ? 1 : ok / total;
}

export function parseMoves(s: string): Move3x3[] {
  return Cube3x3.parseNotation(s) ?? [];
}

/** Apply one move to a tracked state, returning a new Cube3x3 (immutable-style). */
export function applyMove(state: Cube3x3, move: Move3x3): Cube3x3 {
  return state.clone().applyMove(move);
}

export function applyMoves(state: Cube3x3, moves: Move3x3[]): Cube3x3 {
  return state.clone().applyMoves(moves);
}

export function statesEqual(a: Cube3x3, b: Cube3x3): boolean {
  return a.encode() === b.encode();
}

/** Facelet string (U R F D L B + masked markers) for rendering. */
export function faceletString(state: Cube3x3): string {
  return state.stateData.join('');
}

// --- detection + progress ---

function maskSolved(state: Cube3x3, mask: Cube3x3Mask): boolean {
  return state.clone().applyMask(mask).isSolved();
}

/** Index of the first candidate mask that is solved in `state`, or -1. */
export function detectIndex(state: Cube3x3, masks: Cube3x3Mask[]): number {
  for (let i = 0; i < masks.length; i++) if (maskSolved(state, masks[i])) return i;
  return -1;
}

export function anySolved(state: Cube3x3, masks: Cube3x3Mask[]): boolean {
  return detectIndex(state, masks) >= 0;
}

/**
 * History-based detection. EO (and other orientation) masks must be applied to a
 * SOLVED cube and then the move history replayed, so the orientation markers get
 * permuted — applying the mask to an already-scrambled state would read EO as
 * trivially solved. Correct for blocks too.
 */
export function isMaskSolvedFromHistory(history: Move3x3[], mask: Cube3x3Mask): boolean {
  return new Cube3x3().applyMask(mask).applyMoves([...history]).isSolved();
}

/** History-based progress (0..1) over a mask's solved + EO facelets. */
export function maskProgressFromHistory(history: Move3x3[], mask: Cube3x3Mask): number {
  const cur = new Cube3x3().applyMask(mask).applyMoves([...history]).stateData;
  const solved = new Cube3x3().applyMask(mask).stateData;
  const idxs = [...mask.solvedFaceletIndices, ...(mask.eoFaceletIndices ?? [])];
  if (idxs.length === 0) return 1;
  let ok = 0;
  for (const i of idxs) if (cur[i] === solved[i]) ok++;
  return ok / idxs.length;
}

/** Fraction (0..1) of a mask's solved-facelets currently matching the solved cube. */
export function maskProgress(state: Cube3x3, mask: Cube3x3Mask): number {
  const facelets = state.stateData;
  const idxs = mask.solvedFaceletIndices;
  if (idxs.length === 0) return 1;
  let ok = 0;
  for (const i of idxs) if (facelets[i] === SOLVED_FACELET_CUBE[i]) ok++;
  return ok / idxs.length;
}

/** The candidate mask the state is closest to completing. */
export function nearestMask(state: Cube3x3, masks: Cube3x3Mask[]): { mask: Cube3x3Mask; index: number } {
  let best = 0;
  let bestP = -1;
  masks.forEach((m, i) => {
    const p = maskProgress(state, m);
    if (p > bestP) {
      bestP = p;
      best = i;
    }
  });
  return { mask: masks[best], index: best };
}

// --- solving ---

const tableCache = new Map<string, PruningTable>();
function maskKey(mask: Cube3x3Mask, cfg: StepSolverConfig): string {
  return `${mask.solvedFaceletIndices.join(',')}|${mask.eoFaceletIndices?.join(',') ?? ''}@${cfg.pruningDepth}#${cfg.moveSet.length}`;
}

function getTable(mask: Cube3x3Mask, cfg: StepSolverConfig): PruningTable {
  const key = maskKey(mask, cfg);
  let t = tableCache.get(key);
  if (!t) {
    const solvedMasked = new Cube3x3([...cfg.moveSet]).applyMask(mask);
    t = genPruningTable(solvedMasked, { name: key, pruningDepth: cfg.pruningDepth });
    tableCache.set(key, t);
  }
  return t;
}

/**
 * Optimal solution(s) bringing `scramble` (moves from solved) to the masked
 * step. `scramble` is typically the full move history so far, so this also
 * works mid-solve for hints.
 */
export function solveToMask(
  scramble: Move3x3[],
  mask: Cube3x3Mask,
  cfg: StepSolverConfig,
  preRotation: RotationMove[] = [],
  maxSolutionCount = 3,
): Move3x3[][] {
  const translated = [...invertMoves(preRotation), ...scramble, ...preRotation];
  const puzzle = new Cube3x3([...cfg.moveSet]).applyMask(mask).applyMoves(translated);
  const table = getTable(mask, cfg);
  try {
    return solve(puzzle, table, {
      pruningDepth: cfg.pruningDepth,
      depthLimit: cfg.depthLimit,
      maxSolutionCount,
    });
  } catch {
    // The vendored solver throws if no solution exists within depthLimit.
    // Treat that as "no suggestion" rather than crashing a hint/score.
    return [];
  }
}

/** Single optimal solution, or null. */
export function optimalToMask(
  scramble: Move3x3[],
  mask: Cube3x3Mask,
  cfg: StepSolverConfig,
  preRotation: RotationMove[] = [],
): Move3x3[] | null {
  const sols = solveToMask(scramble, mask, cfg, preRotation, 1);
  return sols[0] ?? null;
}

// --- state-based solving (no move history needed) ---
//
// solveToMask needs the move trail from solved to build its puzzle. After a BLE
// resync the trail is unknown, but the LIVE cube state still fully determines the
// solution. We reconstruct the exact same masked puzzle from the cube's facelets
// by mapping each sticker to its home (solved) position. Proven equivalent to
// solveToMask across thousands of random states (blocks, block+EO, and EO).

// Cubies = facelets sharing a 3D coordinate; within a cubie colours are distinct,
// so colour -> solved-facelet-index is unambiguous.
const CUBIE_GROUPS: number[][] = (() => {
  const by = new Map<string, number[]>();
  NET_COORDS.forEach((c, i) => {
    const k = c.join(',');
    (by.get(k) ?? by.set(k, []).get(k)!).push(i);
  });
  return [...by.values()];
})();
const HOME_BY_COLORSET = new Map<string, Map<string, number>>();
for (const g of CUBIE_GROUPS) {
  const cs = g.map((i) => SOLVED_FACELET_CUBE[i]).sort().join('');
  const m = new Map<string, number>();
  g.forEach((i) => m.set(SOLVED_FACELET_CUBE[i] as string, i));
  HOME_BY_COLORSET.set(cs, m);
}

/** For each facelet position, the solved index of the sticker currently there. */
function homePermutation(state: readonly string[]): number[] {
  const home = new Array<number>(54);
  for (const g of CUBIE_GROUPS) {
    const cs = g.map((i) => state[i]).sort().join('');
    const map = HOME_BY_COLORSET.get(cs);
    if (!map) return []; // unrecognisable state — fail safe (no suggestion)
    for (const j of g) {
      const h = map.get(state[j]);
      if (h === undefined) return [];
      home[j] = h;
    }
  }
  return home;
}

function maskedSolvedFacelets(mask: Cube3x3Mask): string[] {
  const solved = new Set<number>(mask.solvedFaceletIndices as readonly number[]);
  const eo = new Set<number>((mask.eoFaceletIndices ?? []) as readonly number[]);
  return [...Array(54).keys()].map((i) =>
    solved.has(i) ? (SOLVED_FACELET_CUBE[i] as string) : eo.has(i) ? 'O' : 'X',
  );
}

/**
 * Optimal solution(s) bringing the LIVE cube to the masked step, computed from
 * its current state alone (no move history) — so it stays correct after a resync.
 */
export function solveFromStateMulti(
  cube: Cube3x3,
  mask: Cube3x3Mask,
  cfg: StepSolverConfig,
  maxSolutionCount = 3,
): Move3x3[][] {
  const ms = maskedSolvedFacelets(mask);
  const home = homePermutation(cube.stateData as unknown as string[]);
  if (home.length === 0) return [];
  const masked = [...Array(54).keys()].map((j) => ms[home[j]]);
  const puzzle = new Cube3x3([...cfg.moveSet], masked as never, ms as never);
  const table = getTable(mask, cfg);
  try {
    return solve(puzzle, table, {
      pruningDepth: cfg.pruningDepth,
      depthLimit: cfg.depthLimit,
      maxSolutionCount,
    });
  } catch {
    return [];
  }
}

/** Single optimal solution from the live cube state, or null. */
export function solveFromState(
  cube: Cube3x3,
  mask: Cube3x3Mask,
  cfg: StepSolverConfig,
): Move3x3[] | null {
  return solveFromStateMulti(cube, mask, cfg, 1)[0] ?? null;
}
