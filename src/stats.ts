// Persistence + computation for solve history and graded course progress. A pure
// data layer over storage — no app state, no rendering. The controller bits that
// react to a discarded solve (status text, advancing the scramble) stay in main.

import * as store from './storage.ts';
import { applyRep, emptyLessonProg, popRep, type LessonDef, type LessonPhase, type LessonProg } from './lessons.ts';

// --- stats persistence ---
// gaps: ms between consecutive solve moves (raw move stream, 10ms grain) — the
// raw material for the hesitation / lookahead analysis. insp: ms spent looking
// at the scrambled cube before the first solve move (inspection). Per solve.
export interface HistRec { step: string; used: number; optimal: number; ts: number; ms?: number; gaps?: number[]; insp?: number; }
export function loadHistory(): HistRec[] {
  return store.getJSON<HistRec[]>('history', []);
}
export function recordSolve(rec: HistRec) {
  // Settle the tally's one-time seed BEFORE this rep joins the history it seeds
  // from. Otherwise the very first recorded solve is counted twice: once by the
  // lazy seed inside bumpDaily (which would find it already in history) and once
  // by the bump itself. Caught by scripts/daily-check.ts.
  loadDaily();
  const h = loadHistory();
  h.push(rec);
  store.setJSON('history', h.slice(-500));
  bumpDaily(rec.step, rec.ts);
}

// --- daily practice tally ---
//
// How many reps of each thing you did on each day. This could be derived from
// `history` — it carries `ts` and `step` already — except that history is capped
// at the last 500 solves, so at any real practice rate the early days would age
// out of the record and a "reps per day" chart would silently lose its own past.
// So the counts are kept separately: a couple of dozen bytes a day, and they last.
//
// Only COMPLETED reps land here, because recordSolve is the only way in — an
// abandoned or retried attempt never reaches it. Discarding a solve rolls the
// tally back with it (see discardDaily), so the count always matches the history.
export type DailyTally = Record<string, Record<string, number>>;

/** Local calendar day, not UTC — a rep at 23:30 belongs to that evening. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function loadDaily(): DailyTally {
  // First read seeds itself from whatever history still holds, so the feature
  // doesn't start life pretending you have never practised. Absent (not empty)
  // is the trigger, so a genuinely empty tally is never re-seeded on every call.
  if (store.getRaw('daily') === null) {
    const seeded: DailyTally = {};
    for (const r of loadHistory()) {
      const day = (seeded[dayKey(r.ts)] ??= {});
      day[r.step] = (day[r.step] ?? 0) + 1;
    }
    store.setJSON('daily', seeded);
    return seeded;
  }
  return store.getJSON<DailyTally>('daily', {});
}

function bumpDaily(step: string, ts: number) {
  const t = loadDaily();
  const day = (t[dayKey(ts)] ??= {});
  day[step] = (day[step] ?? 0) + 1;
  store.setJSON('daily', t);
}

/** Undo one tally entry — pairs with discarding a solve from the history. */
export function discardDaily(step: string, ts: number) {
  const t = loadDaily();
  const day = t[dayKey(ts)];
  if (!day?.[step]) return;
  day[step] -= 1;
  if (day[step] <= 0) delete day[step];
  if (!Object.keys(day).length) delete t[dayKey(ts)];
  store.setJSON('daily', t);
}

/** Newest-first days, each with its per-step counts and total. */
export function dailyRows(limit: number): { day: string; total: number; steps: [string, number][] }[] {
  const t = loadDaily();
  return Object.keys(t)
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, limit)
    .map((day) => {
      const steps = Object.entries(t[day]).sort((a, b) => b[1] - a[1]);
      return { day, total: steps.reduce((n, [, c]) => n + c, 0), steps };
    });
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

// --- Foundations lesson progress ---
// The beginner course's per-lesson records, under their OWN key so the graded
// `course` records stay byte-identical for existing users. All gate math lives
// in lessons.ts (pure); this layer only loads, applies and saves.
export interface FoundationsTrack { current: number; lessons: Record<string, LessonProg>; }
export type FoundationsProg = Record<string, FoundationsTrack>;

export function loadFoundations(): FoundationsProg {
  return store.getJSON<FoundationsProg>('foundations', {});
}
export function saveFoundations(p: FoundationsProg) { store.setJSON('foundations', p); }
export function foundationsTrack(trainerId: string): FoundationsTrack {
  return loadFoundations()[trainerId] ?? { current: 0, lessons: {} };
}
export function lessonProgFor(trainerId: string, lessonId: string): LessonProg {
  return foundationsTrack(trainerId).lessons[lessonId] ?? emptyLessonProg();
}
export function setFoundationsCurrent(trainerId: string, idx: number) {
  const p = loadFoundations();
  const t = p[trainerId] ?? { current: 0, lessons: {} };
  t.current = idx;
  p[trainerId] = t;
  saveFoundations(p);
}
/** An observe example was actually applied (scramble completed) — consume it. */
export function bumpLessonObserved(trainerId: string, lessonId: string) {
  const p = loadFoundations();
  const t = p[trainerId] ?? { current: 0, lessons: {} };
  const lp = t.lessons[lessonId] ?? emptyLessonProg();
  lp.observed += 1;
  t.lessons[lessonId] = lp;
  p[trainerId] = t;
  saveFoundations(p);
}
/** Record one completed rep; returns the updated record (done may have flipped). */
export function recordLessonRep(trainerId: string, def: LessonDef, phase: LessonPhase, success: boolean): LessonProg {
  const p = loadFoundations();
  const t = p[trainerId] ?? { current: 0, lessons: {} };
  const lp = applyRep(def, t.lessons[def.id] ?? emptyLessonProg(), phase, success);
  t.lessons[def.id] = lp;
  p[trainerId] = t;
  saveFoundations(p);
  return lp;
}
/** Remove the most recent rep of a phase (the review's Discard). */
export function popLessonRep(trainerId: string, def: LessonDef, phase: LessonPhase) {
  const p = loadFoundations();
  const lp = p[trainerId]?.lessons?.[def.id];
  if (!lp) return;
  p[trainerId].lessons[def.id] = popRep(def, lp, phase);
  saveFoundations(p);
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
