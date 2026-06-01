// Runtime journey API: merges method/phase definitions with generated ideal
// solutions, and provides "block built anywhere" detection.

import {
  all123,
  all222,
  all223,
  findSolvedBlock,
  goalProgress,
  type BlockGoal,
  type CubieCube,
} from './cube.ts';
import { solveBlock } from './solver.ts';
import {
  METHODS,
  SCRAMBLES,
  ideObjKey,
  type BlockFamily,
  type Method,
  type MethodDef,
  type PhaseDef,
  type ScrambleDef,
} from './journeys.def.ts';
import { IDEALS } from './journeys.ideals.ts';

export { METHODS, SCRAMBLES };
export type { Method, MethodDef, PhaseDef, ScrambleDef, BlockFamily };

const CANDIDATES: Record<BlockFamily, BlockGoal[]> = {
  '222': all222(),
  '223': all223(),
  '123': all123(),
};

/** The generated ideal move string for a phase, or '' if none was found. */
export function getIdeal(method: Method, scrambleId: string, phaseId: string): string {
  return IDEALS[ideObjKey(method, scrambleId, phaseId)] ?? '';
}

/** Detect whether a block of the given family is solved anywhere on the cube. */
export function detectFamily(cube: CubieCube, family: BlockFamily): BlockGoal | null {
  return findSolvedBlock(cube, CANDIDATES[family]);
}

/**
 * Progress (0..1) toward completing a phase: the best progress across all
 * candidate blocks of the phase's family.
 */
export function familyProgress(cube: CubieCube, family: BlockFamily): number {
  let best = 0;
  for (const g of CANDIDATES[family]) {
    const p = goalProgress(cube, g);
    if (p > best) best = p;
  }
  return best;
}

export function listMethods(): MethodDef[] {
  return Object.values(METHODS);
}

// --- Solver-backed coaching ---

/** The candidate block of a family the solver is closest to completing right now. */
export function nearestGoal(cube: CubieCube, family: BlockFamily): BlockGoal {
  let best = CANDIDATES[family][0];
  let bestP = -1;
  for (const g of CANDIDATES[family]) {
    const p = goalProgress(cube, g);
    if (p > bestP) {
      bestP = p;
      best = g;
    }
  }
  return best;
}

/** Optimal solution (move list) from `from` to a specific goal, capped by depth. */
export function optimalFor(from: CubieCube, goal: BlockGoal, maxDepth = 16): string[] | null {
  return solveBlock(from, goal, { maxDepth });
}

export interface Hint {
  goal: BlockGoal;
  moves: string[]; // full optimal continuation to that goal
}

/**
 * A hint for the current position: the optimal continuation to the block the
 * user is closest to building. `moves[0]` is the next move to make.
 */
export function hintFor(cube: CubieCube, family: BlockFamily, maxDepth = 16): Hint | null {
  const goal = nearestGoal(cube, family);
  const moves = solveBlock(cube, goal, { maxDepth });
  return moves ? { goal, moves } : null;
}

/**
 * The easiest block of a family from this position: the candidate with the
 * shortest optimal solution. Returns the goal, its move count, and a short
 * human label for where it is. Can be slow for large families — call on demand.
 */
export interface EasiestBlock {
  goal: BlockGoal;
  moves: string[];
}
export function easiestBlock(cube: CubieCube, family: BlockFamily, maxDepth = 12): EasiestBlock | null {
  let best: EasiestBlock | null = null;
  for (const g of CANDIDATES[family]) {
    const moves = solveBlock(cube, g, { maxDepth });
    if (moves && (!best || moves.length < best.moves.length)) best = { goal: g, moves };
  }
  return best;
}
