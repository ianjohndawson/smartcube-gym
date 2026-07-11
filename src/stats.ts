// Persistence + computation for solve history and graded course progress. A pure
// data layer over storage — no app state, no rendering. The controller bits that
// react to a discarded solve (status text, advancing the scramble) stay in main.

import * as store from './storage.ts';

// --- stats persistence ---
// gaps: ms between consecutive solve moves (raw move stream, 10ms grain) — the
// raw material for the hesitation / lookahead analysis. insp: ms spent looking
// at the scrambled cube before the first solve move (inspection). Per solve.
export interface HistRec { step: string; used: number; optimal: number; ts: number; ms?: number; gaps?: number[]; insp?: number; }
export function loadHistory(): HistRec[] {
  return store.getJSON<HistRec[]>('history', []);
}
export function recordSolve(rec: HistRec) {
  const h = loadHistory();
  h.push(rec);
  store.setJSON('history', h.slice(-500));
}
export function computeStats() {
  const h = loadHistory();
  const solves = h.length;
  const times = h.filter((r) => r.ms != null).map((r) => r.ms as number);
  const bestMs = times.length ? Math.min(...times) : null;
  const avgMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  const lastTimes = times.slice(-20);
  if (!solves) return { solves: 0, avgOverIdeal: 0, optimalPct: 0, bestStreak: 0, last12: [] as number[], byStep: [] as { label: string; avg: number }[], bestMs, avgMs, lastTimes };
  const extras = h.map((r) => r.used - r.optimal);
  const avgOverIdeal = extras.reduce((a, b) => a + b, 0) / solves;
  const optimalPct = Math.round((100 * h.filter((r) => r.used === r.optimal).length) / solves);
  let best = 0, cur = 0;
  for (const r of h) { if (r.used === r.optimal) { cur++; best = Math.max(best, cur); } else cur = 0; }
  const byMap = new Map<string, { sum: number; n: number }>();
  for (const r of h) { const m = byMap.get(r.step) ?? { sum: 0, n: 0 }; m.sum += r.used - r.optimal; m.n++; byMap.set(r.step, m); }
  const byStep = [...byMap.entries()].map(([label, m]) => ({ label, avg: m.sum / m.n })).sort((a, b) => a.label.localeCompare(b.label));
  return { solves, avgOverIdeal, optimalPct, bestStreak: best, last12: extras.slice(-12), byStep, bestMs, avgMs, lastTimes };
}

// --- lookahead drill tally ---
// One record per prediction rep: was the tapped slot where the piece really was?
export interface LookaheadStats { attempts: number; correct: number; recent: number[]; }
export function loadLookahead(): LookaheadStats {
  return store.getJSON<LookaheadStats>('lookahead', { attempts: 0, correct: 0, recent: [] });
}
export function recordLookahead(ok: boolean): LookaheadStats {
  const la = loadLookahead();
  la.attempts += 1;
  if (ok) la.correct += 1;
  la.recent = [...la.recent, ok ? 1 : 0].slice(-20);
  store.setJSON('lookahead', la);
  return la;
}

// --- course progress ---
// Levels are cleared by CONSISTENCY, not a single average: over the last
// COURSE_WINDOW solves, what fraction were "clean" (move-waste = used − optimal
// ≤ COURSE_TOLERANCE)? A tolerance is used because the solver's optimal can be
// an awkward, non-ergonomic line, so we reward solid human solving, not exact
// optimality. Pass-rate → stars; ≥ the 1★ rate clears + unlocks the next level.
export const COURSE_WINDOW = 12;
export const COURSE_TOLERANCE = 2; // a solve is "clean" if it's within +2 of optimal
export const COURSE_STAR_RATES = [0.70, 0.85, 1.0]; // clean-rate for 1★ / 2★ / 3★
// intro: how many of the level's seeded example cases have been served (the
// curated lesson opener); grading starts after the examples run out.
export interface CourseLevel { recent: number[]; stars: number; intro?: number; }
export interface CourseTrack { unlocked: number; current: number; levels: Record<number, CourseLevel>; }
export type CourseProg = Record<string, CourseTrack>;

export function loadCourse(): CourseProg {
  return store.getJSON<CourseProg>('course', {});
}
export function saveCourse(p: CourseProg) { store.setJSON('course', p); }
export function courseTrack(id: string): CourseTrack {
  const p = loadCourse();
  return p[id] ?? { unlocked: 0, current: 0, levels: {} };
}
export function courseCurrent(id: string): number {
  return courseTrack(id).current;
}
export function setCourseCurrent(id: string, level: number) {
  const p = loadCourse();
  const t = p[id] ?? { unlocked: 0, current: 0, levels: {} };
  t.current = level;
  p[id] = t;
  saveCourse(p);
}
/** Seeded-example progress for a level: how many examples have been served. */
export function courseIntro(id: string, level: number): number {
  return courseTrack(id).levels[level]?.intro ?? 0;
}
export function bumpCourseIntro(id: string, level: number) {
  const p = loadCourse();
  const t = p[id] ?? { unlocked: 0, current: 0, levels: {} };
  const lv = t.levels[level] ?? { recent: [], stars: 0 };
  lv.intro = (lv.intro ?? 0) + 1;
  t.levels[level] = lv;
  p[id] = t;
  saveCourse(p);
}
// Fraction of recent solves that were clean (waste ≤ tolerance).
function cleanRate(recent: number[]): number {
  if (!recent.length) return 0;
  return recent.filter((w) => w <= COURSE_TOLERANCE).length / recent.length;
}
function starsForRate(rate: number): number {
  if (rate >= COURSE_STAR_RATES[2]) return 3;
  if (rate >= COURSE_STAR_RATES[1]) return 2;
  if (rate >= COURSE_STAR_RATES[0]) return 1;
  return 0;
}
// Record one solve at the current level; returns a short status note (cleared / progress).
export function recordCourse(trainerId: string, levelCount: number, waste: number): string {
  const p = loadCourse();
  const t = p[trainerId] ?? { unlocked: 0, current: 0, levels: {} };
  const level = t.current;
  const lv = t.levels[level] ?? { recent: [], stars: 0 };
  lv.recent = [...lv.recent, waste].slice(-COURSE_WINDOW);
  let note = '';
  if (lv.recent.length >= COURSE_WINDOW) {
    const stars = starsForRate(cleanRate(lv.recent));
    const wasCleared = lv.stars >= 1;
    lv.stars = Math.max(lv.stars, stars);
    if (lv.stars >= 1) {
      const newUnlocked = Math.min(levelCount - 1, level + 1);
      if (t.unlocked < newUnlocked) t.unlocked = newUnlocked;
      if (!wasCleared) {
        note = `Level cleared ${'★'.repeat(lv.stars)}${'☆'.repeat(3 - lv.stars)}`;
        if (level + 1 < levelCount) { t.current = level + 1; note += ` — Level ${level + 2} unlocked!`; }
        else note += ' — track complete! 🏆';
      }
    }
  }
  t.levels[level] = lv;
  p[trainerId] = t;
  saveCourse(p);
  return note;
}
