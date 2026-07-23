// Curated course cases — data, not logic. Each technique lesson opens with a
// few seeded examples (harvested offline: scrambles whose TAUGHT route's first
// named Lars Petrus pattern is the lesson's technique, tags verified by the
// same classifier scripts/patterns-check.ts guards), then the app generates
// same-technique practice (makeScramble). Swap or extend these freely — the
// tags are display hints; the classifier remains the truth at review time.
//
// Seed scrambles are FROM SOLVED, so they are only served when the tracked
// cube is actually solved (lesson entry resets to solved; mid-session reps get
// generated practice and the example counter waits).

import type { PatternName } from './patterns.ts';

export interface SeedCase {
  scramble: string;
  /** Primary named pattern of the taught route. Optional: some fine examples
   *  have no corner event to name (e.g. an already-joined pair travelling
   *  home). When present, the classifier must agree (lessons-check). */
  tag?: PatternName;
  /** One-line "what to watch" shown with a Foundations observe example. */
  note?: string;
}

/** courseId → per-level seed lists (index-aligned with the course's levels). */
export const COURSE_SEEDS: Record<string, SeedCase[][]> = {
  course222: [
    [ // L1 · Simple joins
      { scramble: "L F L U B' L' R' D2 F2 R2", tag: 'Simple join' },
      { scramble: "R2 F R F' U2 R' F2 D' B2 R", tag: 'Simple join' },
      { scramble: "B R2 B' R U B2 L F2 D L", tag: 'Simple join' },
    ],
    [ // L2 · Double joins & Swings. Seed 0 re-harvested 2026-07-23: the old
      // one's TEACHING-default route (rank 96 — what Show ideal walks) had no
      // named event; tags are verified against that route by lessons-check.
      { scramble: "B U' R F B'", tag: 'Double join' },
      { scramble: "R F2 L' F2 L'", tag: 'Double join' },
      { scramble: "D2 U' B' U' D'", tag: 'Swing' },
    ],
    [ // L3 · Roundabouts & rescues — one seed per rescue shape (variety
      // re-harvest 2026-07-23; tags = the taught route's first named event,
      // guarded by scripts/lessons-check.ts).
      { scramble: "D' L2 F' L2 D2 U", tag: 'Roundabout' },
      { scramble: "U L R2 F' L2 B'", tag: 'Broken corner' },
      { scramble: "R D' L F L F'", tag: 'Pillar' },
    ],
    [], // L4 · full — no examples
  ],
};

export function seedsFor(courseId: string, level: number): SeedCase[] {
  return COURSE_SEEDS[courseId]?.[level] ?? [];
}

/** Foundations observe examples, keyed by lesson id (src/lessons.ts). Same
 *  harvest rules as COURSE_SEEDS — from-solved scrambles; for prereq lessons
 *  the scramble ITSELF ends with the prerequisite block built (it is exactly
 *  what makeScramble's prereq path emits, frozen). Tags verified by
 *  scripts/lessons-check.ts. */
export const LESSON_SEEDS: Record<string, SeedCase[]> = {
  pair: [
    { scramble: "L' D2 U' L' U L' F' R", note: 'The pair is already joined — watch it ride home as one piece.' },
    { scramble: "D2 U2 F2 B2 L' R B2 F", tag: 'Simple join', note: 'One turn joins corner and edge; the next takes the pair home.' },
    { scramble: "R' B U' R2 L' U' F' B'", tag: 'Roundabout', note: 'No pair yet — three turns manufacture one, then it drops in.' },
  ],
  square: [
    { scramble: "L B2 D U' F R D2 B2 R U' D L' U2 F D' F", tag: 'Roundabout', note: 'The second edge is fetched and joined onto the pair’s centre.' },
    { scramble: "D B F' R U D F2 U' F2 U D' B' U' R' D'", note: 'The pair steps aside, collects its second edge, and settles back.' },
    { scramble: "R' F U2 F' R B' R' B R2 F D F' B2 L2", tag: 'Roundabout', note: 'Watch the edge arrive without the pair ever breaking.' },
  ],
  block222: [
    { scramble: "L2 U2 D' R' B' D2 L2 B2 F' L F L U' L2 B' D' L2", tag: 'Roundabout', note: 'The square swings aside, the last edge slots in, the square swings back.' },
    { scramble: "F' L' F B2 R2 B' F' L U2 R2 L2 B F B2 D2", tag: 'Roundabout', note: 'Same idea from the other side — out, catch the edge, back.' },
    { scramble: "B2 U F2 R2 B U' L2 B2 D2 F2 U2 R2 U' F' U2 F'", tag: 'Roundabout', note: 'A setup turn first, then the swing out and back.' },
  ],
  ext223: [
    { scramble: "F D R B2 R2 U2 D2 L' D L R' B2 R' F' B' U2 L2", tag: 'Double join', note: 'Everything is lined up — one turn locks the whole extension on.' },
    { scramble: "B2 R2 L F R L U R2 U' F U F' R2 U' L' F' L'", tag: 'Swing', note: 'One setup turn, then the extension locks on in one.' },
    { scramble: "U' R D2 R F2 L D' F' L D2 L D2 U' F' U L' F' D", tag: 'Pillar', note: 'The corner twists out of its slot, pairs up, and rejoins properly.' },
  ],
  recover: [
    { scramble: "R B D B' F2 R D2", tag: 'Broken corner', note: 'The corner is in its slot but twisted — pop it out, catch its edge, drop it back in.' },
    { scramble: "R' U2 F' D2 L' B2 R", tag: 'Pillar', note: 'The corner is stacked right beside its slot — twist it out to pair, then in it goes.' },
    { scramble: "R2 B' D R F' B2 U'", tag: 'Broken corner', note: 'Another twisted-in-slot corner — same rescue: out, pair, back in.' },
  ],
  // Capstone: full 2×2×3 builds (no tag — a whole build spans several
  // techniques; the walkthrough groups it into the 2×2×2 and the extension).
  build223: [
    { scramble: "R' D F2 B' U D' L2 R' U B2 D2 F' R D2", note: 'The whole plan in one — pair up, finish the 2×2×2, then extend it.' },
    { scramble: "F2 B' D' B2 L' F2 L2 B' R U' B' R2 D2 L", note: 'Watch the milestones: a 2×2×2 forms first, then the extension locks on.' },
    { scramble: "B' L2 D F' B2 L' D F U' F2 U L2 D2 L'", note: 'A bigger build — the walkthrough splits it into the block and its extension.' },
  ],
};

export function lessonSeedsFor(lessonId: string): SeedCase[] {
  return LESSON_SEEDS[lessonId] ?? [];
}
