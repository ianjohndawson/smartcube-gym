// Step + trainer registry, grouped into top-level categories (Blocks, EO).
// Each TrainerDef is a sequence of StepDefs sharing one shell.

import {
  all123Masks,
  all222Masks,
  all223Masks,
  blockMaskFromRanges,
  MASK_123_LEFT,
  MASK_123_RIGHT,
  MASK_222_DLF,
  MASK_223_BOTTOM_LEFT,
} from './blocks.ts';
import { MOVESETS, type Cube3x3Mask, type Move3x3, type StepSolverConfig } from './engine-api.ts';
import { MASKS } from './engine/puzzles/cube3x3/index.ts';

export type Category = 'EO' | 'Blocks' | 'Journey';
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
  /** Optional how-to-hold / which-axis note shown during the step. */
  hold?: string;
  /** For standalone drills: a block already built at the start (the scramble
   *  pre-builds it), so the user only practises this step's new work. */
  prereqMask?: Cube3x3Mask;
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
  id: '222', label: '2×2', kind: 'block', family: '222',
  blurb: 'Build a solved 2×2×2 corner block — intuition, not algorithms.',
  candidateMasks: all222Masks(), canonicalMask: MASK_222_DLF, solver: SOLVER['222'],
};
const STEP_223: StepDef = {
  id: '223', label: '2×2×3', kind: 'block', family: '223',
  blurb: 'Build a 2×2×3 block — any route (2×2 then extend, line + pairs, …).',
  candidateMasks: all223Masks(), canonicalMask: MASK_223_BOTTOM_LEFT, solver: SOLVER['223'],
};
const STEP_123_LEFT: StepDef = {
  id: '123L', label: '1×2×3 L', kind: 'block', family: '123',
  blurb: 'Build a 1×2×3 block against a centre — 2 corners and 3 edges.',
  candidateMasks: all123Masks(), canonicalMask: MASK_123_LEFT, solver: SOLVER['123'],
};

// --- EO steps ---
const EO_MASK = MASKS.EO as Cube3x3Mask;
const EOLINE_MASK = MASKS.EOLine as Cube3x3Mask;
const EOCROSS_MASK = MASKS.EOCross as Cube3x3Mask;
// EO orbit facelets (F/B axis) reused to compose block-preserving EO targets.
const EO_FACELETS = MASKS.EO.eoFaceletIndices!;

// Petrus EO: orient all edges while keeping the 2×2×3. Target = the 2×2×3 block
// AND every edge oriented; the optimal solver may break the block mid-solution
// but must restore it (that's exactly the real Petrus EO step).
const MASK_223_EO: Cube3x3Mask = {
  solvedFaceletIndices: MASK_223_BOTTOM_LEFT.solvedFaceletIndices,
  eoFaceletIndices: EO_FACELETS,
};
const MASK_123_EO: Cube3x3Mask = {
  solvedFaceletIndices: MASK_123_LEFT.solvedFaceletIndices,
  eoFaceletIndices: EO_FACELETS,
};

// Two 1×2×2 squares — one on the left, one on the right (bottom, front side).
const MASK_122_L = blockMaskFromRanges([0], [0, 1], [1, 2]);
const MASK_122_R = blockMaskFromRanges([2], [0, 1], [1, 2]);
const MASK_122_LR: Cube3x3Mask = {
  solvedFaceletIndices: [...MASK_122_L.solvedFaceletIndices, ...MASK_122_R.solvedFaceletIndices],
};
const MASK_122_LR_EO: Cube3x3Mask = {
  solvedFaceletIndices: MASK_122_LR.solvedFaceletIndices,
  eoFaceletIndices: EO_FACELETS,
};
// Both side 1×2×3 blocks (left already built, right being built) — Roux F2B sides.
const MASK_123_LR: Cube3x3Mask = {
  solvedFaceletIndices: [...MASK_123_LEFT.solvedFaceletIndices, ...MASK_123_RIGHT.solvedFaceletIndices],
};

const STEP_EO: StepDef = {
  id: 'eo', label: 'EO', kind: 'eo',
  blurb: 'Orient all 12 edges so the rest can be solved with R, L, U and D only.',
  candidateMasks: [EO_MASK], canonicalMask: EO_MASK,
  hold: 'Orient all 12 edges on the F/B axis — no block to keep.',
  solver: { moveSet: BLOCK_MOVES, pruningDepth: 4, depthLimit: 8 },
};
const STEP_EOLINE: StepDef = {
  id: 'eoline', label: 'EOLine', kind: 'eo',
  blurb: 'Orient all edges and place the DF and DB edges — the ZZ first step.',
  candidateMasks: [EOLINE_MASK], canonicalMask: EOLINE_MASK,
  hold: 'White on top; orient on the F/B axis and place the DF/DB line (ZZ).',
  solver: { moveSet: BLOCK_MOVES, pruningDepth: 4, depthLimit: 9 },
};
const STEP_EOCROSS: StepDef = {
  id: 'eocross', label: 'EOCross', kind: 'eo',
  blurb: 'Orient all edges and solve the bottom cross in one — an advanced ZZ start.',
  candidateMasks: [EOCROSS_MASK], canonicalMask: EOCROSS_MASK,
  hold: 'White on top; orient on the F/B axis while building the D-cross (ZZ).',
  solver: { moveSet: BLOCK_MOVES, pruningDepth: 4, depthLimit: 10 },
};
const STEP_PETRUS_EO: StepDef = {
  id: 'petrus-eo', label: 'EO (keep the block)', kind: 'eo',
  blurb: 'Orient all 12 edges while keeping your 2×2×3 intact — the Petrus EO step.',
  candidateMasks: [MASK_223_EO], canonicalMask: MASK_223_EO,
  hold: 'Keep the 2×2×3 intact and orient edges on the F/B axis (Petrus holds the block at the back).',
  solver: { moveSet: BLOCK_MOVES, pruningDepth: 5, depthLimit: 14 },
};
// Standalone drills: the scramble pre-builds the block (prereqMask), leaving only EO to do.
const STEP_EO_223: StepDef = {
  id: 'eo223', label: '2×2×3 L', kind: 'eo',
  blurb: 'Starting from a finished 2×2×3, orient all 12 edges without breaking it (the Petrus EO skill, drilled on its own).',
  candidateMasks: [MASK_223_EO], canonicalMask: MASK_223_EO, prereqMask: MASK_223_BOTTOM_LEFT,
  hold: 'Keep the 2×2×3 intact; orient edges on the F/B axis (block held at the back).',
  solver: { moveSet: BLOCK_MOVES, pruningDepth: 5, depthLimit: 14 },
};
const STEP_EO_123: StepDef = {
  id: 'eo123', label: '1×2×3 L', kind: 'eo',
  blurb: 'Starting from a finished 1×2×3 first block, orient all 12 edges without breaking it (LEOR/Roux-style EO).',
  candidateMasks: [MASK_123_EO], canonicalMask: MASK_123_EO, prereqMask: MASK_123_LEFT,
  hold: 'Keep the 1×2×3 intact; orient edges on the F/B axis.',
  solver: { moveSet: BLOCK_MOVES, pruningDepth: 5, depthLimit: 14 },
};
const STEP_EO_122LR: StepDef = {
  id: 'eo122lr', label: '1×2×2 L+R', kind: 'eo',
  blurb: 'Starting from two 1×2×2 squares (left + right), orient all 12 edges without breaking either.',
  candidateMasks: [MASK_122_LR_EO], canonicalMask: MASK_122_LR_EO, prereqMask: MASK_122_LR,
  hold: 'Keep both 1×2×2 squares (left + right); orient on the F/B axis.',
  solver: { moveSet: BLOCK_MOVES, pruningDepth: 5, depthLimit: 14 },
};

// --- block-building drills ---
const STEP_223_EXT: StepDef = {
  id: '223ext', label: '2×2 → 2×2×3', kind: 'block', family: '223',
  blurb: 'Extend a finished 2×2×2 into a 2×2×3 — solve the adjacent corner and two edges.',
  candidateMasks: [MASK_223_BOTTOM_LEFT], canonicalMask: MASK_223_BOTTOM_LEFT, prereqMask: MASK_222_DLF,
  hold: 'Your 2×2×2 is already built; grow it along the back into a 2×2×3.',
  solver: SOLVER['223'],
};
const STEP_123_RIGHT_DRILL: StepDef = {
  id: '123Rd', label: '1×2×3 R (L solved)', kind: 'block', family: '123',
  blurb: 'Build the right 1×2×3 with the left block already solved (Roux second block).',
  candidateMasks: [MASK_123_LR], canonicalMask: MASK_123_LR, prereqMask: MASK_123_LEFT,
  hold: 'Left 1×2×3 is already built; build the right one without disturbing it.',
  solver: SOLVER['123'],
};

export const TRAINERS: TrainerDef[] = [
  // EO — orient edges, keeping progressively more built. (2×3×3 B is coming once
  // its scramble generator can pre-build two full layers cheaply.)
  { id: 'eo', label: 'Full', category: 'EO', description: 'Orient all 12 edges (free — no block kept). The core EO skill.', steps: [STEP_EO] },
  { id: 'eo123L', label: '1×2×3 L', category: 'EO', description: 'Orient all edges while preserving a finished 1×2×3 first block (LEOR/Roux).', steps: [STEP_EO_123] },
  { id: 'eo122LR', label: '1×2×2 L+R', category: 'EO', description: 'Orient all edges while preserving two 1×2×2 squares (left + right).', steps: [STEP_EO_122LR] },
  { id: 'eo223L', label: '2×2×3 L', category: 'EO', description: 'Orient all edges while preserving a finished 2×2×3 (Petrus EO, drilled alone).', steps: [STEP_EO_223] },

  // Block building — individual block skills.
  { id: 'b123L', label: '1×2×3 L', category: 'Blocks', description: 'Build a 1×2×3 first block against a centre.', steps: [STEP_123_LEFT] },
  { id: 'b123R', label: '1×2×3 R (L solved)', category: 'Blocks', description: 'Build the right 1×2×3 with the left already solved (Roux second block).', steps: [STEP_123_RIGHT_DRILL] },
  { id: 'b222', label: '2×2', category: 'Blocks', description: 'Build a 2×2×2 corner block.', steps: [STEP_222] },
  { id: 'b223ext', label: '2×2 → 2×2×3', category: 'Blocks', description: 'Extend a finished 2×2×2 into a 2×2×3.', steps: [STEP_223_EXT] },
  { id: 'b223', label: '2×2×3', category: 'Blocks', description: 'Build a 2×2×3 from a scramble — any route.', steps: [STEP_223] },

  // Journeys — full method openings, chained onto one scramble.
  { id: 'petrus', label: 'Petrus', category: 'Journey', description: 'Build a 2×2×2, expand to a 2×2×3, then orient all edges keeping the block.', steps: [STEP_222, STEP_223, STEP_PETRUS_EO] },
];

export const CATEGORIES: Category[] = ['EO', 'Blocks', 'Journey'];

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

// EO-preserving moves (no quarter F/B), so they mess up the permutation without
// changing edge orientation. Used to make a from-solved cube look scrambled
// before the short EO-pattern setup.
const EO_SAFE: Move3x3[] = ['U', "U'", 'U2', 'D', "D'", 'D2', 'R', "R'", 'R2', 'L', "L'", 'L2', 'F2', 'B2'];
export function genEoSafeScramble(n = 10): Move3x3[] {
  const out: Move3x3[] = [];
  let last = '';
  while (out.length < n) {
    const m = EO_SAFE[Math.floor(Math.random() * EO_SAFE.length)];
    if (m[0] === last) continue;
    out.push(m);
    last = m[0];
  }
  return out;
}

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
