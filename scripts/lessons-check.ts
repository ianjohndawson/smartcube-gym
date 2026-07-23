// Foundations-course validation (src/lessons.ts + the curated LESSON_SEEDS):
//   1. The pure phase/gate math walks the roadmap's ladder exactly — observe →
//      guided → coached → independent → done, failures don't advance, `done`
//      is sticky through later reps but honestly reopens on a Discard (popRep).
//   2. The new pair/square masks are the intended cubies and nest correctly:
//      pair ⊂ 2×2×1 square ⊂ 2×2×2 ⊂ 2×2×3.
//   3. Every lesson seed is servable — parses, pre-builds its prerequisite,
//      does NOT pre-solve any accepted target — and its stored tag matches the
//      classifier on the taught route (the exact call the app's review makes).
//   4. The '112' pair family reaches its target through the ranked human
//      solver within the comfort band (optimal + 2).

import {
  applyMoves, isMaskSolvedState, newSolved, parseMoves, solveFromState, type Cube3x3Mask,
} from '../src/engine-api.ts';
import { humanSolveFromState } from '../src/human-solve.ts';
import { classifyRoute, routeRoles } from '../src/patterns.ts';
import {
  MASK_221_BOTTOM, MASK_221_FRONT, MASK_221_LEFT, MASK_222_DLF, MASK_223_BOTTOM_LEFT,
  MASK_PAIR_DF, MASK_PAIR_DL, MASK_PAIR_FL, NET_COORDS,
} from '../src/blocks.ts';
import {
  FOUNDATIONS_223, applyRep, derivePhase, emptyLessonProg, popRep, type LessonProg,
} from '../src/lessons.ts';
import { COURSE_SEEDS, lessonSeedsFor } from '../src/cases.ts';
import { genScramble, trainerById } from '../src/steps.ts';

let n = 0, fail = 0;
const check = (ok: boolean, msg: string) => { n++; if (!ok) { fail++; console.log(`MISMATCH: ${msg}`); } };

// --- 1. gate math ---
{
  const def = FOUNDATIONS_223[0];
  const seeds = 3;
  let p: LessonProg = emptyLessonProg();
  check(derivePhase(def, p, seeds) === 'observe', 'fresh lesson starts in observe');
  check(derivePhase(def, p, 0) === 'guided', 'no seeds → straight to guided');
  p = { ...p, observed: seeds };
  check(derivePhase(def, p, seeds) === 'guided', 'examples watched → guided');
  p = applyRep(def, p, 'guided', false);
  check(derivePhase(def, p, seeds) === 'guided', 'a failed guided rep does not advance');
  p = applyRep(def, p, 'guided', true);
  check(derivePhase(def, p, seeds) === 'guided', '1/2 guided successes — still guided');
  p = applyRep(def, p, 'guided', true);
  check(derivePhase(def, p, seeds) === 'coached', '2 guided successes unlock coached');
  p = applyRep(def, p, 'coached', true);
  p = applyRep(def, p, 'coached', false);
  p = applyRep(def, p, 'coached', true);
  check(derivePhase(def, p, seeds) === 'coached', '2/3 coached successes — still coached');
  p = applyRep(def, p, 'coached', true);
  check(derivePhase(def, p, seeds) === 'independent', '3 coached successes unlock independent');
  p = applyRep(def, p, 'independent', true);
  p = applyRep(def, p, 'independent', false);
  p = applyRep(def, p, 'independent', false);
  p = applyRep(def, p, 'independent', true);
  check(!p.done && derivePhase(def, p, seeds) === 'independent', 's f f s: 2 of latest 4 — not done yet');
  p = applyRep(def, p, 'independent', true);
  check(!p.done, 'window slides to f f s s — still 2 of latest 4');
  p = applyRep(def, p, 'independent', true);
  check(p.done, 'window f s s s — 3 of latest 4 completes the lesson');
  check(derivePhase(def, p, seeds) === 'done', 'done phase derived');
  const completing = p;
  p = applyRep(def, p, 'done', false);
  p = applyRep(def, p, 'done', false);
  check(p.done, 'done is sticky through later failed reps');
  p = popRep(def, completing, 'independent');
  check(!p.done, 'discarding the completing rep reopens the lesson');
  // Met gates outrank unwatched examples.
  const q: LessonProg = { ...emptyLessonProg(), guided: [1, 1] };
  check(derivePhase(def, q, seeds) === 'coached', 'guided gate met outranks unwatched examples');
}

// A second independent-window shape: s f s s completes directly.
{
  const def = FOUNDATIONS_223[0];
  let p: LessonProg = emptyLessonProg();
  p = applyRep(def, p, 'independent', true);
  p = applyRep(def, p, 'independent', false);
  check(!p.done, 's f — not done');
  p = applyRep(def, p, 'independent', true);
  p = applyRep(def, p, 'independent', true);
  check(p.done, 's f s s = 3 of 4 → done');
}

// --- 2. mask geometry ---
const coordSet = (mask: Cube3x3Mask) => {
  const s = new Set<string>();
  for (const i of mask.solvedFaceletIndices) s.add(NET_COORDS[i].join(','));
  return s;
};
const sameCoords = (mask: Cube3x3Mask, coords: string[]) => {
  const got = coordSet(mask);
  return got.size === coords.length && coords.every((c) => got.has(c));
};
check(sameCoords(MASK_PAIR_DF, ['0,0,2', '1,0,2']), 'pair DF = DLF corner + DF edge');
check(sameCoords(MASK_PAIR_DL, ['0,0,2', '0,0,1']), 'pair DL = DLF corner + DL edge');
check(sameCoords(MASK_PAIR_FL, ['0,0,2', '0,1,2']), 'pair FL = DLF corner + FL edge');
check(sameCoords(MASK_221_FRONT, ['0,0,2', '1,0,2', '0,1,2', '1,1,2']), '2×2×1 front = corner + DF + FL + F centre');
check(sameCoords(MASK_221_BOTTOM, ['0,0,2', '1,0,2', '0,0,1', '1,0,1']), '2×2×1 bottom = corner + DF + DL + D centre');
check(sameCoords(MASK_221_LEFT, ['0,0,2', '0,0,1', '0,1,2', '0,1,1']), '2×2×1 left = corner + DL + FL + L centre');
const subset = (a: Cube3x3Mask, b: Cube3x3Mask) => {
  const s = new Set(b.solvedFaceletIndices);
  return a.solvedFaceletIndices.every((i) => s.has(i));
};
check(subset(MASK_PAIR_DF, MASK_221_FRONT) && subset(MASK_PAIR_DF, MASK_221_BOTTOM), 'pair DF nests in front + bottom squares');
check(subset(MASK_PAIR_DL, MASK_221_BOTTOM) && subset(MASK_PAIR_DL, MASK_221_LEFT), 'pair DL nests in bottom + left squares');
check(subset(MASK_PAIR_FL, MASK_221_FRONT) && subset(MASK_PAIR_FL, MASK_221_LEFT), 'pair FL nests in front + left squares');
check(subset(MASK_221_FRONT, MASK_222_DLF) && subset(MASK_221_BOTTOM, MASK_222_DLF) && subset(MASK_221_LEFT, MASK_222_DLF), 'squares nest in the 2×2×2');
check(subset(MASK_222_DLF, MASK_223_BOTTOM_LEFT), '2×2×2 nests in the 2×2×3');

// --- 3. curated seeds ---
const SOLVED = newSolved();
for (const def of FOUNDATIONS_223) {
  const seeds = lessonSeedsFor(def.id);
  check(seeds.length >= 3, `${def.id}: has observe examples`);
  seeds.forEach((sc, k) => {
    const cube = applyMoves(SOLVED, parseMoves(sc.scramble));
    const who = `${def.id} seed ${k}`;
    if (def.step.prereqMask) check(isMaskSolvedState(cube, def.step.prereqMask), `${who}: prereq pre-built`);
    check(!def.step.candidateMasks.some((m) => isMaskSolvedState(cube, m)), `${who}: target not pre-solved`);
    const taught = humanSolveFromState(cube, def.step.canonicalMask, def.step.solver);
    // Watchable ceiling: small rungs are 1–5 moves; the from-scratch 2×2×3
    // capstone is a full build (milestone + extension), so it earns more room.
    const watchCap = def.id === 'build223' ? 13 : 8;
    check(!!taught && taught.length > 0 && taught.length <= watchCap, `${who}: taught route exists and is watchable (≤${watchCap})`);
    if (!taught) return;
    check(isMaskSolvedState(applyMoves(cube, taught), def.step.canonicalMask), `${who}: taught route reaches the target`);
    if (sc.tag) {
      const names = classifyRoute(cube, taught, def.step.canonicalMask).map((e) => e.name);
      check(names.includes(sc.tag), `${who}: tag ${sc.tag} not in classified [${names.join(', ')}]`);
    }
  });
}

// --- 4. graded-course seeds (COURSE_SEEDS) stay honest too ---
// Same servability rules as the lesson seeds, and every stored tag must appear
// in the classifier's reading of the taught route — the anywhere-rule the
// course generator itself uses (steps.ts band.patterns).
for (const [courseId, levels] of Object.entries(COURSE_SEEDS)) {
  const step = trainerById(courseId).steps[0];
  levels.forEach((seeds, lvl) => {
    seeds.forEach((sc, k) => {
      const who = `${courseId} L${lvl + 1} seed ${k}`;
      const cube = applyMoves(SOLVED, parseMoves(sc.scramble));
      check(!step.candidateMasks.some((m) => isMaskSolvedState(cube, m)), `${who}: target not pre-solved`);
      const taught = humanSolveFromState(cube, step.canonicalMask, step.solver);
      check(!!taught && taught.length > 0, `${who}: taught route exists`);
      if (taught && sc.tag) {
        const names = classifyRoute(cube, taught, step.canonicalMask).map((e) => e.name);
        check(names.includes(sc.tag), `${who}: tag ${sc.tag} not in classified [${names.join(', ')}]`);
      }
    });
  });
}

// --- 5. ranked human solve reaches the pair (family '112') ---
{
  const def = FOUNDATIONS_223[0];
  let tried = 0;
  for (let t = 0; t < 60 && tried < 25; t++) {
    const cube = applyMoves(SOLVED, genScramble(8));
    if (def.step.candidateMasks.some((m) => isMaskSolvedState(cube, m))) continue;
    tried++;
    const taught = humanSolveFromState(cube, def.step.canonicalMask, def.step.solver, 16);
    const opt = solveFromState(cube, def.step.canonicalMask, def.step.solver);
    check(!!taught && isMaskSolvedState(applyMoves(cube, taught), def.step.canonicalMask), `pair sweep ${t}: reaches target`);
    if (taught && opt) check(taught.length <= opt.length + 2, `pair sweep ${t}: ${taught.length} within optimal ${opt.length} + 2`);
  }
  check(tried >= 20, 'pair sweep: enough non-degenerate scrambles');
}

// --- 5b. recovery lesson's pattern filter has material at its scramble length ---
// The recovery lesson serves ONLY Broken corner / Pillar cases; if len-7
// scrambles rarely produce them the lesson would stall on the fallback. Prove
// the filter finds enough (mirrors makeScramble's generation exactly).
{
  const def = FOUNDATIONS_223.find((d) => d.id === 'recover')!;
  const want = new Set(def.gen!.patterns!);
  const len = def.gen!.len!;
  let matched = 0;
  for (let t = 0; t < 80; t++) {
    const cube = applyMoves(SOLVED, genScramble(len));
    if (def.step.candidateMasks.some((m) => isMaskSolvedState(cube, m))) continue;
    const taught = humanSolveFromState(cube, def.step.canonicalMask, def.step.solver, 16);
    if (!taught) continue;
    if (classifyRoute(cube, taught, def.step.canonicalMask).some((e) => e.name && want.has(e.name))) matched++;
  }
  check(matched >= 8, `recovery filter finds rescue cases at len ${len} (${matched}/80)`);
}

// --- 6. walkthrough annotations: the grouped Learn pane's assumptions ---
// classifyRoute's segments must PARTITION the taught route (every move sits in
// exactly one group, in order), routeRoles must yield one role per move, and a
// route that completes the target must end on a placing move.
{
  const step = trainerById('course222').steps[0];
  let tried = 0;
  for (let t = 0; t < 60 && tried < 15; t++) {
    const cube = applyMoves(SOLVED, genScramble(8));
    if (step.candidateMasks.some((m) => isMaskSolvedState(cube, m))) continue;
    const taught = humanSolveFromState(cube, step.canonicalMask, step.solver, 16);
    if (!taught || taught.length === 0) continue;
    tried++;
    const seg = classifyRoute(cube, taught, step.canonicalMask);
    let partition = seg.length > 0 && seg[0].from === 0 && seg[seg.length - 1].to === taught.length - 1;
    for (let k = 1; k < seg.length; k++) if (seg[k].from !== seg[k - 1].to + 1) partition = false;
    check(partition, `annotation sweep ${t}: segments partition the route`);
    const roles = routeRoles(cube, taught, step.canonicalMask);
    check(roles.length === taught.length, `annotation sweep ${t}: one role per move`);
    check(roles[roles.length - 1] === 'place', `annotation sweep ${t}: the final move places`);
  }
  check(tried >= 10, 'annotation sweep: enough cases');
  // The Foundations seeds get the same guarantee (their walkthroughs are the
  // observe phase's whole value).
  for (const def of FOUNDATIONS_223) {
    lessonSeedsFor(def.id).forEach((sc, k) => {
      const cube = applyMoves(SOLVED, parseMoves(sc.scramble));
      const taught = humanSolveFromState(cube, def.step.canonicalMask, def.step.solver);
      if (!taught) return; // reachability already checked in section 3
      const seg = classifyRoute(cube, taught, def.step.canonicalMask);
      let partition = seg.length > 0 && seg[0].from === 0 && seg[seg.length - 1].to === taught.length - 1;
      for (let j = 1; j < seg.length; j++) if (seg[j].from !== seg[j - 1].to + 1) partition = false;
      check(partition, `${def.id} seed ${k}: walkthrough segments partition`);
      check(routeRoles(cube, taught, def.step.canonicalMask).length === taught.length, `${def.id} seed ${k}: roles align`);
    });
  }
}

console.log(`lessons: ${n} checks, mismatches ${fail}`);
if (fail > 0) { console.log('LESSONS FAIL'); process.exitCode = 1; }
else console.log('LESSONS OK — gates, masks, seeds and pair routes all verified');
