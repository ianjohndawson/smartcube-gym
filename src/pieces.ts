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

// Face letter at an extreme axis value, per axis (x: L/R, y: D/U, z: B/F).
const AXIS_FACE: Record<number, Record<number, string>> = {
  0: { 0: 'L', 2: 'R' },
  1: { 0: 'D', 2: 'U' },
  2: { 0: 'B', 2: 'F' },
};

/** Short human name for a block placement mask. A 2×2×2 is named by its anchor
 * corner's colours ("white-green-red corner"); slabs are named by their extreme
 * faces with the thin (anchor) face first — so the L-anchored lower 1×2×3 is
 * "orange–yellow" while the D-anchored left one is "yellow–orange". */
export function placementName(mask: Cube3x3Mask): string {
  const vals: [Set<number>, Set<number>, Set<number>] = [new Set(), new Set(), new Set()];
  for (const i of mask.solvedFaceletIndices) {
    const c = NET_COORDS[i];
    vals[0].add(c[0]);
    vals[1].add(c[1]);
    vals[2].add(c[2]);
  }
  const ax = vals.map((s) => [...s].sort((a, b) => a - b));
  if (ax.every((a) => a.length === 2)) {
    // 2×2×2: the octant's anchor corner (its all-extreme coordinate).
    const corner = ax.map((a) => (a.includes(0) ? 0 : 2)).join(',');
    const group = CORNER_GROUPS.find((g) => NET_COORDS[g[0]].join(',') === corner);
    if (group) return describe(group.map((i) => SOLVED_FACELET_CUBE[i]));
  }
  const anchors = ax.map((a, axis) => (a.length === 1 ? AXIS_FACE[axis][a[0]] : null));
  const extremes = ax.map((a, axis) => (a.length === 2 ? AXIS_FACE[axis][a.includes(0) ? 0 : 2] : null));
  const faces = [...anchors, ...extremes].filter((f): f is string => f != null);
  return faces.map((f) => COLOR_NAME[f] ?? f).join('–');
}

/** The first TWO pieces a route places, for the lookahead drill: you plan the
 *  join of `first` while predicting where `second` will be once it's done. */
export function nextTwoFocusPieces(
  state: Cube3x3,
  mask: Cube3x3Mask,
  moves: Move3x3[],
): { first: FocusPiece; second: FocusPiece } | null {
  const startArr = state.stateData;
  const unsolved = targetPieces(mask).filter((p) => !pieceSolved(startArr, p.home));
  if (unsolved.length < 2) return null; // nothing beyond the next join — no lookahead
  const found: FocusPiece[] = [];
  const seen = new Set<TargetPiece>();
  let cur = state;
  for (let k = 0; k < moves.length && found.length < 2; k++) {
    cur = applyMove(cur, moves[k]);
    const arr = cur.stateData;
    for (const p of unsolved) {
      if (seen.has(p) || !pieceSolved(arr, p.home)) continue;
      seen.add(p);
      found.push({
        current: locate(startArr, p.colors) ?? p.home,
        home: p.home,
        description: describe(p.colors),
        movesToPlace: k + 1,
      });
      if (found.length === 2) break;
    }
  }
  return found.length === 2 ? { first: found[0], second: found[1] } : null;
}

/** Where the piece with these home facelets currently sits (its slot's facelet
 *  indices) — the truth the lookahead answer is checked against. */
export function locatePieceNow(state: Cube3x3, home: number[]): number[] {
  return locate(state.stateData, home.map((i) => SOLVED_FACELET_CUBE[i])) ?? home;
}

/** Human name for a SLOT (not a piece): the face colours it touches, e.g.
 *  "white-green-red corner spot". */
export function slotName(group: number[]): string {
  const faces = group.map((i) => (i < 9 ? 'U' : i >= 45 ? 'D' : ['L', 'L', 'L', 'F', 'F', 'F', 'R', 'R', 'R', 'B', 'B', 'B'][(i - 9) % 12]));
  const names = faces.map((f) => COLOR_NAME[f] ?? f).join('-');
  return `${names} ${group.length === 3 ? 'corner' : group.length === 2 ? 'edge' : 'centre'} spot`;
}

/** Each target piece's current cubie coordinate (x,y,z; y: 0=D,1=mid,2=U) + whether solved. */
export function targetPieceStates(state: Cube3x3, mask: Cube3x3Mask): { coord: readonly [number, number, number]; solved: boolean }[] {
  const arr = state.stateData;
  return targetPieces(mask).map((p) => {
    const cur = locate(arr, p.colors) ?? p.home;
    return { coord: NET_COORDS[cur[0]], solved: pieceSolved(arr, p.home) };
  });
}
