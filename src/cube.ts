// Cube model using the standard Kociemba "cubie" representation.
//
// Corners (index = home slot):
//   URF=0 UFL=1 ULB=2 UBR=3 DFR=4 DLF=5 DBL=6 DRB=7
// Edges (index = home slot):
//   UR=0 UF=1 UL=2 UB=3 DR=4 DF=5 DL=6 DB=7 FR=8 FL=9 BL=10 BR=11
//
// A CubieCube tracks, for each slot, which piece currently occupies it (cp/ep)
// and that piece's orientation (co in {0,1,2}, eo in {0,1}). Centres are fixed,
// so a piece is "home and oriented" when cp[i]===i && co[i]===0 (and likewise
// for edges). All block detection is expressed in those terms.

export interface CubieCube {
  cp: number[]; // corner permutation (8)
  co: number[]; // corner orientation (8)
  ep: number[]; // edge permutation (12)
  eo: number[]; // edge orientation (12)
}

export const CORNER_NAMES = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'] as const;
export const EDGE_NAMES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'] as const;

export function solvedCube(): CubieCube {
  return {
    cp: [0, 1, 2, 3, 4, 5, 6, 7],
    co: [0, 0, 0, 0, 0, 0, 0, 0],
    ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

export function cloneCube(c: CubieCube): CubieCube {
  return { cp: c.cp.slice(), co: c.co.slice(), ep: c.ep.slice(), eo: c.eo.slice() };
}

export function cubesEqual(a: CubieCube, b: CubieCube): boolean {
  for (let i = 0; i < 8; i++) if (a.cp[i] !== b.cp[i] || a.co[i] !== b.co[i]) return false;
  for (let i = 0; i < 12; i++) if (a.ep[i] !== b.ep[i] || a.eo[i] !== b.eo[i]) return false;
  return true;
}

export function isSolved(c: CubieCube): boolean {
  return cubesEqual(c, solvedCube());
}

// --- Basic quarter-turn move definitions (Kociemba constants) ---

const MOVE_DEFS: Record<string, CubieCube> = {
  U: {
    cp: [3, 0, 1, 2, 4, 5, 6, 7],
    co: [0, 0, 0, 0, 0, 0, 0, 0],
    ep: [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  R: {
    cp: [4, 1, 2, 0, 7, 5, 6, 3],
    co: [2, 0, 0, 1, 1, 0, 0, 2],
    ep: [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  F: {
    cp: [1, 5, 2, 3, 0, 4, 6, 7],
    co: [1, 2, 0, 0, 2, 1, 0, 0],
    ep: [0, 9, 2, 3, 4, 8, 6, 7, 1, 5, 10, 11],
    eo: [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0],
  },
  D: {
    cp: [0, 1, 2, 3, 5, 6, 7, 4],
    co: [0, 0, 0, 0, 0, 0, 0, 0],
    ep: [0, 1, 2, 3, 5, 6, 7, 4, 8, 9, 10, 11],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  L: {
    cp: [0, 2, 6, 3, 4, 1, 5, 7],
    co: [0, 1, 2, 0, 0, 2, 1, 0],
    ep: [0, 1, 10, 3, 4, 5, 9, 7, 8, 2, 6, 11],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  B: {
    cp: [0, 1, 3, 7, 4, 5, 2, 6],
    co: [0, 0, 1, 2, 0, 0, 2, 1],
    ep: [0, 1, 2, 11, 4, 5, 6, 10, 8, 9, 3, 7],
    eo: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1],
  },
};

// Apply move `m` to state `a` (i.e. a * m). Returns a new cube.
export function multiply(a: CubieCube, m: CubieCube): CubieCube {
  const r = solvedCube();
  for (let i = 0; i < 8; i++) {
    r.cp[i] = a.cp[m.cp[i]];
    r.co[i] = (a.co[m.cp[i]] + m.co[i]) % 3;
  }
  for (let i = 0; i < 12; i++) {
    r.ep[i] = a.ep[m.ep[i]];
    r.eo[i] = (a.eo[m.ep[i]] + m.eo[i]) % 2;
  }
  return r;
}

// The 18 face moves (face + quarter/half/prime), built from the 6 quarter turns.
export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'] as const;
export const ALL_MOVES: string[] = [];
// Full move table for all 18 face moves (U U2 U' ...). Exposed for the solver.
export const MOVE_TABLE: Record<string, CubieCube> = {};
for (const face of FACES) {
  const q = MOVE_DEFS[face];
  const q2 = multiply(q, q);
  const q3 = multiply(q2, q);
  MOVE_TABLE[face] = q;
  MOVE_TABLE[face + '2'] = q2;
  MOVE_TABLE[face + "'"] = q3;
  ALL_MOVES.push(face, face + '2', face + "'");
}

export function moveCube(c: CubieCube, move: string): CubieCube {
  const m = MOVE_TABLE[move];
  if (!m) throw new Error(`Unknown move: ${move}`);
  return multiply(c, m);
}

export function applyScramble(c: CubieCube, scramble: string): CubieCube {
  return applyMoveList(c, parseMoves(scramble));
}

export function applyMoveList(c: CubieCube, moves: string[]): CubieCube {
  let cube = c;
  for (const tok of moves) cube = moveCube(cube, tok);
  return cube;
}

export function parseMoves(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

export function invertMoves(moves: string[]): string[] {
  const inv = (m: string) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0] : m + "'");
  return moves.slice().reverse().map(inv);
}

// --- Facelet (Kociemba string) parsing, for resyncing from a GAN FACELETS event ---
// Facelet string order: U1..U9 R1..R9 F1..F9 D1..D9 L1..L9 B1..B9.

const cornerFacelet = [
  [8, 9, 20], // URF
  [6, 18, 38], // UFL
  [0, 36, 47], // ULB
  [2, 45, 11], // UBR
  [29, 26, 15], // DFR
  [27, 44, 24], // DLF
  [33, 53, 42], // DBL
  [35, 17, 51], // DRB
];
const edgeFacelet = [
  [5, 10], // UR
  [7, 19], // UF
  [3, 37], // UL
  [1, 46], // UB
  [32, 16], // DR
  [28, 25], // DF
  [30, 43], // DL
  [34, 52], // DB
  [23, 12], // FR
  [21, 41], // FL
  [50, 39], // BL
  [48, 14], // BR
];
const cornerColor = [
  ['U', 'R', 'F'],
  ['U', 'F', 'L'],
  ['U', 'L', 'B'],
  ['U', 'B', 'R'],
  ['D', 'F', 'R'],
  ['D', 'L', 'F'],
  ['D', 'B', 'L'],
  ['D', 'R', 'B'],
];
const edgeColor = [
  ['U', 'R'],
  ['U', 'F'],
  ['U', 'L'],
  ['U', 'B'],
  ['D', 'R'],
  ['D', 'F'],
  ['D', 'L'],
  ['D', 'B'],
  ['F', 'R'],
  ['F', 'L'],
  ['B', 'L'],
  ['B', 'R'],
];

/** Parse a 54-char Kociemba facelet string into a CubieCube. Throws on invalid input. */
export function cubeFromFacelets(facelets: string): CubieCube {
  if (facelets.length !== 54) throw new Error(`Facelet string must be 54 chars, got ${facelets.length}`);
  const f = facelets.split('');
  const c = solvedCube();

  for (let i = 0; i < 8; i++) {
    // find orientation: which sticker is U or D
    let ori = 0;
    for (; ori < 3; ori++) {
      const col = f[cornerFacelet[i][ori]];
      if (col === 'U' || col === 'D') break;
    }
    if (ori === 3) throw new Error('Invalid corner orientation');
    const col1 = f[cornerFacelet[i][(ori + 1) % 3]];
    const col2 = f[cornerFacelet[i][(ori + 2) % 3]];
    for (let j = 0; j < 8; j++) {
      if (col1 === cornerColor[j][1] && col2 === cornerColor[j][2]) {
        c.cp[i] = j;
        c.co[i] = ori % 3;
        break;
      }
    }
  }

  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) {
      const a = f[edgeFacelet[i][0]];
      const b = f[edgeFacelet[i][1]];
      if (a === edgeColor[j][0] && b === edgeColor[j][1]) {
        c.ep[i] = j;
        c.eo[i] = 0;
        break;
      }
      if (a === edgeColor[j][1] && b === edgeColor[j][0]) {
        c.ep[i] = j;
        c.eo[i] = 1;
        break;
      }
    }
  }
  return c;
}

// Render the cube state to a 54-char facelet string (face letters U R F D L B).
// Inverse of cubeFromFacelets; order: U(0-8) R(9-17) F(18-26) D(27-35) L(36-44) B(45-53).
const CENTER_FACELET = [4, 13, 22, 31, 40, 49];
const CENTER_COLOR = ['U', 'R', 'F', 'D', 'L', 'B'];

export function cubeToFaceletString(c: CubieCube): string {
  const f = new Array(54).fill('.');
  for (let i = 0; i < 6; i++) f[CENTER_FACELET[i]] = CENTER_COLOR[i];
  for (let i = 0; i < 8; i++) {
    const j = c.cp[i];
    const ori = c.co[i];
    for (let n = 0; n < 3; n++) f[cornerFacelet[i][(n + ori) % 3]] = cornerColor[j][n];
  }
  for (let i = 0; i < 12; i++) {
    const j = c.ep[i];
    const ori = c.eo[i];
    for (let n = 0; n < 2; n++) f[edgeFacelet[i][(n + ori) % 2]] = edgeColor[j][n];
  }
  return f.join('');
}

// --- Geometry: coordinates of each cubie slot, used to generate block goals ---
// Axes: x: 0=L 2=R, y: 0=D 2=U, z: 0=B 2=F. Centres have a coord === 1.

export const CORNER_COORDS: [number, number, number][] = [
  [2, 2, 2], // URF
  [0, 2, 2], // UFL
  [0, 2, 0], // ULB
  [2, 2, 0], // UBR
  [2, 0, 2], // DFR
  [0, 0, 2], // DLF
  [0, 0, 0], // DBL
  [2, 0, 0], // DRB
];
export const EDGE_COORDS: [number, number, number][] = [
  [2, 2, 1], // UR
  [1, 2, 2], // UF
  [0, 2, 1], // UL
  [1, 2, 0], // UB
  [2, 0, 1], // DR
  [1, 0, 2], // DF
  [0, 0, 1], // DL
  [1, 0, 0], // DB
  [2, 1, 2], // FR
  [0, 1, 2], // FL
  [0, 1, 0], // BL
  [2, 1, 0], // BR
];

export interface BlockGoal {
  corners: number[]; // corner slot indices that must be home + oriented
  edges: number[]; // edge slot indices that must be home + oriented
}

export type Range = [number, number, number]; // membership predicate per axis as inclusive set

function inRange(coord: number, allowed: number[]): boolean {
  return allowed.includes(coord);
}

/** Build a BlockGoal from per-axis allowed coordinate sets (e.g. x ∈ {0,1}). */
export function blockFromRanges(xs: number[], ys: number[], zs: number[]): BlockGoal {
  const corners: number[] = [];
  const edges: number[] = [];
  CORNER_COORDS.forEach(([x, y, z], i) => {
    if (inRange(x, xs) && inRange(y, ys) && inRange(z, zs)) corners.push(i);
  });
  EDGE_COORDS.forEach(([x, y, z], i) => {
    if (inRange(x, xs) && inRange(y, ys) && inRange(z, zs)) edges.push(i);
  });
  return { corners, edges };
}

function pairs(): number[][] {
  return [
    [0, 1],
    [1, 2],
  ];
}
const FULL = [0, 1, 2];

/** All 8 distinct 2×2×2 sub-blocks. */
export function all222(): BlockGoal[] {
  const out: BlockGoal[] = [];
  for (const xs of pairs()) for (const ys of pairs()) for (const zs of pairs()) out.push(blockFromRanges(xs, ys, zs));
  return out;
}

/** All 12 distinct 2×2×3 sub-blocks (one full axis, two 2-wide axes). */
export function all223(): BlockGoal[] {
  const out: BlockGoal[] = [];
  // long axis = x
  for (const ys of pairs()) for (const zs of pairs()) out.push(blockFromRanges(FULL, ys, zs));
  // long axis = y
  for (const xs of pairs()) for (const zs of pairs()) out.push(blockFromRanges(xs, FULL, zs));
  // long axis = z
  for (const xs of pairs()) for (const ys of pairs()) out.push(blockFromRanges(xs, ys, FULL));
  return out;
}

/** All distinct 1×2×3 sub-blocks (one full axis, one 2-wide axis, one single layer). */
export function all123(): BlockGoal[] {
  const out: BlockGoal[] = [];
  const singles = [[0], [1], [2]];
  // full=x, 2-wide=y, single=z
  for (const ys of pairs()) for (const zs of singles) out.push(blockFromRanges(FULL, ys, zs));
  // full=x, single=y, 2-wide=z
  for (const ys of singles) for (const zs of pairs()) out.push(blockFromRanges(FULL, ys, zs));
  // full=y, 2-wide=x, single=z
  for (const xs of pairs()) for (const zs of singles) out.push(blockFromRanges(xs, FULL, zs));
  // full=y, single=x, 2-wide=z
  for (const xs of singles) for (const zs of pairs()) out.push(blockFromRanges(xs, FULL, zs));
  // full=z, 2-wide=x, single=y
  for (const xs of pairs()) for (const ys of singles) out.push(blockFromRanges(xs, ys, FULL));
  // full=z, single=x, 2-wide=y
  for (const xs of singles) for (const ys of pairs()) out.push(blockFromRanges(xs, ys, FULL));
  return out;
}

/** True if every piece in the goal is home and correctly oriented. */
export function goalSolved(c: CubieCube, g: BlockGoal): boolean {
  for (const i of g.corners) if (c.cp[i] !== i || c.co[i] !== 0) return false;
  for (const i of g.edges) if (c.ep[i] !== i || c.eo[i] !== 0) return false;
  return true;
}

/** Among candidates, return the first goal that is fully solved, or null. */
export function findSolvedBlock(c: CubieCube, candidates: BlockGoal[]): BlockGoal | null {
  for (const g of candidates) if (goalSolved(c, g)) return g;
  return null;
}

/** Fraction (0..1) of the goal's pieces currently home+oriented — for progress UI. */
export function goalProgress(c: CubieCube, g: BlockGoal): number {
  const total = g.corners.length + g.edges.length;
  if (total === 0) return 1;
  let done = 0;
  for (const i of g.corners) if (c.cp[i] === i && c.co[i] === 0) done++;
  for (const i of g.edges) if (c.ep[i] === i && c.eo[i] === 0) done++;
  return done / total;
}
