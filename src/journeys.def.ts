// Method + journey definitions (no ideal solutions here — those are generated
// from the solver into journeys.ideals.ts and merged at runtime by journeys.ts).

import { blockFromRanges, type BlockGoal } from './cube.ts';

export type Method = 'Petrus' | 'Roux' | 'LEOR' | 'APB';

export type BlockFamily = '222' | '223' | '123';

export interface PhaseDef {
  id: string;
  name: string;
  blurb: string;
  /** Detection family used for "block built anywhere" recognition. */
  family: BlockFamily;
  /** Canonical concrete goal used for ideal generation and anchored detection. */
  goal: BlockGoal;
}

export interface MethodDef {
  method: Method;
  description: string;
  phases: PhaseDef[];
}

// --- Canonical goals (a fixed orientation; "anywhere" detection is layered on top) ---
// Axes: x 0=L 2=R, y 0=D 2=U, z 0=B 2=F.
const G_222 = blockFromRanges([0, 1], [0, 1], [1, 2]); // DLF 2×2×2
const G_223 = blockFromRanges([0, 1], [0, 1], [0, 1, 2]); // bottom-left 2×2×3 (contains the DLF block)
const G_123_LEFT = blockFromRanges([0], [0, 1], [0, 1, 2]); // L-side 1×2×3 (Roux left block)
const G_123_RIGHT = blockFromRanges([2], [0, 1], [0, 1, 2]); // R-side 1×2×3 (Roux right block)

export const METHODS: Record<Method, MethodDef> = {
  Petrus: {
    method: 'Petrus',
    description: 'Build a 2×2×2 block, then expand it to a 2×2×3.',
    phases: [
      {
        id: 'p222',
        name: '2×2×2 block',
        blurb: 'Build a solved 2×2×2 corner block. Plan it inspection-free — no algorithms, just intuition.',
        family: '222',
        goal: G_222,
      },
      {
        id: 'p223',
        name: '2×2×3 block',
        blurb: 'Extend your 2×2×2 into a 2×2×3 by solving the adjacent corner and two edges.',
        family: '223',
        goal: G_223,
      },
    ],
  },
  APB: {
    method: 'APB',
    description: 'Advanced Petrus Blocks: 2×2×2, then a 2×2×3, set up for APB last-layer-friendly continuations.',
    phases: [
      {
        id: 'a222',
        name: '2×2×2 block',
        blurb: 'Build a solved 2×2×2 block. APB shares the Petrus opening.',
        family: '222',
        goal: G_222,
      },
      {
        id: 'a223',
        name: '2×2×3 block',
        blurb: 'Expand to a 2×2×3. Keep your remaining pieces tracked for the APB continuation.',
        family: '223',
        goal: G_223,
      },
    ],
  },
  Roux: {
    method: 'Roux',
    description: 'Build a 1×2×3 first block, then a second 1×2×3 block on the opposite side.',
    phases: [
      {
        id: 'r1',
        name: 'First block (1×2×3)',
        blurb: 'Build a 1×2×3 block against a centre — 2 corners and 3 edges, no algorithms.',
        family: '123',
        goal: G_123_LEFT,
      },
      {
        id: 'r2',
        name: 'Second block (1×2×3)',
        blurb: 'Build the second 1×2×3 on the opposite side, sharing the bottom layer with the first.',
        family: '123',
        goal: G_123_RIGHT,
      },
    ],
  },
  LEOR: {
    method: 'LEOR',
    description: 'LEOR opening: a 1×2×3 first block, then the second-side block (EO/line continues from here).',
    phases: [
      {
        id: 'l1',
        name: 'First block (1×2×3)',
        blurb: 'Build a 1×2×3 first block on the left, the LEOR opening.',
        family: '123',
        goal: G_123_LEFT,
      },
      {
        id: 'l2',
        name: 'Second block (1×2×3)',
        blurb: 'Build the right-side 1×2×3. (Full LEOR then does EO + line — trained later.)',
        family: '123',
        goal: G_123_RIGHT,
      },
    ],
  },
};

export interface ScrambleDef {
  id: string;
  scramble: string;
}

// A small set of fixed scrambles. Ideal solutions are generated per (method, scramble).
export const SCRAMBLES: ScrambleDef[] = [
  { id: 's1', scramble: "F2 B' D' U F' R2 U2 D B' L2 D' R F' B2 L2 B U2 D' L2 F2" },
  { id: 's2', scramble: "U2 D B' R2 B' R D2 U' B U' B D2 B2 R' U F D' U' F2 B" },
  { id: 's3', scramble: "L' R U F R B2 F' R B2 L F' R' D F2 D2 U' F' D L D" },
];

export function ideObjKey(method: Method, scrambleId: string, phaseId: string): string {
  return `${method}::${scrambleId}::${phaseId}`;
}
