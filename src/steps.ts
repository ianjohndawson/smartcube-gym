// Step registry — the extensible heart of the trainer. Each StepDef describes a
// cube-skill step: how to detect it (candidate masks), the canonical guided
// target (for ideal/efficiency), and how to solve it (mask + solver config).
//
// Step A covers block-building steps. EO/cross/line steps slot in here later by
// adding entries that point at the engine's existing masks/configs.

import {
  all123Masks,
  all222Masks,
  all223Masks,
  MASK_123_LEFT,
  MASK_123_RIGHT,
  MASK_222_DLF,
  MASK_223_BOTTOM_LEFT,
} from './blocks.ts';
import { MOVESETS, type Cube3x3Mask, type StepSolverConfig } from './engine-api.ts';

export type Method = 'Petrus' | 'APB' | 'Roux' | 'LEOR';
export type BlockFamily = '222' | '223' | '123';

export interface StepDef {
  id: string;
  label: string;
  blurb: string;
  family: BlockFamily;
  /** All candidate placements — "block built anywhere" detection. */
  candidateMasks: Cube3x3Mask[];
  /** Canonical guided target (fixed white-up/green-front) for ideal + scoring. */
  canonicalMask: Cube3x3Mask;
  solver: StepSolverConfig;
}

export interface MethodDef {
  method: Method;
  description: string;
  steps: StepDef[];
}

const BLOCK_MOVES = MOVESETS.RUFLDB; // outer turns only

// pruningDepth 4 keeps table generation fast (tens of ms) while still finding
// optimal block solutions, which are short. Tables are cached after first use.
const SOLVER: Record<BlockFamily, StepSolverConfig> = {
  '222': { moveSet: BLOCK_MOVES, pruningDepth: 4, depthLimit: 11 },
  '223': { moveSet: BLOCK_MOVES, pruningDepth: 4, depthLimit: 14 },
  '123': { moveSet: BLOCK_MOVES, pruningDepth: 4, depthLimit: 12 },
};

const STEP_222: StepDef = {
  id: '222',
  label: '2×2×2 block',
  blurb: 'Build a solved 2×2×2 corner block — intuition, not algorithms.',
  family: '222',
  candidateMasks: all222Masks(),
  canonicalMask: MASK_222_DLF,
  solver: SOLVER['222'],
};

const STEP_223: StepDef = {
  id: '223',
  label: '2×2×3 block',
  blurb: 'Expand your 2×2×2 into a 2×2×3 by solving the adjacent corner and two edges.',
  family: '223',
  candidateMasks: all223Masks(),
  canonicalMask: MASK_223_BOTTOM_LEFT,
  solver: SOLVER['223'],
};

const STEP_123_LEFT: StepDef = {
  id: '123L',
  label: 'First block (1×2×3)',
  blurb: 'Build a 1×2×3 block against a centre — 2 corners and 3 edges.',
  family: '123',
  candidateMasks: all123Masks(),
  canonicalMask: MASK_123_LEFT,
  solver: SOLVER['123'],
};

const STEP_123_RIGHT: StepDef = {
  id: '123R',
  label: 'Second block (1×2×3)',
  blurb: 'Build the second 1×2×3 on the opposite side, sharing the bottom layer.',
  family: '123',
  candidateMasks: all123Masks(),
  canonicalMask: MASK_123_RIGHT,
  solver: SOLVER['123'],
};

export const METHODS: Record<Method, MethodDef> = {
  Petrus: {
    method: 'Petrus',
    description: 'Build a 2×2×2 block, then expand it to a 2×2×3.',
    steps: [STEP_222, STEP_223],
  },
  APB: {
    method: 'APB',
    description: 'Advanced Petrus Blocks: 2×2×2, then a 2×2×3.',
    steps: [STEP_222, STEP_223],
  },
  Roux: {
    method: 'Roux',
    description: 'Build a 1×2×3 first block, then a second 1×2×3 on the opposite side.',
    steps: [STEP_123_LEFT, STEP_123_RIGHT],
  },
  LEOR: {
    method: 'LEOR',
    description: 'LEOR opening: a 1×2×3 first block, then the second-side block (EO/line continues later).',
    steps: [STEP_123_LEFT, STEP_123_RIGHT],
  },
};

export function listMethods(): MethodDef[] {
  return Object.values(METHODS);
}

export interface ScrambleDef {
  id: string;
  scramble: string;
}

// Random-state scrambles that don't pre-solve any block (verified earlier).
export const SCRAMBLES: ScrambleDef[] = [
  { id: 's1', scramble: "F2 B' D' U F' R2 U2 D B' L2 D' R F' B2 L2 B U2 D' L2 F2" },
  { id: 's2', scramble: "U2 D B' R2 B' R D2 U' B U' B D2 B2 R' U F D' U' F2 B" },
  { id: 's3', scramble: "L' R U F R B2 F' R B2 L F' R' D F2 D2 U' F' D L D" },
];
