// Step + trainer registry, grouped into top-level categories (Blocks, EO).
// Each TrainerDef is a sequence of StepDefs sharing one shell.

import {
  all123Masks,
  all222Masks,
  all223Masks,
  MASK_123_LEFT,
  MASK_123_RIGHT,
  MASK_222_DLF,
  MASK_223_BOTTOM_LEFT,
} from './blocks.ts';
import { MOVESETS, type Cube3x3Mask, type Move3x3, type StepSolverConfig } from './engine-api.ts';
import { MASKS } from './engine/puzzles/cube3x3/index.ts';

export type Category = 'Blocks' | 'EO';
export type BlockFamily = '222' | '223' | '123';
export type StepKind = 'block' | 'eo';

export interface StepDef {
  id: string;
  label: string;
  blurb: string;
  kind: StepKind;
  family?: BlockFamily;
  candidateMasks: Cube3x3Mask[];
  canonicalMask: Cube3x3Mask;
  solver: StepSolverConfig;
}

export interface TrainerDef {
  id: string;
  label: string;
  category: Category;
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
const EOCROSS_MASK = MASKS.EOCross as Cube3x3Mask;

const STEP_EO: StepDef = {
  id: 'eo', label: 'EO', kind: 'eo',
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
const STEP_EOCROSS: StepDef = {
  id: 'eocross', label: 'EOCross', kind: 'eo',
  blurb: 'Orient all edges and solve the bottom cross in one — an advanced ZZ start.',
  candidateMasks: [EOCROSS_MASK], canonicalMask: EOCROSS_MASK,
  solver: { moveSet: BLOCK_MOVES, pruningDepth: 4, depthLimit: 10 },
};

export const TRAINERS: TrainerDef[] = [
  { id: 'petrus', label: 'Petrus', category: 'Blocks', description: 'Build a 2×2×2 block, then expand it to a 2×2×3.', steps: [STEP_222, STEP_223] },
  { id: 'apb', label: 'APB', category: 'Blocks', description: 'Advanced Petrus Blocks: 2×2×2, then a 2×2×3.', steps: [STEP_222, STEP_223] },
  { id: 'roux', label: 'Roux', category: 'Blocks', description: 'Build a 1×2×3 first block, then a second on the opposite side.', steps: [STEP_123_LEFT, STEP_123_RIGHT] },
  { id: 'leor', label: 'LEOR', category: 'Blocks', description: 'LEOR opening: a 1×2×3 first block, then the second-side block.', steps: [STEP_123_LEFT, STEP_123_RIGHT] },
  { id: 'eo', label: 'Full EO', category: 'EO', description: 'Orient all 12 edges (free — no block kept). The core EO skill.', steps: [STEP_EO] },
  { id: 'eoline', label: 'EOLine', category: 'EO', description: 'ZZ first step: orient all edges and place the bottom line.', steps: [STEP_EOLINE] },
  { id: 'eocross', label: 'EOCross', category: 'EO', description: 'Orient all edges and solve the bottom cross together.', steps: [STEP_EOCROSS] },
];

export const CATEGORIES: Category[] = ['Blocks', 'EO'];

export function trainersIn(category: Category): TrainerDef[] {
  return TRAINERS.filter((t) => t.category === category);
}
export function trainerById(id: string): TrainerDef {
  return TRAINERS.find((t) => t.id === id) ?? TRAINERS[0];
}

// --- scramble generation ---
const FACES = ['U', 'D', 'L', 'R', 'F', 'B'];
const SUFFIX = ['', '2', "'"];
const OPPOSITE: Record<string, string> = { U: 'D', D: 'U', L: 'R', R: 'L', F: 'B', B: 'F' };

/** A random WCA-style scramble (no same-face / canonical opposite-face order). */
export function genScramble(n = 16): Move3x3[] {
  const out: string[] = [];
  let last = '';
  let last2 = '';
  while (out.length < n) {
    const f = FACES[Math.floor(Math.random() * 6)];
    if (f === last) continue;
    if (OPPOSITE[f] === last && f === last2) continue;
    out.push(f + SUFFIX[Math.floor(Math.random() * 3)]);
    last2 = last;
    last = f;
  }
  return out as Move3x3[];
}
