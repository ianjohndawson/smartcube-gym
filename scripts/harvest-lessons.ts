// Offline seed harvester for the Foundations lessons (src/lessons.ts). NOT part
// of `npm run check` — run by hand when (re)curating LESSON_SEEDS in
// src/cases.ts:
//
//   npx tsx scripts/harvest-lessons.ts
//
// Prints candidate seeds per lesson: from-solved scrambles (a prereq lesson's
// scramble ENDS with its prerequisite built, exactly what the app's
// makeScramble prereq path emits, frozen), each with taught route, optimal
// length and the classified pattern tags — so a human can pick a short, varied
// set. Tags are classified off the TEACHING-default human route (the same call
// the app reviews with), which is what scripts/lessons-check.ts later guards.

import { applyMoves, isMaskSolvedState, newSolved, solveFromState, type Move3x3 } from '../src/engine-api.ts';
import { humanSolveFromState } from '../src/human-solve.ts';
import { classifyRoute, type PatternName } from '../src/patterns.ts';
import { genScramble, trainerById } from '../src/steps.ts';
import { FOUNDATIONS_223, type LessonDef } from '../src/lessons.ts';

const SOLVED = newSolved();

// Per-lesson caps: observe examples must be WATCHABLE — short taught routes.
const TAUGHT_CAP: Record<string, number> = { pair: 4, square: 5, block222: 4, ext223: 8, recover: 5 };
const BASE_LEN: Record<string, number> = { pair: 8, square: 12, block222: 12, ext223: 12, recover: 7 };
const WANT = 8; // candidates to print per lesson

// Collapse consecutive same-face turns (the scr+build seam can leave e.g.
// "R2 R2"); state-preserving, so prereq-built-ness is untouched.
function simplify(moves: Move3x3[]): Move3x3[] {
  const out: Move3x3[] = [];
  const amt = (m: Move3x3) => (m.includes('2') ? 2 : m.includes("'") ? 3 : 1);
  let i = 0;
  while (i < moves.length) {
    const f = moves[i][0];
    let net = 0;
    while (i < moves.length && moves[i][0] === f) { net = (net + amt(moves[i])) % 4; i++; }
    if (net === 1) out.push(f as Move3x3);
    else if (net === 2) out.push(`${f}2` as Move3x3);
    else if (net === 3) out.push(`${f}'` as Move3x3);
  }
  return out;
}

function harvest(def: LessonDef) {
  const step = def.step;
  const cap = TAUGHT_CAP[def.id] ?? 6;
  const buildCfg = { ...step.solver, depthLimit: 16 };
  console.log(`\n=== ${def.id} — ${def.title} (taught ≤ ${cap}) ===`);
  let found = 0;
  for (let attempt = 0; attempt < 400 && found < WANT; attempt++) {
    const scr = genScramble(BASE_LEN[def.id] ?? 12);
    let full: Move3x3[] = scr;
    if (step.prereqMask) {
      const build = solveFromState(applyMoves(SOLVED, scr), step.prereqMask, buildCfg);
      if (!build) continue;
      full = simplify([...scr, ...build]);
    }
    const cube = applyMoves(SOLVED, full);
    if (step.prereqMask && !isMaskSolvedState(cube, step.prereqMask)) continue;
    if (step.candidateMasks.some((m) => isMaskSolvedState(cube, m))) continue;
    const taught = humanSolveFromState(cube, step.canonicalMask, step.solver);
    if (!taught || taught.length === 0 || taught.length > cap) continue;
    // Tags are optional for seeds (an already-joined pair travelling home has
    // no corner event to name — still a fine observe example).
    const names = classifyRoute(cube, taught, step.canonicalMask)
      .map((e) => e.name)
      .filter((x): x is NonNullable<typeof x> => x != null);
    // Pattern-gated lessons (recovery): only cases whose taught route uses a
    // named technique the lesson trains — the app's own serving rule.
    if (def.gen?.patterns && !names.some((nm) => def.gen!.patterns!.includes(nm))) continue;
    const opt = solveFromState(cube, step.canonicalMask, step.solver)?.length ?? -1;
    found++;
    console.log(`scramble: "${full.join(' ')}"`);
    console.log(`  taught (${taught.length}, opt ${opt}): ${taught.join(' ')}  tags: ${names.join(' · ') || '—'}`);
  }
  if (found < WANT) console.log(`(only ${found} candidates within budget)`);
}

for (const def of FOUNDATIONS_223) harvest(def);

// --- course222 L3 ("Roundabouts & rescues") variety harvest ---
// The graded 2×2×2 course's L3 opener should span the rescue vocabulary, not
// one shape (HANDOFF flagged the all-Broken-corner seeds). Same rules as the
// course generator (len-6 scrambles, teaching against the canonical 2×2×2),
// but curated on the FIRST named event — that's what the seed headline names.
function harvestCourse222L3() {
  const step = trainerById('course222').steps[0];
  const want = new Set<PatternName>(['Roundabout', 'Pillar', 'Broken corner', 'Double swing', 'Parallel roundabout']);
  const byTag = new Map<PatternName, string[]>();
  console.log('\n=== course222 L3 · rescue variety (len 6, tag = first named event) ===');
  for (let attempt = 0; attempt < 500; attempt++) {
    if (byTag.size >= 4 && [...byTag.values()].every((l) => l.length >= 2)) break;
    const scr = genScramble(6);
    const cube = applyMoves(SOLVED, scr);
    if (step.candidateMasks.some((m) => isMaskSolvedState(cube, m))) continue;
    const taught = humanSolveFromState(cube, step.canonicalMask, step.solver);
    if (!taught || taught.length === 0) continue;
    const first = classifyRoute(cube, taught, step.canonicalMask).find((e) => e.name)?.name;
    if (!first || !want.has(first)) continue;
    const list = byTag.get(first) ?? [];
    if (list.length >= 3) continue;
    list.push(`{ scramble: "${scr.join(' ')}", tag: '${first}' },  // taught (${taught.length}): ${taught.join(' ')}`);
    byTag.set(first, list);
  }
  for (const [tag, list] of byTag) {
    console.log(`-- ${tag}`);
    for (const l of list) console.log(`  ${l}`);
  }
}
harvestCourse222L3();
