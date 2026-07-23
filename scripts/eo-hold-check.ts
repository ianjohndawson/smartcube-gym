// Oracle for the eo123/eo223 display hold: white on the bottom, block on the
// bottom-left (APB) / bottom-back (Petrus) — Ian's explicit spec (2026-07-12).
// Verifies the GEOMETRY (rotatedFacelets against dom.ts's own index->(row,col)
// formula, reproduced here) independently of main.ts's mode-gating, which is
// covered by a live e2e check instead (rotation semantics, not geometry).
//
// IMPORTANT geometric fact this harness encodes (derived + verified while
// building the fix — see blocks-deep-dive-plan.md): a 180° rotation about the
// L-R axis (x2) leaves a facelet's L/R face-identity INVARIANT (an L-face
// sticker's normal is axis-aligned, so it stays an L-face sticker) but SWAPS
// F<->B and U<->D identity (their normals are perpendicular to the axis). So
// checking "does this block land on the left" must look at the L-FACE-anchored
// facelets specifically — the F/B-touching facelets of a full-depth block are
// SUPPOSED to relocate to the B-net-column under x2; that's not a bug.

import { newSolved, faceletString } from '../src/engine-api.ts';
import { MOVE_PERMS } from '../src/engine/puzzles/cube3x3/index.ts';
import { blockEoTarget, blockEoDisplayRots } from '../src/block-eo.ts';
import { trainerById } from '../src/steps.ts';

// dom.ts's exact index -> (row, col) formula.
function rowCol(i: number): [number, number] {
  if (i < 9) return [Math.floor(i / 3), 3 + (i % 3)];
  if (i < 45) { const p = i - 9; return [3 + Math.floor(p / 12), p % 12]; }
  const j = i - 45; return [6 + Math.floor(j / 3), 3 + (j % 3)];
}
// Which RAW/model face an index belongs to (U/D/L/F/R/B).
function faceOf(i: number): string {
  if (i < 9) return 'U';
  if (i >= 45) return 'D';
  return ['L', 'L', 'L', 'F', 'F', 'F', 'R', 'R', 'R', 'B', 'B', 'B'][(i - 9) % 12];
}
function viewPerm(rots: readonly string[]): number[] {
  let perm = [...Array(54).keys()];
  for (const r of rots) {
    const next = perm.slice();
    for (const [src, dst] of (MOVE_PERMS as Record<string, [number, number][]>)[r]) next[dst] = perm[src];
    perm = next;
  }
  return perm;
}
// Where does model index m's content end up displayed, under view rots?
function displayedAt(m: number, rots: readonly string[]): [number, number] {
  const vp = viewPerm(rots);
  return rowCol(vp.indexOf(m));
}

let n = 0, fail = 0;
const check = (c: boolean, m: string) => { n++; if (!c) { console.log('MISMATCH: ' + m); fail++; } };

const solved = faceletString(newSolved());
void solved;

// 1. White (U-centre, index 4) must DISPLAY at the BOTTOM band (rows 6-8) for
//    every hold this app offers, and yellow (D-centre, index 49) at the TOP.
const HOLDS: { name: string; rots: string[] }[] = [
  { name: 'eo123 (x2)', rots: ['x2'] },
  { name: 'eo223 APB', rots: blockEoDisplayRots('apb', 0) },
  { name: 'eo223 Petrus', rots: blockEoDisplayRots('petrus', 0) },
];
for (const h of HOLDS) {
  const [wr] = displayedAt(4, h.rots);
  const [yr] = displayedAt(49, h.rots);
  check(wr >= 6 && wr <= 8, `${h.name}: white (index 4) must display in the bottom band, displayed row ${wr}`);
  check(yr >= 0 && yr <= 2, `${h.name}: yellow (index 49) must display in the top band, displayed row ${yr}`);
}

// 2. eo123's block (live registry) must display in the BOTTOM band under its
//    x2 hold (every facelet), and its L-FACE-anchored facelets specifically
//    (invariant under x2 — see header) must display at the net's L-columns
//    (0-2) — the precise, face-identity-aware form of "bottom-left".
const eo123Mask = trainerById('eo123').steps[0].canonicalMask;
const eo123LFace = eo123Mask.solvedFaceletIndices.filter((i) => faceOf(i) === 'L');
check(eo123LFace.length > 0, 'eo123 block: expected some L-face-anchored facelets (a "1x2x3 against the L-centre")');
for (const i of eo123Mask.solvedFaceletIndices) {
  const [r] = displayedAt(i, ['x2']);
  check(r >= 3, `eo123 block facelet ${i}: displayed row ${r} is in the top band, not bottom`);
}
for (const i of eo123LFace) {
  const [, c] = displayedAt(i, ['x2']);
  check(c >= 0 && c <= 2, `eo123 block L-face facelet ${i}: displayed col ${c}, expected the net's L-columns (0-2)`);
}

// 3. eo223: APB's L-face-anchored facelets must land at the net's L-columns
//    (bottom-LEFT); Petrus's must NOT (its whole point is bottom-BACK instead
//    — confirming the method setting genuinely changes the hold). Both must
//    still show the full block in the bottom band.
const canon223 = blockEoTarget(0).solvedFaceletIndices as number[];
const canon223LFace = canon223.filter((i) => faceOf(i) === 'L');
check(canon223LFace.length > 0, 'eo223 CANON_BLOCK: expected some L-face-anchored facelets');
for (const i of canon223) {
  const [rApb] = displayedAt(i, blockEoDisplayRots('apb', 0));
  const [rPet] = displayedAt(i, blockEoDisplayRots('petrus', 0));
  check(rApb >= 3, `eo223 APB facelet ${i}: displayed row ${rApb} is in the top band, not bottom`);
  check(rPet >= 3, `eo223 Petrus facelet ${i}: displayed row ${rPet} is in the top band, not bottom`);
}
for (const i of canon223LFace) {
  const [, cApb] = displayedAt(i, blockEoDisplayRots('apb', 0));
  check(cApb >= 0 && cApb <= 2, `eo223 APB L-face facelet ${i}: displayed col ${cApb}, expected the net's L-columns (0-2)`);
}
const petrusLCols = canon223LFace.map((i) => displayedAt(i, blockEoDisplayRots('petrus', 0))[1]);
check(!petrusLCols.every((c) => c >= 0 && c <= 2), 'eo223 Petrus: L-face facelets should NOT land at the L-columns (that is APB\'s spot; Petrus turns the block to the back instead)');

console.log(`eo-hold: ${n} checks, mismatches ${fail}`);
if (fail > 0) { console.log('EO-HOLD FAIL'); process.exitCode = 1; }
else console.log('EO-HOLD OK — white displays bottom; eo123/eo223(APB) block anchors bottom-left; eo223(Petrus) anchors bottom-back (not left)');
