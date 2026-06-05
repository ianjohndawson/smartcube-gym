// Step registry — the extensible heart of the trainer. Each StepDef describes a
// cube-skill step: how to detect it, the canonical guided target (for ideal +
// scoring), and how to solve it (mask + solver config).
//
// Block steps use the geometric block masks; EO steps use the engine's EO masks
// (and a combined 2x2x3+EO mask for faithful Petrus EO).

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
import { MASKS } from './engine/puzzles/cube3x3/index.ts';

export type Method = 'Petrus' | 'APB' | 'Roux' | 'LEOR' | 'ZZ' | 'EO';
export type BlockFamily = '222' | '223' | '123';
export type StepKind = 'block' | 'eo';

export interface StepDef {
  id: string;
  label: string;
  blurb: string;
  kind: StepKind;
  family?: BlockFamily;
  /** Candidate placements for block "anywhere" detection (block steps). */
  candidateMasks: Cube3x3Mask[];
  /** Canonical guided target for detection + ideal + scoring. */
  canonicalMask: Cube3x3Mask;
  solver: StepSolverConfig;
}

export interface MethodDef {
  method: Method;
  description: string;
  steps: StepDef[];
}

const BLOCK_MOVES = MOVESETS.RUFLDB;

const SOLVER: Record<BlockFamily, StepSolverConfig> = {
  '222': { moveSet: BLOCK_MOVES, pruningDepth: 4, depthLimit: 11 },
  '223': { moveSet: BLOCK_MOVES, pruningDepth: 4, depthLimit: 14 },
  '123': { moveSet: BLOCK_MOVES, pruningDepth: 4, depthLimit: 12 },
};

// --- block steps ---
const STEP_222: StepDef = {
  id: '222', label: '2×2×2 block', kind: 'block', family: '222',
  blurb: 'Build a solved 2×2×2 corner block — intuition, not algorithms.',
  candidateMasks: all222Masks(), canonicalMask: MASK_222_DLF, solver: SOLVER['222'],
};
const STEP_223: StepDef = {
  id: '223', label: '2×2×3 block', kind: 'block', family: '223',
  blurb: 'Expand your 2×2×2 into a 2×2×3 by solving the adjacent corner and two edges.',
  candidateMasks: all223Masks(), canonicalMask: MASK_223_BOTTOM_LEFT, solver: SOLVER['223'],
};
const STEP_123_LEFT: StepDef = {
  id: '123L', label: 'First block (1×2×3)', kind: 'block', family: '123',
  blurb: 'Build a 1×2×3 block against a centre — 2 corners and 3 edges.',
  candidateMasks: all123Masks(), canonicalMask: MASK_123_LEFT, solver: SOLVER['123'],
};
const STEP_123_RIGHT: StepDef = {
  id: '123R', label: 'Second block (1×2×3)', kind: 'block', family: '123',
  blurb: 'Build the second 1×2×3 on the opposite side, sharing the bottom layer.',
  candidateMasks: all123Masks(), canonicalMask: MASK_123_RIGHT, solver: SOLVER['123'],
};

// --- EO steps ---
const EO_MASK = MASKS.EO as Cube3x3Mask;
const EOLINE_MASK = MASKS.EOLine as Cube3x3Mask;
// Petrus EO: orient all edges while KEEPING the 2x2x3 — combine the block's
// solved facelets with the EO orientation facelets.
const PETRUS_EO_MASK: Cube3x3Mask = {
  solvedFaceletIndices: MASK_223_BOTTOM_LEFT.solvedFaceletIndices,
  eoFaceletIndices: EO_MASK.eoFaceletIndices,
};

const STEP_EO: StepDef = {
  id: 'eo', label: 'Edge orientation', kind: 'eo',
  blurb: 'Orient all 12 edges so the rest can be solved with R, L, U and D only.',
  candidateMasks: [EO_MASK], canonicalMask: EO_MASK,
  solver: { moveSet: BLOCK_MOVES, pruningDepth: 4, depthLimit: 8 },
};
const STEP_EOLINE: StepDef = {
  id: 'eoline', label: 'EOLine', kind: 'eo',
  blurb: 'Orient all edges and place the DF and DB edges — the ZZ first step.',
  candidateMasks: [EOLINE_MASK], canonicalMask: EOLINE_MASK,
  solver: { moveSet: BLOCK_MOVES, pruningDepth: 4, depthLimit: 9 },
};
const STEP_PETRUS_EO: StepDef = {
  id: 'peo', label: 'Edge orientation', kind: 'eo',
  blurb: 'Orient the remaining edges while keeping your 2×2×3 intact (Petrus EO).',
  candidateMasks: [PETRUS_EO_MASK], canonicalMask: PETRUS_EO_MASK,
  solver: { moveSet: BLOCK_MOVES, pruningDepth: 4, depthLimit: 12 },
};

export const METHODS: Record<Method, MethodDef> = {
  Petrus: {
    method: 'Petrus',
    description: 'Build a 2×2×2, expand to a 2×2×3, then orient edges (EO).',
    steps: [STEP_222, STEP_223, STEP_PETRUS_EO],
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
    description: 'LEOR opening: a 1×2×3 first block, then the second-side block.',
    steps: [STEP_123_LEFT, STEP_123_RIGHT],
  },
  ZZ: {
    method: 'ZZ',
    description: 'ZZ approach: EOLine — orient all edges and place the bottom line first.',
    steps: [STEP_EOLINE],
  },
  EO: {
    method: 'EO',
    description: 'Pure edge-orientation drill — orient all 12 edges from a scramble.',
    steps: [STEP_EO],
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
