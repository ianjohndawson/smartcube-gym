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
