// Piece analysis for "nudge" coaching: identify the next piece a step's optimal
// solution places, locate where it currently sits, and describe it in words.
//
// Works entirely in the engine's net-order facelet model, grouping facelets into
// cubies by shared coordinate (from NET_COORDS).

import { NET_COORDS } from './blocks.ts';
import { SOLVED_FACELET_CUBE, applyMove, type Cube3x3, type Cube3x3Mask, type Move3x3 } from './engine-api.ts';

// Group all 54 facelets into cubies by coordinate.
const byCoord = new Map<string, number[]>();
NET_COORDS.forEach((c, i) => {
  const k = c.join(',');
  const g = byCoord.get(k) ?? [];
  g.push(i);
  byCoord.set(k, g);
});
const ALL_GROUPS = [...byCoord.values()];
const CORNER_GROUPS = ALL_GROUPS.filter((g) => g.length === 3);
const EDGE_GROUPS = ALL_GROUPS.filter((g) => g.length === 2);

const COLOR_NAME: Record<string, string> = {
  U: 'white',
  D: 'yellow',
  F: 'green',
  B: 'blue',
  R: 'red',
  L: 'orange',
};

export interface FocusPiece {
  /** Facelet indices where the piece currently sits (to highlight). */
  current: number[];
  /** Facelet indices of the piece's home (where it belongs). */
  home: number[];
  /** Human description, e.g. "white-green-red corner". */
  description: string;
  /** Optimal moves until this piece is placed (drives technique naming). */
  movesToPlace: number;
}

interface TargetPiece {
  home: number[];
  colors: string[]; // solved colours at home
}

function sortedColors(cs: string[]): string {
  return [...cs].sort().join('');
}

function targetPieces(mask: Cube3x3Mask): TargetPiece[] {
  const groups = new Map<string, number[]>();
  for (const i of mask.solvedFaceletIndices) {
    const k = NET_COORDS[i].join(',');
    const g = groups.get(k) ?? [];
    g.push(i);
    groups.set(k, g);
  }
  return [...groups.values()]
    .filter((home) => home.length > 1) // ignore centres
    .map((home) => ({ home, colors: home.map((i) => SOLVED_FACELET_CUBE[i]) }));
}

function pieceSolved(facelets: readonly string[], home: number[]): boolean {
  return home.every((i) => facelets[i] === SOLVED_FACELET_CUBE[i]);
}

/** Current facelet indices of the cubie carrying the given colours. */
function locate(facelets: readonly string[], colors: string[]): number[] | null {
  const want = sortedColors(colors);
  const pool = colors.length === 3 ? CORNER_GROUPS : EDGE_GROUPS;
  for (const g of pool) {
    if (sortedColors(g.map((i) => facelets[i])) === want) return g;
  }
  return null;
}

function describe(colors: string[]): string {
  const names = colors.map((c) => COLOR_NAME[c] ?? c).join('-');
  return `${names} ${colors.length === 3 ? 'corner' : 'edge'}`;
}

/**
 * The next piece the optimal solution places: simulate the solution and return
 * the first currently-unsolved target piece that becomes solved, with its
 * current location (in the starting state) for highlighting.
 */
export function nextFocusPiece(state: Cube3x3, mask: Cube3x3Mask, optimalMoves: Move3x3[]): FocusPiece | null {
  const startArr = state.stateData;
  const pieces = targetPieces(mask);
  const unsolved = pieces.filter((p) => !pieceSolved(startArr, p.home));
  if (unsolved.length === 0) return null;

  let cur = state;
  for (let k = 0; k < optimalMoves.length; k++) {
    cur = applyMove(cur, optimalMoves[k]);
    const arr = cur.stateData;
    for (const p of unsolved) {
      if (pieceSolved(arr, p.home)) {
        const current = locate(startArr, p.colors) ?? p.home;
        return { current, home: p.home, description: describe(p.colors), movesToPlace: k + 1 };
      }
    }
  }
  // fallback: first unsolved piece, located in the starting state
  const p = unsolved[0];
  return { current: locate(startArr, p.colors) ?? p.home, home: p.home, description: describe(p.colors), movesToPlace: optimalMoves.length };
}
