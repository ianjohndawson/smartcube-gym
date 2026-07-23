// The Blockbuilding Foundations curriculum: lesson definitions plus the pure
// phase/gate mathematics. This module is deliberately free of storage and DOM —
// stats.ts persists LessonProg, main.ts renders and serves — so the gate logic
// is directly harness-testable (scripts/lessons-check.ts).
//
// A lesson teaches ONE structure at the canonical DLF corner and runs through
// four phases: observe (watch curated seeded examples — ungraded), guided
// (build with live piece-by-piece coaching), coached (one what-to-look-for
// line), independent (no prompts). Progression is gated on PROFICIENCY — did
// you complete the target without being shown the full route — never on
// efficiency; move counts are still logged to Stats but do not gate. This is
// the deliberate opposite of the graded courses' clean-rate stars.

import { type StepDef, STEP_221, STEP_222_FROM_221, STEP_222_RECOVERY, STEP_223_BUILD, STEP_223_EXT, STEP_PAIR } from './steps.ts';
import type { PatternName } from './patterns.ts';

export type LessonPhase = 'observe' | 'guided' | 'coached' | 'independent' | 'done';

export interface LessonGates {
  /** Successful guided reps required to unlock coached practice. */
  guided: number;
  /** Successful coached reps required to unlock independent practice. */
  coached: number;
  /** Independent completion window and successes-within-it to finish the lesson. */
  indepWindow: number;
  indepNeed: number;
}

export interface LessonDef {
  id: string;
  title: string;
  /** The completion target in one sentence (course panel). */
  outcome: string;
  /** "Why this matters" (course panel). */
  why: string;
  /** Plain-language introduction — the Explain rung; no move notation. */
  explain: string;
  /** The training target this lesson solves (mask/solver/prereq). */
  step: StepDef;
  /** Generated-practice filter. `patterns` keeps only scrambles whose taught
   *  route uses one of the named techniques (the recovery lesson's engine —
   *  see main.ts makeScramble); `len`/`maxOptimal` bound scramble difficulty. */
  gen?: { len?: number; maxOptimal?: number; patterns?: PatternName[] };
  /** Guided reps open with tap-identification prompts (find the corner/edge). */
  identify?: boolean;
  gates: LessonGates;
}

/** A learner's per-lesson record (persisted by stats.ts). Arrays are 1/0 per
 *  rep, newest last; `done` is sticky once the independent window is met. */
export interface LessonProg {
  observed: number;
  guided: number[];
  coached: number[];
  indep: number[];
  done: boolean;
}

export function emptyLessonProg(): LessonProg {
  return { observed: 0, guided: [], coached: [], indep: [], done: false };
}

// The roadmap's proficiency gates, shared by every lesson: 2 successful guided
// reps -> coached; 3 coached -> independent; 3 of the latest 4 independent ->
// lesson complete.
const GATES: LessonGates = { guided: 2, coached: 3, indepWindow: 4, indepNeed: 3 };
// Guided/coached histories are kept short — only the success count matters.
const REP_KEEP = 20;

/** Successful reps in a 1/0 record (exported for progress displays). */
export const successCount = (a: number[]) => a.filter((x) => x === 1).length;
const wins = successCount;

/** True when the latest independent window satisfies the lesson's completion. */
export function indepSatisfied(def: LessonDef, indep: number[]): boolean {
  return wins(indep.slice(-def.gates.indepWindow)) >= def.gates.indepNeed;
}

/** What the learner should do NEXT. Ordered so a met gate always outranks
 *  unwatched examples — the examples are an on-ramp, not a requirement. */
export function derivePhase(def: LessonDef, prog: LessonProg, seedCount: number): LessonPhase {
  if (prog.done) return 'done';
  if (wins(prog.coached) >= def.gates.coached) return 'independent';
  if (wins(prog.guided) >= def.gates.guided) return 'coached';
  if (prog.observed < seedCount) return 'observe';
  return 'guided';
}

/** Record one completed rep into the phase it was served as. Observe reps are
 *  never recorded (they are demonstrations); callers pass guided/coached/
 *  independent. Reps on a finished lesson keep feeding the independent window
 *  but can never un-finish it (`done` is sticky here; only popRep can undo). */
export function applyRep(def: LessonDef, prog: LessonProg, phase: LessonPhase, success: boolean): LessonProg {
  const out: LessonProg = { ...prog, guided: [...prog.guided], coached: [...prog.coached], indep: [...prog.indep] };
  const v = success ? 1 : 0;
  if (phase === 'guided') out.guided = [...out.guided, v].slice(-REP_KEEP);
  else if (phase === 'coached') out.coached = [...out.coached, v].slice(-REP_KEEP);
  else if (phase === 'independent' || phase === 'done') out.indep = [...out.indep, v].slice(-def.gates.indepWindow);
  if (!out.done && indepSatisfied(def, out.indep)) out.done = true;
  return out;
}

/** Remove the most recent rep of a phase (the review's Discard). `done` is
 *  recomputed from what remains, so discarding the completing rep honestly
 *  reopens the lesson. */
export function popRep(def: LessonDef, prog: LessonProg, phase: LessonPhase): LessonProg {
  const out: LessonProg = { ...prog, guided: [...prog.guided], coached: [...prog.coached], indep: [...prog.indep] };
  if (phase === 'guided') out.guided.pop();
  else if (phase === 'coached') out.coached.pop();
  else if (phase === 'independent' || phase === 'done') out.indep.pop();
  out.done = indepSatisfied(def, out.indep);
  return out;
}

/** Index of the first unfinished lesson — the forward-unlock boundary (a
 *  learner may always revisit finished lessons behind it). */
export function firstOpenLesson(defs: LessonDef[], progOf: (def: LessonDef) => LessonProg): number {
  for (let i = 0; i < defs.length; i++) if (!progOf(defs[i]).done) return i;
  return defs.length - 1;
}

// --- the Foundations 2×2×3 track ---
// Four lessons climbing the containment chain pair ⊂ 2×2×1 ⊂ 2×2×2 ⊂ 2×2×3,
// all at the canonical corner: the learner never chooses WHERE to build until
// they understand WHAT they are building (free placement lives in the Blocks
// category, recommended after graduation).
export const FOUNDATIONS_223: LessonDef[] = [
  {
    id: 'pair',
    title: 'Make a pair',
    outcome: 'Join the orange-green-yellow corner with one of its edges and put the pair home.',
    why: 'Every block starts the same way: one corner and one matching edge, joined and taken home together.',
    explain:
      'A pair is a corner plus an edge that shares two of its colours. Find the orange-green-yellow corner, then any edge showing two of those colours. Joined, they move as one piece — take them home to their matching centres.',
    step: STEP_PAIR,
    gen: { len: 8, maxOptimal: 6 },
    identify: true,
    gates: GATES,
  },
  {
    id: 'square',
    title: 'Complete the 2×2×1',
    outcome: 'Add the second edge so your pair becomes a 2×2×1 block on its centre.',
    why: 'A pair becomes a real block the moment its second edge locks onto their shared centre.',
    explain:
      'Your corner–edge pair is already home. Exactly one more edge matches the corner on each face it touches: bring one in next to the pair, without breaking what you built.',
    step: STEP_221,
    gen: { maxOptimal: 5 },
    gates: GATES,
  },
  {
    id: 'block222',
    title: 'Finish the 2×2×2',
    outcome: 'Place the last edge to turn the 2×2×1 into a full 2×2×2 corner block.',
    why: 'From here on, block building is “add pieces without disturbing the ones you placed” — this is your first three-piece guard.',
    explain:
      'The 2×2×1 square is built. One edge remains: it touches the two centres beside your square. Slot it in while the square stays intact.',
    step: STEP_222_FROM_221,
    gen: { maxOptimal: 6 },
    gates: GATES,
  },
  {
    id: 'ext223',
    title: 'Extend to a 2×2×3',
    outcome: 'Grow the 2×2×2 into a 2×2×3: one more corner and two more edges.',
    why: 'This is the Petrus / APB opening for real — extending a block you must not break.',
    explain:
      'Your 2×2×2 is built. The extension is a little block of its own — a corner and two edges. Pair them up and join them on against the 2×2×2, keeping it whole.',
    step: STEP_223_EXT,
    gen: { maxOptimal: 8 },
    gates: GATES,
  },
  {
    id: 'recover',
    title: 'Fix a broken corner',
    outcome: 'Rescue a corner that went in wrong and finish the 2×2×2.',
    why: 'Blocks break — a corner drops in twisted, or stacks against its slot. Fixing it calmly is a real skill, not a failure.',
    explain:
      'Sometimes a corner sits in its place but turned the wrong way, or stacks up right next to it. Don’t fight it — pop it out, pair it with its edge, and put them in together. Two shapes cover almost every case: the Broken corner (twisted in its slot) and the Pillar (stacked beside it).',
    step: STEP_222_RECOVERY,
    // The pattern filter IS the lesson: every served case is a corner rescue.
    gen: { len: 7, patterns: ['Broken corner', 'Pillar'] },
    gates: GATES,
  },
  {
    id: 'build223',
    title: 'Build a 2×2×3 from scratch',
    outcome: 'Plan and build a full 2×2×3 from one scramble — corner, block and extension, all yourself.',
    why: 'This is the whole skill together: no head start, no fixed order — read the cube and build the block your Petrus / APB solve opens with.',
    explain:
      'Everything you have practised, in one go. There is no prebuilt start now: make a pair, grow it to a 2×2×2, then extend to a 2×2×3 — the milestones you already know, planned yourself from the scramble.',
    step: STEP_223_BUILD,
    // A gentle optimal cap keeps beginner cases fair; the scramble is otherwise
    // a full build. (2×2×3 solves are pd5 ~130ms; the filter runs a few times.)
    gen: { len: 14, maxOptimal: 11 },
    gates: GATES,
  },
];

const REGISTRY: Record<string, LessonDef[]> = { found223: FOUNDATIONS_223 };

/** The lesson track for a trainer, or null for every non-lesson trainer. */
export function lessonsFor(trainerId: string): LessonDef[] | null {
  return REGISTRY[trainerId] ?? null;
}
