// Block solver: finds a short move sequence that brings a target set of pieces
// (a BlockGoal) home and oriented, using IDA* with an admissible heuristic
// based on per-piece minimum solving distance.
//
// Used at build time to generate verified "ideal" solutions for journeys, and
// optionally at runtime to compute a hint for the current phase.

import {
  ALL_MOVES,
  cloneCube,
  moveCube,
  MOVE_TABLE,
  type CubieCube,
  type BlockGoal,
} from './cube.ts';

// --- Single-piece transition + distance tables (computed once) ---

const FACE_OF: Record<string, string> = {};
for (const m of ALL_MOVES) FACE_OF[m] = m[0];
const OPPOSITE: Record<string, string> = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

// cornerMove[moveIndex][state] -> newState, state = slot*3 + ori (24 states)
const cornerMove: number[][] = [];
const edgeMove: number[][] = []; // state = slot*2 + ori (24 states)

for (const move of ALL_MOVES) {
  const m = MOVE_TABLE[move];
  const cTable = new Array(24);
  for (let slot = 0; slot < 8; slot++) {
    for (let ori = 0; ori < 3; ori++) {
      // piece currently at `slot` goes to slot t where m.cp[t] === slot
      let t = -1;
      for (let k = 0; k < 8; k++) if (m.cp[k] === slot) { t = k; break; }
      const newOri = (ori + m.co[t]) % 3;
      cTable[slot * 3 + ori] = t * 3 + newOri;
    }
  }
  cornerMove.push(cTable);

  const eTable = new Array(24);
  for (let slot = 0; slot < 12; slot++) {
    for (let ori = 0; ori < 2; ori++) {
      let t = -1;
      for (let k = 0; k < 12; k++) if (m.ep[k] === slot) { t = k; break; }
      const newOri = (ori + m.eo[t]) % 2;
      eTable[slot * 2 + ori] = t * 2 + newOri;
    }
  }
  edgeMove.push(eTable);
}

// cornerDistTo[homeCorner][state] = min moves from state to (homeCorner, ori 0).
// The generating set is symmetric (every move and its inverse present), so a BFS
// from the home state yields the distance from any state to home.
const cornerDistTo: number[][] = [];
for (let home = 0; home < 8; home++) {
  const dist = new Array(24).fill(-1);
  const start = home * 3 + 0;
  dist[start] = 0;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const s = queue[qi];
    for (let mi = 0; mi < cornerMove.length; mi++) {
      const ns = cornerMove[mi][s];
      if (dist[ns] === -1) {
        dist[ns] = dist[s] + 1;
        queue.push(ns);
      }
    }
  }
  cornerDistTo.push(dist);
}

const edgeDistTo: number[][] = [];
for (let home = 0; home < 12; home++) {
  const dist = new Array(24).fill(-1);
  const start = home * 2 + 0;
  dist[start] = 0;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const s = queue[qi];
    for (let mi = 0; mi < edgeMove.length; mi++) {
      const ns = edgeMove[mi][s];
      if (dist[ns] === -1) {
        dist[ns] = dist[s] + 1;
        queue.push(ns);
      }
    }
  }
  edgeDistTo.push(dist);
}

function heuristic(c: CubieCube, goal: BlockGoal): number {
  let h = 0;
  for (const target of goal.corners) {
    // find slot holding the target corner
    let slot = -1;
    for (let i = 0; i < 8; i++) if (c.cp[i] === target) { slot = i; break; }
    const d = cornerDistTo[target][slot * 3 + c.co[slot]];
    if (d > h) h = d;
  }
  for (const target of goal.edges) {
    let slot = -1;
    for (let i = 0; i < 12; i++) if (c.ep[i] === target) { slot = i; break; }
    const d = edgeDistTo[target][slot * 2 + c.eo[slot]];
    if (d > h) h = d;
  }
  return h;
}

function goalReached(c: CubieCube, goal: BlockGoal): boolean {
  for (const i of goal.corners) if (c.cp[i] !== i || c.co[i] !== 0) return false;
  for (const i of goal.edges) if (c.ep[i] !== i || c.eo[i] !== 0) return false;
  return true;
}

export interface SolveOptions {
  maxDepth?: number; // cap search depth (default 20)
}

/**
 * Find a shortest sequence (within maxDepth) that solves the goal from `start`.
 * Returns the move list, or null if none found within the cap.
 */
export function solveBlock(start: CubieCube, goal: BlockGoal, opts: SolveOptions = {}): string[] | null {
  const maxDepth = opts.maxDepth ?? 20;
  if (goalReached(start, goal)) return [];

  const path: string[] = [];

  for (let bound = heuristic(start, goal); bound <= maxDepth; bound++) {
    const found = dfs(start, 0, bound, goal, path, '');
    if (found) return path.slice();
  }
  return null;
}

function dfs(
  c: CubieCube,
  g: number,
  bound: number,
  goal: BlockGoal,
  path: string[],
  lastFace: string,
): boolean {
  const h = heuristic(c, goal);
  if (g + h > bound) return false;
  if (h === 0 && goalReached(c, goal)) return true;

  for (const move of ALL_MOVES) {
    const face = FACE_OF[move];
    if (face === lastFace) continue; // never twist the same face twice in a row
    // Canonicalise opposite-face order to avoid exploring both U D and D U.
    if (path.length > 0) {
      const prevFace = FACE_OF[path[path.length - 1]];
      if (OPPOSITE[face] === prevFace && face < prevFace) continue;
    }
    const next = moveCube(c, move);
    path.push(move);
    if (dfs(next, g + 1, bound, goal, path, face)) return true;
    path.pop();
  }
  return false;
}

export { cloneCube };
