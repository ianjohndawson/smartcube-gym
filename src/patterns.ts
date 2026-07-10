// Named block-building pattern detection — the Lars Petrus vocabulary.
//
// Grounded in the Block Building Patterns section of Ian's Lars Petrus mirror
// (ianjohndawson.github.io/LarsPetrus #blox); definitions signed off 2026-07-10:
//
//   Simple join          a target corner+edge are ONE move from forming a pair
//   Double join          one move completes a 2×2×1 (corner + 2 edges + centre)
//                        in place — the centre is fixed, so "merging" == placing
//   Swing                two moves: a pure setup, then a double join
//   Double swing         a symmetric 3–4 move setup ending in a double join
//                        (first and last move on the same face)
//   Roundabout           no pair exists; three turns manufacture one
//   Parallel roundabout  one sequence forms/places two pairs at once
//   Broken corner        the corner sits IN its own slot but wrong; extract,
//                        then rejoin (a step-4 / extension shape)
//   Pillar               corner stacked against its edge's slot — one twist
//                        from a join, sets up a double join (extension shape)
//
// Semantics are ROUTE EVENTS, not state templates: we simulate a route (the
// taught trail, or the user's own moves) and classify each placement segment by
// what actually happened — orientation- and placement-free, and mirror/inverse
// variants share a name exactly as Lars groups them. Guarded by
// scripts/patterns-check.ts: every case on the source page must classify as its
// own name and as nothing else.

import { NET_COORDS } from './blocks.ts';
import {
  SOLVED_FACELET_CUBE, applyMove,
  type Cube3x3, type Cube3x3Mask, type Move3x3,
} from './engine-api.ts';

export type PatternName =
  | 'Simple join' | 'Double join' | 'Swing' | 'Double swing'
  | 'Roundabout' | 'Parallel roundabout' | 'Broken corner' | 'Pillar';

/** One placement segment of a route: the moves between two placement events,
 *  ending when target pieces lock into the block. */
export interface JoinEvent {
  name: PatternName | null;
  /** Route move indices [from, to] (inclusive) covered by this segment. */
  from: number;
  to: number;
  /** How many whole target pieces the segment placed. */
  placed: number;
}

// --- geometry tables (module-load, from NET_COORDS) ---

type Face = 'U' | 'D' | 'L' | 'R' | 'F' | 'B';
const OPP: Record<Face, Face> = { U: 'D', D: 'U', L: 'R', R: 'L', F: 'B', B: 'F' };
const faceOf = (i: number): Face =>
  i < 9 ? 'U' : i >= 45 ? 'D' : (['L', 'L', 'L', 'F', 'F', 'F', 'R', 'R', 'R', 'B', 'B', 'B'] as const)[(i - 9) % 12];

const byCoord = new Map<string, number[]>();
NET_COORDS.forEach((c, i) => {
  const k = c.join(',');
  (byCoord.get(k) ?? byCoord.set(k, []).get(k)!).push(i);
});
const CORNERS = [...byCoord.values()].filter((g) => g.length === 3);
const EDGES = [...byCoord.values()].filter((g) => g.length === 2);

const faceKey = (fs: Face[]) => [...fs].sort().join(',');
// Slot lookup: which facelet of a slot lies on which face.
const EDGE_SLOT = new Map<string, Map<Face, number>>();
for (const g of EDGES) {
  const m = new Map<Face, number>();
  for (const i of g) m.set(faceOf(i), i);
  EDGE_SLOT.set(faceKey([...m.keys()]), m);
}

const sortedColors = (cs: string[]) => [...cs].sort().join('');
function locate(state: readonly string[], pool: number[][], homeColours: string[]): number[] {
  const want = sortedColors(homeColours);
  for (const g of pool) if (sortedColors(g.map((i) => state[i])) === want) return g;
  return [];
}

// --- the pair-joined test ---
//
// A corner C and adjacent edge E are "joined" when they form the solved pair as
// a rigid unit ANYWHERE on the cube. The corner's three stickers name a unique
// rotation from its home; that rotation predicts exactly which slot and colours
// the edge must show for the unit to be intact.
function pairJoined(state: readonly string[], cornerHome: number[], edgeHome: number[]): boolean {
  const cur = locate(state, CORNERS, cornerHome.map((i) => SOLVED_FACELET_CUBE[i]));
  if (cur.length === 0) return false;
  const map = new Map<Face, Face>();
  for (const hi of cornerHome) {
    const colour = SOLVED_FACELET_CUBE[hi];
    const j = cur.find((k) => state[k] === colour);
    if (j === undefined) return false;
    map.set(faceOf(hi), faceOf(j));
  }
  for (const [f, g] of [...map]) map.set(OPP[f], OPP[g]);
  const want = new Map<Face, string>();
  for (const hi of edgeHome) {
    const g = map.get(faceOf(hi));
    if (!g) return false;
    want.set(g, SOLVED_FACELET_CUBE[hi]);
  }
  const slot = EDGE_SLOT.get(faceKey([...want.keys()]));
  if (!slot) return false;
  for (const [f, colour] of want) if (state[slot.get(f)!] !== colour) return false;
  return true;
}

const solvedPiece = (state: readonly string[], g: number[]) => g.every((i) => state[i] === SOLVED_FACELET_CUBE[i]);
const slotOf = (state: readonly string[], pool: number[][], home: number[]) =>
  locate(state, pool, home.map((i) => SOLVED_FACELET_CUBE[i]));

/**
 * Classify a route's placement segments against a block mask. `route` may be
 * anything — the taught trail or the user's raw solve — unrecognised segments
 * get name null. States are simulated internally from `start`.
 */
export function classifyRoute(start: Cube3x3, route: Move3x3[], mask: Cube3x3Mask): JoinEvent[] {
  const inMask = new Set(mask.solvedFaceletIndices);
  return classifyRouteForPieces(
    start, route,
    CORNERS.filter((g) => g.some((i) => inMask.has(i))),
    EDGES.filter((g) => g.some((i) => inMask.has(i))),
  );
}

/** The classification core, scoped to an explicit piece set — the harness feeds
 *  it exactly the pieces the source page colours for each case (everything else
 *  on Lars's diagrams is grey = not part of the pattern). */
export function classifyRouteForPieces(start: Cube3x3, route: Move3x3[], corners: number[][], edges: number[][]): JoinEvent[] {
  // Corner↔edge adjacency in the solved cube: the edge's faces ⊂ corner's faces.
  const pairs: { c: number[]; e: number[] }[] = [];
  for (const c of corners) {
    const cf = new Set(c.map(faceOf));
    for (const e of edges) if (e.every((i) => cf.has(faceOf(i)))) pairs.push({ c, e });
  }
  const pieces = [...corners, ...edges];

  // Simulate: per-step piece-solved and pair-joined snapshots.
  const states: string[][] = [start.stateData.slice()];
  let cube = start;
  for (const m of route) {
    cube = applyMove(cube, m);
    states.push(cube.stateData.slice());
  }
  const solvedAt = states.map((st) => pieces.map((g) => solvedPiece(st, g)));
  const joinedAt = states.map((st) => pairs.map((p) => pairJoined(st, p.c, p.e)));

  // Segments are anchored on CORNERS: a segment ends when a corner locks in (or
  // the route runs out). Edges placing mid-way — a setup move that happens to
  // drop an edge home — must NOT split the sequence, or a Swing reads as
  // setup + Double join (exactly the bug the source-page exemplars exposed).
  const events: JoinEvent[] = [];
  let segStart = 0;
  for (let t = 1; t < states.length; t++) {
    const cornerPlaced = corners.some((g) => solvedAt[t][pieces.indexOf(g)] && !solvedAt[segStart][pieces.indexOf(g)]);
    const isLast = t === states.length - 1;
    if (!cornerPlaced && !isLast) continue;
    const placedNow = pieces.filter((_, k) => solvedAt[t][k] && !solvedAt[segStart][k]);
    const mLen = t - segStart;
    if (mLen === 0) break;

    // Per-corner join timeline: for each in-scope corner, the offsets (within
    // this segment) at which each of its pairs first became joined.
    const joinTimes = (c: number[]) =>
      pairs
        .map((p, k) => ({ p, k }))
        .filter(({ p }) => p.c === c)
        .map(({ k }) => {
          for (let u = segStart + 1; u <= t; u++) if (joinedAt[u][k] && !joinedAt[segStart][k]) return u;
          return -1;
        })
        .filter((u) => u >= 0);
    const pairingCorners = corners.filter((c) => joinTimes(c).length > 0 ||
      pairs.some((p) => p.c === c && placedNow.includes(p.c) && placedNow.includes(p.e)));

    // The focus corner: the one that locked in (fall back to any pairing one).
    const focus = corners.find((g) => placedNow.includes(g)) ?? pairingCorners[0] ?? null;
    let name: PatternName | null = null;
    if (focus) {
      const paired = pairs.some((p, k) => p.c === focus && joinedAt[t][k] && !joinedAt[segStart][k]);
      const cf = new Set(focus.map(faceOf));
      const adj = edges.filter((e) => e.every((i) => cf.has(faceOf(i))));
      // Square: the focus corner ends with ≥2 of its adjacent edges solved —
      // whether they landed now or were already sitting on the centre.
      const square = placedNow.includes(focus) &&
        adj.filter((e) => solvedAt[t][pieces.indexOf(e)]).length >= 2;

      // The 3–4 move patterns separate on ROUTE DYNAMICS (each check verified
      // against every case on the source page — the start-state alone cannot
      // tell them apart):
      //   Pillar        the corner VISITS its own slot misoriented mid-route —
      //                 the stacked corner twisting out and back;
      //   Broken corner a join is born ONTO an edge already sitting home (the
      //                 corner arrives at the waiting edge, then the pair merges);
      //   Double swing  the "out, join, back" face-sandwich in the last 3 moves;
      //   Roundabout    the residual pair-manufacturer.
      const idxFocus = pieces.indexOf(focus);
      const homeKey = NET_COORDS[focus[0]].join(',');
      // Pillar's unmistakable mark: mid-route the corner sits IN its own slot,
      // misoriented — the stacked corner twisting out and back. Compared by
      // coordinate, not reference (callers may pass their own group arrays).
      const visitsOwnSlot = (() => {
        for (let u = segStart; u < t; u++) {
          if (solvedAt[u][idxFocus]) continue;
          const slot = slotOf(states[u], CORNERS, focus);
          if (slot.length && NET_COORDS[slot[0]].join(',') === homeKey) return true;
        }
        return false;
      })();
      // How many of the unit's edges were already home when the segment began.
      const homeEdges = adj.filter((e) => solvedAt[segStart][pieces.indexOf(e)]).length;
      // Double swing's "out, join, back" face-sandwich in the last three moves.
      const sandwich = mLen >= 3 && route[t - 3][0] === route[t - 1][0];
      const longer = mLen === 3 || mLen === 4;

      if (pairingCorners.length >= 2) name = 'Parallel roundabout';
      else if (mLen === 1 && square) name = 'Double join';
      else if (mLen === 1 && paired) name = 'Simple join';
      else if (mLen === 2 && square) name = 'Swing';
      else if (longer && paired && visitsOwnSlot) name = 'Pillar';
      else if (longer && paired && square && homeEdges === 0) name = 'Broken corner';
      else if (longer && paired && square && sandwich) name = 'Double swing';
      else if (longer && paired) name = 'Roundabout';

      // A long unnamed build still contains the vocabulary: split at the first
      // persistent pair-birth — "form the pair", then "take it home" — and name
      // the halves when they match. Only for segments the whole-segment rules
      // left unnamed, so the source-page cases above are never re-split.
      if (name === null) {
        const births = pairs
          .map((p, k) => ({ p, k }))
          .filter(({ p, k }) => p.c === focus && joinedAt[t][k])
          .map(({ k }) => { let u = t; while (u > segStart && joinedAt[u - 1][k]) u--; return u; })
          .filter((u) => u > segStart && u < t);
        const birth = births.length ? Math.min(...births) : -1;
        if (birth > 0) {
          const formLen = birth - segStart;
          const noPairAtStart = pairs.every((_, k) => !joinedAt[segStart][k]);
          let formName: PatternName | null = null;
          if (formLen === 1) formName = 'Simple join';
          else if ((formLen === 3 || formLen === 4) && noPairAtStart) formName = 'Roundabout';
          if (formName) {
            events.push({ name: formName, from: segStart, to: birth - 1, placed: 0 });
            const restName: PatternName | null = t - birth === 1 && square ? 'Double join' : null;
            events.push({ name: restName, from: birth, to: t - 1, placed: placedNow.length });
            segStart = t;
            if (isLast) break;
            continue;
          }
        }
      }
    }
    events.push({ name, from: segStart, to: t - 1, placed: placedNow.length });
    segStart = t;
    if (isLast) break;
  }
  return events;
}

/** Debug/diagnostic trace for the harness: one line per state (0..N) showing
 *  each piece's solvedness, slot, and each pair's joinedness. */
export function traceRoute(start: Cube3x3, route: Move3x3[], corners: number[][], edges: number[][]): string[] {
  const name = (g: number[]) => g.map(faceOf).join('');
  const pairs: { c: number[]; e: number[] }[] = [];
  for (const c of corners) {
    const cf = new Set(c.map(faceOf));
    for (const e of edges) if (e.every((i) => cf.has(faceOf(i)))) pairs.push({ c, e });
  }
  const lines: string[] = [];
  let cube = start;
  for (let t = 0; t <= route.length; t++) {
    if (t > 0) cube = applyMove(cube, route[t - 1]);
    const st = cube.stateData;
    const ps = [...corners, ...edges].map((g) =>
      `${name(g)}@${name(slotOf(st, g.length === 3 ? CORNERS : EDGES, g))}${solvedPiece(st, g) ? '✓' : ''}`).join(' ');
    const js = pairs.map((p) => `${name(p.c)}·${name(p.e)}${pairJoined(st, p.c, p.e) ? '=J' : ''}`).join(' ');
    lines.push(`  t${t}${t > 0 ? ` ${route[t - 1]}` : '   '}: ${ps} | ${js}`);
  }
  return lines;
}

/** One-line how-to per pattern, for the hint console. */
export const PATTERN_HOW: Record<PatternName, string> = {
  'Simple join': 'The corner and edge are one turn from pairing — join them, then insert.',
  'Double join': 'One turn locks the pair and its second edge onto the centre — a 2×2×1 in one.',
  'Swing': 'First move is pure setup; the second lands a double join.',
  'Double swing': 'A symmetric setup — out, join, back — ending in a double join.',
  'Roundabout': 'No pair yet: three turns around the corner manufacture one.',
  'Parallel roundabout': 'Two roundabouts at once — the same turns form both pairs.',
  'Broken corner': 'The corner is in its slot but wrong — pop it out, then rejoin it properly.',
  'Pillar': 'Corner stacked against its edge — twist it out and back to join.',
};
