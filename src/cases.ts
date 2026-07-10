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

export interface SeedCase { scramble: string; tag: PatternName; }

/** courseId → per-level seed lists (index-aligned with the course's levels). */
export const COURSE_SEEDS: Record<string, SeedCase[][]> = {
  course222: [
    [ // L1 · Simple joins
      { scramble: "L F L U B' L' R' D2 F2 R2", tag: 'Simple join' },
      { scramble: "R2 F R F' U2 R' F2 D' B2 R", tag: 'Simple join' },
      { scramble: "B R2 B' R U B2 L F2 D L", tag: 'Simple join' },
    ],
    [ // L2 · Double joins & Swings
      { scramble: "D R' B2 U2 R'", tag: 'Double join' },
      { scramble: "R F2 L' F2 L'", tag: 'Double join' },
      { scramble: "D2 U' B' U' D'", tag: 'Swing' },
    ],
    [ // L3 · Roundabouts & rescues
      { scramble: "R U B2 D F' U", tag: 'Broken corner' },
      { scramble: "R2 L2 U2 B D2 U'", tag: 'Broken corner' },
      { scramble: "U' B F U' R' D", tag: 'Broken corner' },
    ],
    [], // L4 · full — no examples
  ],
};

export function seedsFor(courseId: string, level: number): SeedCase[] {
  return COURSE_SEEDS[courseId]?.[level] ?? [];
}
