import './style.css';
import {
  Cube3x3,
  applyMove,
  applyMoves,
  faceletString,
  newSolved,
  optimalToMask,
  solveFromState,
  parseMoves,
  isMaskSolvedState,
  isEoSolvedFromState,
  homePermutation,
  cubeFromFacelets,
  findBridge,
  type Move3x3,
  type RotationMove,
} from './engine-api.ts';
import { kociembaToNet } from './resync.ts';
import {
  CATEGORIES,
  genScramble,
  trainerById,
  trainersIn,
  type Category,
  type StepDef,
} from './steps.ts';
import { locatePieceNow, nextFocusPiece, nextTwoFocusPieces, pieceDescription, placementName, slotName, targetPieceStates, type FocusPiece } from './pieces.ts';
import { humanSolveFromState } from './human-solve.ts';
import { activePlacement, canonicalIndexIn, scorePlacement } from './placement.ts';
import { classifyRoute, isPairJoined, PATTERN_HOW, routeRoles, type MoveRole, type PatternName } from './patterns.ts';
import { lessonSeedsFor, seedsFor } from './cases.ts';
import { derivePhase, firstOpenLesson, lessonsFor, successCount, type LessonDef, type LessonPhase } from './lessons.ts';
import { eoHint, blockHint } from './hints.ts';
import { sampleEoScramble } from './eo-scramble.ts';
import { genEoSafeScramble } from './steps.ts';
import { CORNER_FACELETS, NET_COORDS } from './blocks.ts';
import * as store from './storage.ts';
import { applyTheme, getTheme, resolveTheme, setTheme } from './theme.ts';
import { el, btn, renderCubeNet, renderCube3D } from './dom.ts';
import {
  loadHistory, recordSolve, computeStats,
  loadCourse, saveCourse, courseTrack, courseCurrent, setCourseCurrent, recordCourse,
  courseIntro, bumpCourseIntro,
  foundationsTrack, lessonProgFor, setFoundationsCurrent, bumpLessonObserved, recordLessonRep, popLessonRep,
  loadLookahead, recordLookahead,
  COURSE_WINDOW, COURSE_TOLERANCE, COURSE_STAR_RATES,
} from './stats.ts';
import { axisBad, badEdgeStickers, eoAxisOptimalLen, eoMaskForStep, freeEoHint, isFreeEo } from './eo-axis.ts';
import { blockEoAxis, blockEoDisplayRots, blockEoPrereq, blockEoTarget, isBlockEoSolved, randomBlockEoOrient, type BlockEoMethod } from './block-eo.ts';

const SOLVED_STR = faceletString(newSolved());

// Facelets grouped into cubies (pieces) by shared coordinate — for piece-based progress.
const CUBIES: number[][] = (() => {
  const byCoord = new Map<string, number[]>();
  NET_COORDS.forEach((c, i) => {
    const k = c.join(',');
    (byCoord.get(k) ?? byCoord.set(k, []).get(k)!).push(i);
  });
  return [...byCoord.values()];
})();

// The (non-centre) pieces a mask's block covers.
function blockPiecesFor(mask: StepDef['canonicalMask']): number[][] {
  const set = new Set(mask.solvedFaceletIndices);
  return CUBIES.filter((g) => g.length > 1 && g.some((i) => set.has(i)));
}

// --- placement-aware coaching target ---
// Which of a block step's accepted placements the coaching aims at: the one the
// user is actually building (threaded per-move through state.placementIdx with
// hysteresis — see placement.ts), else the canonical. Completion acceptance
// (solvedStepMask) is unchanged; this only points progress/ideal/hints/Learn at
// the user's block instead of insisting on bottom-left. EO-family steps never
// come through here — their targets are axis-aware, handled by their own paths.
const canonicalIdxCache = new WeakMap<StepDef, number>();
function canonicalIdxFor(s: StepDef): number {
  let i = canonicalIdxCache.get(s);
  if (i === undefined) {
    i = canonicalIndexIn(s.candidateMasks, s.canonicalMask);
    canonicalIdxCache.set(s, i);
  }
  return i;
}
function activeMask(s: StepDef): StepDef['canonicalMask'] {
  if (s.kind !== 'block' || s.candidateMasks.length <= 1) return s.canonicalMask;
  return s.candidateMasks[state.placementIdx ?? canonicalIdxFor(s)];
}

// Tap-to-aim (2×2×2 family): tapping any sticker of a CORNER cubie names one
// octant uniquely, so the coaching can aim there and stop second-guessing the
// user (pinned until the step ends). Edges/centres belong to several octants —
// prompt for a corner instead. The tapped index arrives in the display frame;
// block steps only ever show the x2 phase-flip, which is self-inverse, so the
// same rotation maps it back to the model frame.
function pinPlacementAt(viewIdx: number, s: StepDef) {
  const modelIdx = solveFrame() ? [...rotateHighlight(new Set([viewIdx]), solveRotation())][0] : viewIdx;
  const group = CUBIES.find((g) => g.includes(modelIdx));
  if (!group || group.length !== 3) {
    state.status = 'Tap a corner piece to aim your 2×2×2 there.';
    render();
    return;
  }
  const idx = s.candidateMasks.findIndex((m) => {
    const set = new Set(m.solvedFaceletIndices);
    return group.every((j) => set.has(j));
  });
  if (idx < 0) return;
  state.placementIdx = idx;
  state.placementPinned = true;
  state.status = `Aiming at the ${placementName(s.candidateMasks[idx])} block — coaching follows it.`;
  render();
}

// Step progress as WHOLE pieces placed (+ edges oriented for EO) — meaningful,
// unlike a raw facelet-colour match. Returns fraction, percent, and a caption.
function progressInfo(cube: Cube3x3, s: StepDef): { frac: number; pct: number; caption: string } {
  // Free-EO (Full EO / EOLine / EOCross): score against the CHOSEN axis. Edge
  // orientation is already axis-aware (orientedEdges); the line/cross pieces are
  // counted colour-identified (home[i]===i) so a red-axis line — which sits at a
  // y-image of the model-frame DF/DB line — is recognised as placed.
  if (isFreeEo(s) || isBlockEo(s)) {
    const oriented = orientedEdges(cube, s);
    const pieces = blockPiecesFor(isBlockEo(s) ? blockEoTarget(state.blockEoOrient) : eoMaskForStep(s, state.eoAxis));
    if (pieces.length) {
      const home = homePermutation(cube.stateData);
      const placed = home.length ? pieces.filter((g) => g.every((i) => home[i] === i)).length : 0;
      const frac = (placed + oriented) / (pieces.length + 12);
      return { frac, pct: Math.round(frac * 100), caption: `${placed}/${pieces.length} pieces · ${oriented}/12 edges` };
    }
    const frac = oriented / 12;
    return { frac, pct: Math.round(frac * 100), caption: `${oriented}/12 edges oriented` };
  }
  const f = faceletString(cube);
  const mask = activeMask(s); // follow the placement the user is building
  const pieces = blockPiecesFor(mask);
  const placed = pieces.filter((g) => g.every((i) => f[i] === SOLVED_STR[i])).length;
  if (mask.eoFaceletIndices) {
    const oriented = orientedEdges(cube, s);
    if (pieces.length) {
      const frac = (placed + oriented) / (pieces.length + 12);
      return { frac, pct: Math.round(frac * 100), caption: `${placed}/${pieces.length} pieces · ${oriented}/12 edges` };
    }
    const frac = oriented / 12;
    return { frac, pct: Math.round(frac * 100), caption: `${oriented}/12 edges oriented` };
  }
  const frac = pieces.length ? placed / pieces.length : 1;
  return { frac, pct: Math.round(frac * 100), caption: `${placed}/${pieces.length} pieces placed` };
}

// First-pass "case" label for a step's START state (v2 course, DISPLAY-ONLY for
// now while we verify the labels). Blocks: interference (a built piece gets
// disturbed) → buried (a needed piece sits in the D layer) → pieces apart →
// nearly there. EO: by bad-edge count.
function classifyCase(start: Cube3x3, s: StepDef, optimal: Move3x3[], mask: StepDef['canonicalMask']): string {
  if (s.kind === 'eo') {
    const ax = eoStepAxis(s);
    const bad = ax ? axisBad(start, ax).count : start.EO.filter((g) => !g).length;
    return bad === 0 ? 'already oriented' : `${bad} bad edges`;
  }
  // The label describes the solve that actually happened, so it reads the mask
  // that was scored (the placement completed), not the canonical one.
  const homes = blockPiecesFor(mask);
  if (!homes.length) return '';
  const f0 = faceletString(start);
  const wasSolved = homes.map((g) => g.every((i) => f0[i] === SOLVED_STR[i]));
  let cur = start;
  let interference = false;
  for (const m of optimal) {
    cur = applyMove(cur, m);
    const f = faceletString(cur);
    homes.forEach((g, i) => { if (wasSolved[i] && !g.every((j) => f[j] === SOLVED_STR[j])) interference = true; });
  }
  if (interference) return 'keep the block';
  const unsolved = targetPieceStates(start, mask).filter((p) => !p.solved);
  if (!unsolved.length) return 'already built';
  if (unsolved.some((p) => p.coord[1] === 0)) return 'buried piece';
  if (unsolved.length >= 2) return 'pieces apart';
  return 'nearly there';
}

// Corner facelets as a set, for the "EO keeps no block" corner-blank test.
const CORNER_SET = new Set(CORNER_FACELETS);
// Every facelet — blanks the whole view for the lookahead drill's eyes-closed phase.
const ALL_FACELETS = new Set(Array.from({ length: 54 }, (_, i) => i));
import {
  orientLabel,
  rotateHighlight,
  rotatedFacelets,
  toDisplayMoves,
  toModelMoves,
  AXIS_ROTATION,
  AXIS_LABEL,
  AXIS_SHORT,
  OTHER_AXIS,
  type SolveAxis,
} from './orient.ts';
import { CubeManager, clearSavedMacs, getSavedMacs } from './bluetooth.ts';

type Mode = 'scramble' | 'solve';

type TrainMode = 'efficiency' | 'timed';

interface State {
  category: Category;
  trainerId: string;
  trainMode: TrainMode;
  stepIndex: number;
  mode: Mode;
  solveStartMs: number | null; // when solving began (scramble completed)
  solveStartLen: number; // history length when solving began
  finishedMs: number | null; // when the whole journey completed
  cube: Cube3x3; // live tracked state
  base: Cube3x3; // cube state when the current scramble was issued
  target: Cube3x3; // base + scramble
  scrambleMoves: Move3x3[];
  scrambleBaseLen: number; // history length when this scramble was issued
  scrambleReached: number; // furthest on-track scramble index reached (for progress + off-track red)
  prefixEncodes: string[]; // encoded states base..target (for green progress)
  pendingLearn: boolean; // after this setup completes, start the ideal walkthrough
  history: Move3x3[]; // all moves from solved
  historyValid: boolean; // false after a hard resync (history unknown) — hints need it
  /** Set when the pending setup provably passes THROUGH solved (the example
   *  unwind): once it lands, the history is replaced by this equivalent
   *  from-solved sequence, so it stops accumulating across the session. */
  historyResetTo: Move3x3[] | null;
  stepStartHistory: Move3x3[];
  stepStartCube: Cube3x3; // live cube state at the start of the current step (for state-based ideal/scoring)
  movesThisStep: Move3x3[];
  movesThisStepTs: number[]; // Date.now() per movesThisStep move (raw stream — pause/lookahead analysis)
  placementIdx: number | null; // block steps: the candidate placement coaching aims at (hysteresis pick)
  placementPinned: boolean; // user tapped a corner to aim — the pick stops second-guessing them
  solveReadyMs: number | null; // when the scramble completed — inspection runs until the first move
  stepDone: boolean[];
  eoAxis: SolveAxis; // free-EO: which side axis EO is solved against this scramble
  eoCommitted: boolean; // free-EO: axis decided for this scramble (vs awaiting an ask-prompt)
  blockEoOrient: number; // 2×2×3+EO: rolled orientation (0..3) — the random long-side colour
  courseSeedTag: PatternName | null; // this scramble is a seeded lesson example (not graded)
  /** Graded-course example issued but not yet applied — consumed (bumpCourseIntro)
   *  when the scramble completes, so re-issuing scrambles can't burn examples. */
  courseSeedPending: boolean;
  /** Foundations rep context. example=true is an ungraded observe demonstration;
   *  consumed flips when its scramble is applied (so retries can't re-burn it). */
  lessonRep: { example: boolean; consumed: boolean; note: string | null } | null;
  /** Most revealing help used this step: 0 none · 1 hint · 2 next move ·
   *  3 ideal/walkthrough. A Foundations rep only counts as a success below 3. */
  helpUsed: number;
  brokeProtected: boolean; // the prereq block left its solved state at some point this step
  protectedNow: boolean; // the prereq block is currently intact (transition detector)
  identify: { stage: number } | null; // L1 tap-identification: 0 = find the corner, 1 = find an edge
  assist: { kind: 'nudge' | 'move' | 'ideal'; moves: Move3x3[]; focus: FocusPiece | null; pattern: PatternName | null } | null;
  /** Lookahead rep: plan the join while predicting z; view is blanked until the
   *  answer tap. z is the second piece the taught route places. */
  predict: { z: FocusPiece; joinDesc: string } | null;
  predictResult: { stickers: number[]; note?: string } | null; // transient reveal highlight (cleared on next move)
  /** Guided ideal replay. `moves` is the route from `base` (the cube state the
   *  route was computed from) to the step target; `baseLen` is the history length
   *  at that point, so progress reads off the moves made since. Block steps carry
   *  the walkthrough ANNOTATIONS: `seg` = the taught route's classified pattern
   *  segments (the technique each group of moves performs), `roles` = what each
   *  single move is doing (setup/join/carry/place). All four are recomputed if you
   *  step off the route (see rebaseWalkthrough), so the moves shown always lead
   *  home from where the cube actually is; `rebased` then flags that re-plan. */
  learn: {
    moves: Move3x3[];
    base: Cube3x3;
    baseLen: number;
    seg?: { name: PatternName | null; from: number; to: number }[];
    roles?: MoveRole[];
    rebased?: boolean;
  } | null;
  lastResult: {
    step: string; used: number; optimal: number | null; yourMoves: Move3x3[]; idealMoves: Move3x3[]; case?: string;
    eo?: { gb: { len: number; bad: number }; ro: { len: number; bad: number } };
    /** Planning verdict: the cheapest placement vs the one actually built. */
    rank?: { bestName: string; bestLen: number; yoursName: string; yoursLen: number; yoursBest: boolean };
    insp?: number; // ms spent inspecting before the first solve move
    /** Named Petrus patterns detected in the ideal route and the user's solve. */
    patterns?: { ideal: PatternName[]; yours: PatternName[] };
    /** Foundations rep summary — drives the beginner review. */
    lesson?: { example: boolean; success?: boolean; brokeProtected?: boolean; hadPrereq?: boolean; focusNext?: string };
  } | null;
  connected: boolean;
  battery: number | null;
  status: string;
  showSettings: boolean;
  showStats: boolean; // top-bar Stats overlay — accessible in any mode, not just mid-session
  showPicker: boolean;
  rightTab: 'coach' | 'stats';
  log: string[];
  lastError: string;
}

const appEl = document.getElementById('app')!;

function trainer() {
  return trainerById(state.trainerId);
}
// Foundations trainers resolve their ACTIVE LESSON's step (the TrainerDef's own
// steps[] is only a fallback); everything downstream — progress, hints, Learn,
// scramble generation, review — then works on the single resolved step.
function activeLessonDefFor(trainerId: string): LessonDef | null {
  const defs = lessonsFor(trainerId);
  if (!defs) return null;
  return defs[Math.min(foundationsTrack(trainerId).current, defs.length - 1)];
}
function activeLessonDef(): LessonDef | null {
  return activeLessonDefFor(state.trainerId);
}
/** The active lesson's live phase (derived — never stored). Null off-lesson. */
function lessonPhaseNow(): LessonPhase | null {
  const def = activeLessonDef();
  if (!def) return null;
  return derivePhase(def, lessonProgFor(state.trainerId, def.id), lessonSeedsFor(def.id).length);
}
function steps(): StepDef[] {
  const def = activeLessonDef();
  return def ? [def.step] : trainer().steps;
}
function currentStep(): StepDef | null {
  return steps()[state.stepIndex] ?? null;
}

// --- rep phase (the one definition of "where are we in this rep") ---
//
// `state.mode` only distinguishes scramble from solve; the finer phases live in
// four independent fields (learn / predict / identify / stepDone) that every
// builder used to re-derive its own way — buildCubePanel interleaved five such
// conditionals, and the review test was written out twice, verbatim, in the two
// gesture handlers. The precedence between them is real logic and belongs in one
// place: this function. The Now bar, the allowed verbs, the stage decorations and
// the meter all read the phase from here rather than from raw state, so a new
// phase (inspection, piece tracking) is a case added HERE plus the copy that goes
// with it — not another conditional threaded through five builders.
//
// NOT a rep phase, deliberately: Stats and Settings. Those are overlays you can
// open in any phase, and the rep underneath keeps its phase while they're up.
type RepPhase =
  | 'setup'        // applying the scramble; solving auto-starts when it matches
  | 'solve'        // working the step target on your own
  | 'identify'     // Foundations: find-the-piece tap prompt is standing
  | 'lookahead'    // predict-where-it-lands rep; the view is blanked
  | 'walkthrough'  // guided replay of the ideal route
  | 'review';      // target reached — showing the verdict

/** Where this rep is. Precedence is load-bearing — see the guard comments. */
function repPhase(): RepPhase {
  if (state.mode === 'scramble') return 'setup';
  // Review outranks a walkthrough: completing the target during one clears
  // state.learn (afterLearnMove), so the two can't both be live — but render()
  // has always tested allDone first, and the order is kept explicit here.
  if (state.stepDone.every(Boolean)) return 'review';
  if (state.learn) return 'walkthrough';
  // A lookahead rep outranks a find prompt: both want the sticker taps, and the
  // lookahead answer is the one the user is mid-way through giving.
  if (state.predict) return 'lookahead';
  if (state.identify) return 'identify';
  return 'solve';
}

/** Phases where the user is turning the cube toward the step target under their
 *  own steam — so help, Retry and the solving display frame all apply. A
 *  walkthrough is excluded: it has its own pane and its own controls. */
function isSolvingPhase(p: RepPhase = repPhase()): boolean {
  return p === 'solve' || p === 'lookahead' || p === 'identify';
}

// Scramble lengths. SCRAMBLE_LEN is the uniform random-scramble length shared by
// the general block/drill paths AND the EO path (EO reaches it by padding its short
// bad-edge setup with EO-safe moves, so the mechanism differs but the length now
// matches — #3). The course path bands its own length by difficulty and is
// intentionally exempt.
const SCRAMBLE_LEN = 16;
const EO_SCRAMBLE_LEN = SCRAMBLE_LEN;

function makeScramble(base: Cube3x3, baseHistory: Move3x3[], stepsList: StepDef[], blockEoOrient = 0, lessonGen?: { len?: number; maxOptimal?: number; patterns?: PatternName[] }): Move3x3[] {
  const first = stepsList[0];
  // Course: generate a scramble whose optimal solution to the block lands in the
  // current level's difficulty band. Shorter random scrambles for easier bands.
  const tr = trainerById(state?.trainerId ?? '');
  if (tr.course) {
    const band = tr.course[Math.min(courseCurrent(tr.id), tr.course.length - 1)];
    // Technique lessons: practice whose TAUGHT route opens with one of the
    // lesson's named patterns — the same classifier the hints and review use,
    // so what the lesson promises is what the coaching will call it.
    if (band.patterns) {
      // Match when the taught route USES the technique anywhere (a route's
      // first named event is almost always the pair-forming Simple join, so a
      // first-event filter would starve every other lesson). Ranked over a
      // small solution count — same route structure, ~10× cheaper per attempt.
      const want = new Set<PatternName>(band.patterns);
      const len = band.len ?? SCRAMBLE_LEN;
      let last = genScramble(len);
      for (let attempt = 0; attempt < 20; attempt++) {
        const scr = genScramble(len);
        last = scr;
        const cube = applyMoves(base, scr);
        if (first.candidateMasks.some((m) => isMaskSolvedState(cube, m))) continue;
        const taught = humanSolveFromState(cube, first.canonicalMask, first.solver, 16);
        if (!taught) continue;
        const names = classifyRoute(cube, taught, first.canonicalMask).map((e) => e.name);
        if (names.some((n) => n != null && want.has(n))) return scr;
      }
      return last; // nothing matched within budget — serve the last rather than stall
    }
    const cfg = { ...first.solver, depthLimit: 16 };
    const min = band.min ?? 1;
    const max = band.max ?? 99;
    const len = max >= 99 ? 16 : Math.min(16, max + 4);
    let last = genScramble(len);
    for (let attempt = 0; attempt < 25; attempt++) {
      const scr = genScramble(len);
      last = scr;
      const cube = applyMoves(base, scr);
      // Pre-solved in ANY accepted placement (completion accepts every candidate).
      if (first.candidateMasks.some((m) => isMaskSolvedState(cube, m))) continue;
      const opt = (solveFromState(cube, first.canonicalMask, cfg) ?? []).length;
      const eff = opt === 0 ? 99 : opt; // 0 = deeper than the measure limit
      if (eff >= min && eff <= max) return scr;
    }
    return last;
  }
  // EO: pick the bad-edge count from the binomial, then use the shortest sequence
  // that yields it (exact distribution, ~5-move scrambles). Permutation-independent,
  // so it works applied from the current cube. From a solved cube, prepend an
  // EO-preserving permutation scramble so the first case still looks messed up.
  // Drills with a prerequisite (e.g. "EO keep 2×2×3", "1×2×3 R with L solved",
  // "2×2 → 2×2×3"): the scramble must START with the prereq block built and the
  // rest scrambled. Random-scramble, then solve to the prereq only; reject cases
  // where this step's target is already complete (nothing to practise).
  if (first.prereqMask) {
    // 2×2×3+EO pre-builds the rolled orientation's block; its target is colour-identified
    // (isBlockEoSolved), not the static canonical mask. Plain drills reject a case
    // pre-solved in ANY accepted placement (completion accepts every candidate —
    // e.g. either 2×2×1 square containing the pre-built pair).
    const beo = isBlockEo(first);
    const prereq = beo ? blockEoPrereq(blockEoOrient) : first.prereqMask;
    const targetDone = (c: Cube3x3) => beo ? isBlockEoSolved(c, blockEoOrient) : first.candidateMasks.some((m) => isMaskSolvedState(c, m));
    const buildCfg = { ...first.solver, depthLimit: 16 };
    // Foundations difficulty cap: try for a case within the lesson's optimal
    // ceiling for half the budget, then accept any valid case — never stall.
    let fallback: Move3x3[] | null = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const scr = genScramble(SCRAMBLE_LEN);
      const build = optimalToMask([...baseHistory, ...scr], prereq, buildCfg) ?? [];
      // The scr+build seam can leave a same-face pair (e.g. "R2 R2") — collapse
      // it; state-preserving, so the prereq stays built.
      const full = simplifyMoves([...scr, ...build]);
      const cube = applyMoves(base, full);
      if (!isMaskSolvedState(cube, prereq) || targetDone(cube)) continue;
      if (lessonGen?.maxOptimal != null && attempt < 10) {
        const opt = solveFromState(cube, first.canonicalMask, first.solver)?.length ?? 99;
        if (opt > lessonGen.maxOptimal) { fallback = full; continue; }
      }
      return full;
    }
    if (fallback) return fallback;
    const scr = genScramble(SCRAMBLE_LEN);
    return simplifyMoves([...scr, ...(optimalToMask([...baseHistory, ...scr], prereq, buildCfg) ?? [])]);
  }
  if (first.kind === 'eo') {
    // Pad every EO scramble up to a uniform length with EO-PRESERVING moves (they
    // don't change the bad-edge pattern). This obfuscates: a short scramble is just
    // the optimal solution reversed, and a uniform length hides the difficulty. The
    // targeted bad-edge case (and so the optimal) is unchanged.
    //
    // #5: the pad/eoSeq join used to leave cancelling or combining moves at the seam
    // (e.g. pad ends `R`, eoSeq starts `R'` -> `R R'`; or `D2` then `D` -> `D'`).
    // simplifyMoves only merges consecutive same-face turns (which commute), so a
    // length-preserved concatenation has NO cancellation. Both halves are already
    // internally clean — the pad guards same-face repeats, and eoSeq is a shortest
    // BFS sequence — so the seam is the only place a collapse can happen. Reject any
    // pad whose seam collapses and return the untouched concatenation: the bad-edge
    // case AND the uniform length both stay intact.
    const eoSeq = sampleEoScramble();
    const need = Math.max(0, EO_SCRAMBLE_LEN - eoSeq.length);
    for (let attempt = 0; attempt < 40; attempt++) {
      const full = [...genEoSafeScramble(need), ...eoSeq];
      if (simplifyMoves(full).length === full.length) return full;
    }
    // Unreachable in practice; clean the seam as a fallback. simplifyMoves preserves
    // the exact target state, so the bad-edge case and solved-ness are unchanged.
    return simplifyMoves([...genEoSafeScramble(need), ...eoSeq]);
  }
  // Blocks: a normal-length random scramble, rejecting any that pre-solve the
  // step in ANY accepted placement — completion accepts every candidate, so a
  // scramble that leaves some other 2×2×2 built would be a degenerate solve.
  // Checked state-based from the actual base, so it's right after a resync too.
  // Foundations lessons may shorten the scramble and cap the optimal (small
  // masks solve in ms at pd4, so the filter is cheap).
  const len = lessonGen?.len ?? SCRAMBLE_LEN;
  // Recovery lesson: keep only scrambles whose TAUGHT route uses one of the
  // named rescue techniques (Broken corner / Pillar) — the same anywhere-match
  // and cheap rankCount the course222 pattern lessons use.
  const wantPatterns = lessonGen?.patterns ? new Set<PatternName>(lessonGen.patterns) : null;
  let lastBlock = genScramble(len);
  for (let attempt = 0; attempt < 25; attempt++) {
    const moves = genScramble(len);
    lastBlock = moves;
    const cube = applyMoves(base, moves);
    if (first.candidateMasks.some((m) => isMaskSolvedState(cube, m))) continue;
    if (wantPatterns) {
      const taught = humanSolveFromState(cube, first.canonicalMask, first.solver, 16);
      if (!taught) continue;
      const names = classifyRoute(cube, taught, first.canonicalMask).map((e) => e.name);
      if (!names.some((n) => n != null && wantPatterns.has(n))) continue;
      return moves;
    }
    if (lessonGen?.maxOptimal != null && attempt < 15) {
      const opt = solveFromState(cube, first.canonicalMask, first.solver)?.length ?? 99;
      if (opt > lessonGen.maxOptimal) continue;
    }
    return moves;
  }
  return lastBlock; // budget exhausted — serve the last valid scramble rather than stall
}

function computePrefixEncodes(base: Cube3x3, moves: Move3x3[]): string[] {
  const encs = [base.encode()];
  let c = base;
  for (const m of moves) {
    c = applyMove(c, m);
    encs.push(c.encode());
  }
  return encs;
}

/** Begin a new scramble from a given base cube + history (continuous reps).
 *  `explicit` lets callers supply the exact setup sequence (e.g. an undo back to
 *  the same case) instead of a fresh random scramble. */
function startScramble(base: Cube3x3, baseHistory: Move3x3[], explicit?: Move3x3[]): State {
  const t = trainerById(state?.trainerId ?? 'petrus');
  // Foundations trainers train their ACTIVE LESSON's step, not t.steps.
  const lessonDef = activeLessonDefFor(t.id);
  const stepsList = lessonDef ? [lessonDef.step] : t.steps;
  // Roll the 2×2×3+EO orientation (random long-side colour) for this scramble; reuse
  // the current one when reproducing an explicit setup (retry/undo keeps the case).
  const blockEoOrient = explicit ? (state?.blockEoOrient ?? 0) : isBlockEo(stepsList[0]) ? randomBlockEoOrient() : 0;
  // Curated course lessons open with seeded examples. A seed scramble is a
  // from-solved state, so it is only served when the tracked cube IS solved
  // (lesson entry resets to solved); otherwise practice is generated and the
  // example counter waits. Consumed when the scramble is APPLIED (afterChange),
  // not on issue — trainer/category navigation that re-issues scrambles can't
  // burn examples (the same rule the Foundations lessons use). Retry/undo
  // keeps the tag; only a fresh serve arms the pending-consume flag.
  let courseSeedTag: PatternName | null = explicit ? (state?.courseSeedTag ?? null) : null;
  let courseSeedPending = false;
  let moves: Move3x3[] | null = explicit ?? null;
  if (!moves && t.course && faceletString(base) === SOLVED_STR) {
    const lvl = Math.min(courseCurrent(t.id), t.course.length - 1);
    const seeds = seedsFor(t.id, lvl);
    const intro = courseIntro(t.id, lvl);
    if (intro < seeds.length) {
      moves = parseMoves(seeds[intro].scramble);
      courseSeedTag = seeds[intro].tag ?? null;
      courseSeedPending = true;
    }
  }
  // Foundations serving: in the observe phase (and from a solved base) the next
  // curated example is issued — but NOT consumed here; it's consumed when the
  // scramble is APPLIED (afterChange), so trainer/category navigation that
  // re-issues scrambles can't burn examples. All other phases get generated
  // practice through the lesson's difficulty filter.
  let lessonRep: State['lessonRep'] = explicit ? (state?.lessonRep ?? null) : null;
  if (!moves && lessonDef) {
    const seeds = lessonSeedsFor(lessonDef.id);
    const prog = lessonProgFor(t.id, lessonDef.id);
    const phase = derivePhase(lessonDef, prog, seeds.length);
    if (phase === 'observe' && faceletString(base) === SOLVED_STR && prog.observed < seeds.length) {
      const sc = seeds[prog.observed];
      moves = parseMoves(sc.scramble);
      lessonRep = { example: true, consumed: false, note: sc.note ?? null };
    } else {
      lessonRep = { example: false, consumed: false, note: null };
    }
  }
  moves ??= makeScramble(base, baseHistory, stepsList, blockEoOrient, lessonDef?.gen);
  return {
    category: t.category,
    trainerId: t.id,
    trainMode: state?.trainMode ?? 'efficiency',
    stepIndex: 0,
    mode: 'scramble',
    solveStartMs: null,
    solveStartLen: 0,
    finishedMs: null,
    cube: base,
    base,
    target: applyMoves(base, moves),
    scrambleMoves: moves,
    scrambleBaseLen: baseHistory.length,
    scrambleReached: 0,
    prefixEncodes: computePrefixEncodes(base, moves),
    pendingLearn: false,
    history: [...baseHistory],
    // History is trustworthy only if it actually reproduces the base from solved
    // (false after a resync that restarts from the cube's true state).
    historyValid: applyMoves(newSolved(), baseHistory).encode() === base.encode(),
    historyResetTo: null,
    stepStartHistory: [...baseHistory],
    stepStartCube: base,
    movesThisStep: [],
    movesThisStepTs: [],
    placementIdx: null,
    placementPinned: false,
    solveReadyMs: null,
    stepDone: stepsList.map(() => false),
    eoAxis: lastEoAxis(),
    eoCommitted: false,
    blockEoOrient,
    courseSeedTag,
    courseSeedPending,
    lessonRep,
    helpUsed: 0,
    brokeProtected: false,
    protectedNow: true,
    identify: null,
    assist: null,
    predict: null,
    predictResult: null,
    learn: null,
    lastResult: state?.lastResult ?? null,
    connected: state?.connected ?? false,
    battery: state?.battery ?? null,
    status: lessonRep?.example && !explicit
      ? `Lesson example — ${lessonRep.note ?? 'watch how the ideal route does it'}. Apply the scramble first.`
      : courseSeedTag && !explicit
      ? `Lesson example — ${courseSeedTag}. Apply the scramble, then find it (or Show ideal → walk it through).`
      : 'Apply the scramble to your cube. The cube view follows along.',
    showSettings: false,
    showStats: state?.showStats ?? false,
    showPicker: state?.showPicker ?? false,
    rightTab: state?.rightTab ?? 'coach',
    log: state?.log ?? [],
    lastError: state?.lastError ?? '',
  };
}

function freshTrainer(trainerId: string): State {
  store.setRaw('last-trainer', trainerId);
  if (state) state.trainerId = trainerId;
  else state = { trainerId } as State;
  return startScramble(newSolved(), []);
}

let state: State;

// --- move handling ---

function step(move: Move3x3) {
  if (!move) return;
  state.cube = applyMove(state.cube, move);
  state.history.push(move);
  state.assist = null;
  if (state.learn) { afterLearnMove(); return; }
  if (state.mode === 'solve') {
    // Free-EO stays axis-agnostic through the solve: detect reads the axis off the
    // finished state; gb/ro already pinned it at scramble time. No per-move axis work.
    state.movesThisStep.push(move);
    state.movesThisStepTs.push(Date.now());
    if (state.solveStartMs == null) state.solveStartMs = Date.now(); // start timer on first move
    state.identify = null; // find-the-piece prompts are pre-solve scaffolding — first turn ends them
  }
  afterChange();
}

function afterLearnMove() {
  const s = currentStep();
  if (!s) return;
  // Completed the guided ideal — the step is solved (no score; it was a walkthrough).
  if (stepSolved(s)) {
    state.learn = null;
    state.stepDone[state.stepIndex] = true;
    state.status = `Nice — you walked through the ideal ${s.label}. Rewind to try it yourself.`;
    if (state.stepIndex < steps().length - 1) {
      state.stepIndex += 1;
      state.stepStartHistory = [...state.history];
      state.stepStartCube = state.cube;
      state.movesThisStep = [];
      state.movesThisStepTs = [];
      state.placementIdx = null;
      state.placementPinned = false;
    }
    return;
  }
  // Still solving: if the cube has wandered off the shown route — a wrong turn, be
  // it the wrong face OR the wrong direction on the right face — re-plan from here
  // so the moves on screen lead home from where the cube actually is.
  const learn = state.learn!;
  if (walkOnRoute(learn.base, learn.moves, state.cube).deviated) rebaseWalkthrough(s);
}

// Where the cube sits on the shown route, and whether it has left it. Walks the
// route's prefix cube-states: the live cube matching prefix k means k tokens are
// done. Matching none is a wrong turn to re-plan from — EXCEPT the benign case of
// being one quarter into a half-turn token (an R done toward an R2), still on the
// way there rather than off it (either quarter direction reaches the double).
function walkOnRoute(base: Cube3x3, moves: Move3x3[], cur: Cube3x3): { done: number; deviated: boolean } {
  const target = cur.encode();
  let c = base;
  if (c.encode() === target) return { done: 0, deviated: false };
  for (let k = 0; k < moves.length; k++) {
    if (moveAmount(moves[k]) === 2) {
      const f = moveFace(moves[k]);
      if (applyMove(c, f as Move3x3).encode() === target || applyMove(c, `${f}'` as Move3x3).encode() === target) {
        return { done: k, deviated: false };
      }
    }
    c = applyMove(c, moves[k]);
    if (c.encode() === target) return { done: k + 1, deviated: false };
  }
  return { done: 0, deviated: true };
}

function afterChange() {
  state.predictResult = null; // the answer-reveal highlight lives until the next turn
  if (state.mode === 'scramble') {
    // Track the furthest on-track scramble position (monotonic across off-track
    // excursions): used for green progress and off-track red, recovery-friendly.
    const cur = state.cube.encode();
    for (let k = 0; k < state.prefixEncodes.length; k++) if (state.prefixEncodes[k] === cur) state.scrambleReached = k;
    if (state.cube.encode() === state.target.encode()) {
      state.mode = 'solve';
      // A setup that ran back through solved (the example unwind) leaves the
      // cube at exactly `solved + seed`, so the long accumulated history can be
      // replaced by that short equivalent. Done BEFORE the step/solve indices
      // below are captured, so every downstream slice stays consistent — and it
      // keeps the next unwind short instead of growing all session.
      if (state.historyResetTo) {
        state.history = [...state.historyResetTo];
        state.historyResetTo = null;
        state.historyValid = true;
      }
      state.stepStartHistory = [...state.history];
      state.stepStartCube = state.cube;
      state.movesThisStep = [];
      state.movesThisStepTs = [];
      state.placementIdx = null;
      state.placementPinned = false;
      state.assist = null;
      state.solveStartMs = null; // timer starts on the first solve move
      state.solveReadyMs = Date.now(); // inspection clock: scramble done → first move
      state.solveStartLen = state.history.length;
      state.finishedMs = null;
      // Free-EO: decide (or prompt for) the side axis now that the scramble is set.
      const cs0 = currentStep();
      if (cs0 && isFreeEo(cs0)) commitEoAxisOnScramble();
      // Graded-course example applied — consume it now (see startScramble).
      if (state.courseSeedPending) {
        state.courseSeedPending = false;
        const tr0 = trainer();
        if (tr0.course) bumpCourseIntro(tr0.id, Math.min(courseCurrent(tr0.id), tr0.course.length - 1));
      }
      if (state.pendingLearn) {
        state.pendingLearn = false;
        if (isFreeEo(cs0)) state.eoCommitted = true; // a learn walkthrough locks the (provisional) axis
        beginLearnWalkthrough();
        return;
      }
      if (!isFreeEo(cs0)) state.status = `Scrambled! ${currentStep()?.label ?? ''} — find your solution.`;
      startLessonSolve(); // Foundations: consume the example / arm phase prompts (overrides status)
    }
  } else {
    const s = currentStep();
    // Placement-aware coaching: re-pick which accepted placement the user is
    // building (hysteresis keeps it stable) BEFORE progress/flash/completion
    // read it — everything downstream this move sees one consistent target.
    if (s && s.kind === 'block' && s.candidateMasks.length > 1 && !state.placementPinned) {
      state.placementIdx = activePlacement(state.cube, s.candidateMasks, state.placementIdx, canonicalIdxFor(s));
    }
    // Flash when a piece is placed / edge oriented (within the same step).
    if (s) {
      const key = `${state.trainerId}:${state.stepIndex}:${state.scrambleBaseLen}`;
      const u = placedUnits(state.cube, s);
      if (key === lastFlashKey && u > lastUnits) flashPieces();
      lastFlashKey = key;
      lastUnits = u;
    }
    if (s) lessonLiveCoach(s); // Foundations: per-move contextual coaching (no-op elsewhere)
    checkStepCompletion();
    if (state.stepDone.every(Boolean) && state.finishedMs == null && state.solveStartMs != null) {
      state.finishedMs = Date.now();
    }
  }
}

// The placement that counts as completing this step, or null if not yet done.
// Accepts ANY configured candidate placement (e.g. any of the 2×2×2 corner
// blocks), not just the canonical one — building a valid block anywhere is
// success. Prefers the canonical placement when it's the solved one, so
// single-candidate steps (EO, drills) behave exactly as before.
function solvedStepMask(s: StepDef) {
  if (isMaskSolvedState(state.cube, s.canonicalMask)) return s.canonicalMask;
  for (const m of s.candidateMasks) {
    if (isMaskSolvedState(state.cube, m)) return m;
  }
  return null;
}

// Detect-mode EO: read which side axis the finished state actually satisfies.
// Returns the solved axis, or null if neither is complete yet. If BOTH are complete
// (rare — you oriented on both at once) it's not an error: prefer the shorter
// optimal, tie -> last-used. The review still shows both axes either way.
function detectSolvedEoAxis(s: StepDef): SolveAxis | null {
  const gbOk = isEoSolvedFromState(state.cube, eoMaskForStep(s, 'gb'));
  const roOk = isEoSolvedFromState(state.cube, eoMaskForStep(s, 'ro'));
  if (gbOk && roOk) {
    const gl = eoAxisOptimalLen(state.stepStartCube, s, 'gb');
    const rl = eoAxisOptimalLen(state.stepStartCube, s, 'ro');
    return rl < gl ? 'ro' : gl < rl ? 'gb' : lastEoAxis();
  }
  return gbOk ? 'gb' : roOk ? 'ro' : null;
}

function stepSolved(s: StepDef): boolean {
  // 2×2×3+EO: colour-identified against the rolled orientation's known target.
  if (isBlockEo(s)) return isBlockEoSolved(state.cube, state.blockEoOrient);
  if (isFreeEo(s)) {
    // Uncommitted (detect mode): solved iff EITHER side axis is complete.
    if (!state.eoCommitted) return detectSolvedEoAxis(s) != null;
    return isEoSolvedFromState(state.cube, eoMaskForStep(s, state.eoAxis));
  }
  return solvedStepMask(s) != null;
}

function checkStepCompletion() {
  const s = currentStep();
  if (!s || state.stepDone[state.stepIndex]) return;
  // Detect mode: the finished state names the axis. Lock it in BEFORE scoring so
  // every downstream calc (optimal length, case label, notation translation for the
  // review) uses the axis you actually solved rather than the provisional one.
  if (isFreeEo(s) && !state.eoCommitted) {
    const a = detectSolvedEoAxis(s);
    if (a == null) return; // neither axis complete yet — keep solving
    state.eoAxis = a;
    state.eoCommitted = true;
    saveLastEoAxis(a);
  }
  if (stepSolved(s)) {
    // Score from the cube state captured at the step's start — no move history
    // needed, so this stays correct even after a BLE resync. Free-EO scores in the
    // model frame against the chosen axis's centres-free orbit mask (the rotation
    // is display-only). Block steps score against the placement actually completed
    // (any valid 2×2×2 etc.), so a non-canonical block is judged against its own
    // optimal rather than the canonical one.
    const solvedMask = solvedStepMask(s) ?? s.canonicalMask;
    const optimalArr = isBlockEo(s)
      ? solveFromState(state.stepStartCube, blockEoTarget(state.blockEoOrient), s.solver)
      : isFreeEo(s)
      ? solveFromState(state.stepStartCube, eoMaskForStep(s, state.eoAxis), s.solver)
      : solveFromState(state.stepStartCube, solvedMask, s.solver);
    const optimal = optimalArr ?? [];
    const used = htmCount(state.movesThisStep);
    const caseLabel = classifyCase(state.stepStartCube, s, optimal, solvedMask);
    state.lastResult = {
      step: s.label,
      used,
      // A (rare) solver failure has no trustworthy optimal — null renders '?'.
      optimal: optimalArr ? optimalArr.length : null,
      yourMoves: [...state.movesThisStep],
      idealMoves: optimal,
      case: optimalArr ? caseLabel : undefined,
    };
    // Free-EO: record both axes' optimal length + bad-edge count so the review can
    // show the axis trade-off ("you solved Blue in 9; Red was 7").
    if (isFreeEo(s)) {
      const start = state.stepStartCube;
      state.lastResult.eo = {
        gb: { len: eoAxisOptimalLen(start, s, 'gb'), bad: axisBad(start, 'gb').count },
        ro: { len: eoAxisOptimalLen(start, s, 'ro'), bad: axisBad(start, 'ro').count },
      };
    }
    // Planning verdict: rank every accepted placement from the step's start and
    // compare against the one actually built. 222/123 candidate optima are
    // ms-cheap at pd4; 223 is skipped until the solver runs off the main thread
    // (each of its 12 placements would build a ~1.6s pruning table).
    if (optimalArr && s.kind === 'block' && s.candidateMasks.length > 1 && (s.family === '222' || s.family === '123')) {
      let bestLen = Infinity;
      let bestIdx = -1;
      for (let i = 0; i < s.candidateMasks.length; i++) {
        const l = solveFromState(state.stepStartCube, s.candidateMasks[i], s.solver)?.length;
        if (l != null && l < bestLen) { bestLen = l; bestIdx = i; }
      }
      if (bestIdx >= 0) {
        state.lastResult.rank = {
          bestName: placementName(s.candidateMasks[bestIdx]),
          bestLen,
          yoursName: placementName(solvedMask),
          yoursLen: optimalArr.length,
          yoursBest: optimalArr.length <= bestLen,
        };
      }
    }
    // Inspection: how long you looked before the first solve move (first step
    // of the solve phase only — later journey steps flow straight on).
    if (state.stepIndex === 0 && state.solveReadyMs != null && state.solveStartMs != null) {
      state.lastResult.insp = Math.max(0, state.solveStartMs - state.solveReadyMs);
    }
    // Named-pattern tags: what the TAUGHT route (the one Learn walks) uses,
    // and what the user's own HTM-simplified solve actually did.
    if (s.kind === 'block' && optimalArr) {
      const taught = humanSolveFromState(state.stepStartCube, solvedMask, s.solver) ?? optimalArr;
      const names = (rt: Move3x3[]) =>
        classifyRoute(state.stepStartCube, rt, solvedMask).map((e) => e.name).filter((x): x is PatternName => x != null);
      state.lastResult.patterns = { ideal: names(taught), yours: names(simplifyMoves(state.movesThisStep)) };
    }
    // Log to the Stats history. Record solve time only for single-step trainers
    // (EO / course / drills) — the journey timer isn't per-step meaningful. On a
    // (rare) solver failure there is no trustworthy optimal, so the solve stays
    // out of Stats and the course window rather than logging a lie.
    lastRecord = { history: false };
    state.stepDone[state.stepIndex] = true;
    state.assist = null;
    state.predict = null; // a completed step makes the rep stale
    state.status = `${s.label} done!`;
    if (optimalArr) {
      const single = steps().length === 1;
      const ms = single && state.solveStartMs != null ? Date.now() - state.solveStartMs : undefined;
      // Inter-move pauses (raw stream, 10ms grain) — the raw material for the
      // hesitation / lookahead analysis; recorded from day one so history accrues.
      const mts = state.movesThisStepTs;
      const gaps = mts.length > 1 ? mts.slice(1).map((t, i) => Math.round((t - mts[i]) / 10) * 10) : undefined;
      recordSolve({ step: stepShort(s), used, optimal: optimalArr.length, ts: Date.now(), ms, gaps, insp: state.lastResult.insp });
      lastRecord.history = true;
      // Course: log this solve toward the current level's consistency target.
      // Seeded lesson examples are demonstrations — they never count toward
      // (or against) the level's clean-rate.
      const tr = trainer();
      if (tr.course && state.courseSeedTag == null) {
        lastRecord.trainerId = tr.id;
        lastRecord.level = courseCurrent(tr.id);
        const note = recordCourse(tr.id, tr.course.length, used - optimalArr.length);
        if (note) state.status = note;
      } else if (tr.course && state.courseSeedTag != null) {
        state.status = `Example done — that was a ${state.courseSeedTag}. Next for more of the lesson.`;
      } else if (lessonsFor(tr.id)) {
        // Foundations: proficiency gates, not the graded-course window.
        recordFoundationsRep(s, solvedMask, optimalArr);
      }
    }
    if (state.stepIndex < steps().length - 1) {
      state.stepIndex += 1;
      state.stepStartHistory = [...state.history];
      state.stepStartCube = state.cube;
      state.movesThisStep = [];
      state.movesThisStepTs = [];
      state.placementIdx = null;
      state.placementPinned = false;
    }
  }
}

function handleMove(move: string) {
  // Connect-seed window: the cube's authoritative state hasn't landed yet.
  // Queue the move and replay it once we've seeded, so it's never applied to a
  // stale (pre-seed) model. Without this, a MOVE that beats the seeding FACELETS
  // makes handleFacelets bridge a phantom inverse move — a permanent model↔cube
  // offset that breaks scramble tracking and solve detection.
  if (awaitingConnectSeed) {
    seedQueue.push(move);
    return;
  }
  step(move as Move3x3);
  // #4: neutral "advance" gesture (see maybeAdvanceGesture). Runs on the live move
  // stream only — seed-queue replays call step() directly and bypass this.
  if (maybeAdvanceGesture(move as Move3x3)) return; // nextScramble() already rendered
  if (maybeRetryGesture(move as Move3x3)) return; // tryAgain() already rendered
  render();
}

// #4: four identical U or D quarter-turns (U U U U, or D' D' D' D', …) net to a full
// rotation — identity on the cube state — so they make a safe gesture that doesn't
// disturb anything. It's armed ONLY in the review state (journey complete, not
// mid-solve, not during a walkthrough): the run resets on any other move and whenever
// we're not in review, so it can never fire while you're actually solving (even four
// U's during a solve are ignored). The turns are applied to the model first (above),
// so by the 4th the cube is back to where it was and model↔cube stay in sync; then we
// advance to the next scramble.
let advanceRunMove = '';
let advanceRunCount = 0;
function maybeAdvanceGesture(move: Move3x3): boolean {
  if (repPhase() !== 'review') { advanceRunMove = ''; advanceRunCount = 0; return false; }
  const isAdvanceTurn = move === 'U' || move === "U'" || move === 'D' || move === "D'";
  if (isAdvanceTurn && move === advanceRunMove) advanceRunCount++;
  else if (isAdvanceTurn) { advanceRunMove = move; advanceRunCount = 1; }
  else { advanceRunMove = ''; advanceRunCount = 0; }
  if (advanceRunCount >= 4) {
    advanceRunMove = '';
    advanceRunCount = 0;
    nextScramble();
    return true;
  }
  return false;
}

// Companion to the advance gesture: four identical quarter-turns of ANY ONE side
// face (F/B/R/L) — also identity on the cube — retries the same case (same as the
// "Try again" button). Same review-only arming and per-move reset, so it can't fire
// mid-solve. With this plus the U/D advance gesture, the EO review loop is hands-off
// bar Discard. The four gesture turns cancel in simplifyMoves, so tryAgain's
// "return to the scramble" sequence stays clean.
let retryRunMove = '';
let retryRunCount = 0;
function maybeRetryGesture(move: Move3x3): boolean {
  if (repPhase() !== 'review') { retryRunMove = ''; retryRunCount = 0; return false; }
  const isRetryTurn =
    move === 'F' || move === "F'" || move === 'B' || move === "B'" ||
    move === 'R' || move === "R'" || move === 'L' || move === "L'";
  if (isRetryTurn && move === retryRunMove) retryRunCount++;
  else if (isRetryTurn) { retryRunMove = move; retryRunCount = 1; }
  else { retryRunMove = ''; retryRunCount = 0; }
  if (retryRunCount >= 4) {
    retryRunMove = '';
    retryRunCount = 0;
    tryAgain();
    return true;
  }
  return false;
}

// Read the cube's true state and reconcile the model to it (manual Sync).
function syncCube() {
  if (!state.connected) { state.status = 'Connect a cube first, then Sync to read its real state.'; render(); return; }
  awaitingSync = true;
  cube.requestFacelets();
  state.status = 'Reading cube state…';
  render();
}

// --- Facelet sync state ---
//
// awaitingConnectSeed — set on connect, cleared by the FIRST FACELETS snapshot.
//   Seeds the model from the cube's true physical state. Any MOVE events during
//   this window are buffered in seedQueue (see handleMove) and replayed on top
//   of the seeded state, so a move can never race ahead of the seed and trigger
//   a phantom bridge. GAN cubes push an unsolicited FACELETS on connect, and the
//   firmware can have a stale snapshot in flight — this window closes that gap.
//
// awaitingSync — set only by an explicit Sync button press, for reconciling
//   drift mid-session (the original manual path).
//
// Periodic FACELETS that arrive while neither flag is set are ignored, so the
// live move stream is never fought during a scramble or solve.
let awaitingConnectSeed = false;
let seedQueue: string[] = [];
let awaitingSync = false;

function handleFacelets(kociemba: string) {
  let trueCube: Cube3x3;
  try {
    trueCube = cubeFromFacelets(kociembaToNet(kociemba));
  } catch {
    awaitingConnectSeed = false;
    awaitingSync = false;
    seedQueue = [];
    return;
  }

  // --- Connect-time seed (authoritative; takes priority over manual sync) ---
  if (awaitingConnectSeed) {
    awaitingConnectSeed = false;
    const queued = seedQueue.splice(0);
    // GAN cubes can't sense absolute state: on connect they push a snapshot that
    // is often STALE (a physically solved cube can report as scrambled). So only
    // trust a connect snapshot that decodes to solved, or to exactly the current
    // scramble's base. Otherwise assume the normal case — a freshly-solved cube —
    // and keep the model as-is. Press Sync if you really connected mid-scramble.
    if (trueCube.encode() === state.base.encode()) {
      state.cube = trueCube;
      state.status = 'Cube connected — apply the scramble to begin.';
    } else if (trueCube.encode() === newSolved().encode()) {
      state = startScramble(trueCube, []);
      state.status = 'Cube connected — apply the scramble to begin.';
    } else {
      state.status = 'Connected — assuming a solved cube. If yours is scrambled, press Sync.';
    }
    state.connected = true;
    // Replay any moves the cube reported during the seed window, in order.
    for (const m of queued) step(m as Move3x3);
    render();
    return;
  }

  // --- Manual Sync button ---
  if (!awaitingSync) return;
  awaitingSync = false;
  if (trueCube.encode() === state.cube.encode()) { state.status = 'Already in sync with your cube.'; render(); return; }
  // Small drift (a few missed moves): bridge them so the move history stays valid
  // and you keep your place in the current scramble/solve.
  const bridge = findBridge(state.cube, trueCube, 6);
  if (bridge) {
    state.cube = trueCube;
    state.history.push(...bridge);
    if (state.mode === 'solve') {
      state.movesThisStep.push(...bridge);
      const now = Date.now();
      state.movesThisStepTs.push(...bridge.map(() => now));
    }
    afterChange();
    render();
    return;
  }
  // Large divergence: clean restart with the cube's TRUE state as the base.
  state = startScramble(trueCube, []);
  state.status = 'Synced to your cube — fresh scramble from its current state.';
  render();
}
function handleManualMoves(text: string) {
  // In the solve frame the user types what they see (held frame); translate to
  // model. Gated on notationFrame() (solve-only), NOT solveFrame() — during
  // scramble the cube view may already be rotated (block-preserving EO), but
  // the scramble text itself is always raw model notation.
  const toks = notationFrame() ? toModelMoves(parseMoves(text), solveRotation()) : parseMoves(text);
  for (const tok of toks) step(tok);
  render();
}

// --- actions ---

const cube = new CubeManager({
  onMove: (m) => handleMove(m),
  onFacelets: (f) => handleFacelets(f),
  onBattery: (b) => { state.battery = b; render(); },
  onConnect: (name) => { state.connected = true; state.lastError = ''; state.status = `Connected to ${name} — reading cube state…`; awaitingConnectSeed = true; seedQueue = []; cube.requestFacelets(); render(); },
  onDisconnect: () => { state.connected = false; state.status = 'Cube disconnected.'; render(); },
  onError: (e) => { state.lastError = String((e as Error)?.message ?? e); state.status = `Bluetooth error: ${state.lastError}`; render(); },
  // Trace of raw cube events (for diagnosing BLE quirks; shown in Settings).
  onLog: (line) => { const t = new Date().toLocaleTimeString(); state.log = [...(state.log ?? []), `${t}  ${line}`].slice(-60); },
});

// Count moves in HTM (half-turn metric): merge consecutive same-face turns, so a
// physical D2 (two quarter-turn events from the cube) counts as 1, matching the
// solver's optimal length.
function moveFace(m: Move3x3): string {
  return m[0];
}
function moveAmount(m: Move3x3): number {
  return m.includes('2') ? 2 : m.includes("'") ? 3 : 1;
}
function htmCount(moves: Move3x3[]): number {
  return simplifyMoves(moves).length;
}

// Collapse consecutive same-face quarter-turns into HTM tokens (D D -> D2, R R' -> nothing).
function simplifyMoves(moves: Move3x3[]): Move3x3[] {
  const out: Move3x3[] = [];
  let i = 0;
  while (i < moves.length) {
    const f = moveFace(moves[i]);
    let net = 0;
    while (i < moves.length && moveFace(moves[i]) === f) {
      net = (net + moveAmount(moves[i])) % 4;
      i++;
    }
    if (net === 1) out.push(f as Move3x3);
    else if (net === 2) out.push(`${f}2` as Move3x3);
    else if (net === 3) out.push(`${f}'` as Move3x3);
  }
  return out;
}

async function toggleConnect() {
  if (state.connected) { await cube.disconnect(); return; }
  if (!CubeManager.isSupported()) { state.status = 'Web Bluetooth not available. On iPad use the Bluefy browser.'; render(); return; }
  state.status = 'Connecting…';
  render();
  try { await cube.connect(); } catch (e) { state.status = `Connection failed: ${String((e as Error)?.message ?? e)}`; render(); }
}

// Selecting a trainer resets the session to its first scramble.
function togglePicker() {
  state.showPicker = !state.showPicker;
  render();
}
function selectTrainerFlat(id: string) {
  state = freshTrainer(id);
  state.showPicker = false; // a specific trainer is the terminal choice — collapse
  render();
}
// Switching category jumps to the first trainer in that category (picker stays
// open so you can then drill into the specific trainer).
function selectCategory(c: Category) {
  const first = trainersIn(c)[0];
  if (first) freshTrainerInPlace(first.id);
}
function freshTrainerInPlace(id: string) {
  state = freshTrainer(id);
  render();
}
// Hints/rewind/efficiency all need a trustworthy move history (moves from solved).
// Coaching, scoring, Learn and Rewind all work from the live cube state now, so
// a lost-history resync no longer blocks them. Kept as a stable hook.
function requireHistory(): boolean {
  return true;
}

function nextScramble() {
  // Continuous: new scramble from the current cube. If history is untrustworthy
  // (post resync), start fresh from the current cube as the base (history = [])
  // so the scramble + picture stay consistent — startScramble recomputes
  // historyValid (hints stay gated until a clean from-solved run).
  state = startScramble(state.cube, state.historyValid ? state.history : []);
  render();
}
function resetToSolved() {
  state = freshTrainer(state.trainerId);
  state.status = 'Cube reset to solved — apply the scramble to begin.';
  render();
}

// Learn (mid-solve): walk the ideal for the current step. The physical cube is
// wherever the solver left it, so we must NOT fabricate the software model back to
// step start — that desyncs the model from the cube (the next physical move lands
// on a position the cube isn't in). Instead hand back the moves that physically
// return the cube to this step's start, then arm pendingLearn so the walkthrough
// begins only once the cube has actually returned. Mirrors learnFromReview, but
// returns to *step* start (not the full scramble) and preserves stepIndex so
// multi-step trainers stay on the current step.
function enterLearn() {
  if (!requireHistory()) return;
  const s = currentStep();
  if (!s) return;
  const ideal = idealRoute(state.stepStartCube, s);
  if (ideal.length === 0) { state.status = 'Nothing to learn from here.'; render(); return; }
  state.helpUsed = 3; // a walkthrough is the full route — the rep can't count as solo
  // Abandon any lookahead rep in flight. Reachable: Show ideal is enabled during
  // one, and that reveals "Walk it through". A walkthrough needs a VISIBLE cube,
  // and a lookahead rep blanks it — so the two are mutually exclusive by intent,
  // and saying so here keeps repPhase's precedence a fact about the state rather
  // than a silent override of it.
  state.predict = null;
  const back = simplifyMoves(invertSeq(state.movesThisStep));
  // Already at step start (nothing done this step yet) — go straight in.
  if (back.length === 0) { beginLearnWalkthrough(); return; }
  // Drop into a return-to-step-start phase, reusing the scramble-tracking machinery
  // (target = the step-start state). pendingLearn fires beginLearnWalkthrough when
  // the cube physically lands back on the step start.
  state.mode = 'scramble';
  state.base = state.cube;
  state.target = state.stepStartCube.clone();
  state.scrambleMoves = back;
  state.scrambleBaseLen = state.history.length;
  state.scrambleReached = 0;
  state.prefixEncodes = computePrefixEncodes(state.cube, back);
  state.assist = null;
  state.learn = null;
  state.pendingLearn = true;
  state.status = `Apply the ${back.length} move${back.length === 1 ? '' : 's'} above to return to the start of ${s.label}, then follow the ideal.`;
  render();
}

// Build the walkthrough state for a route from `base` to the current step target:
// the ideal moves plus, for block steps, the taught segment/role annotations (the
// classifier's segments — which technique each group performs — and each single
// move's job). Shared by the initial walkthrough and every re-plan; null when the
// solver finds nothing from `base`. baseLen anchors progress to the moves made
// after this point, so a re-plan measures from the cube's current position.
function makeLearnState(base: Cube3x3, s: StepDef, rebased: boolean): NonNullable<State['learn']> | null {
  const ideal = idealRoute(base, s);
  if (ideal.length === 0) return null;
  let seg: NonNullable<State['learn']>['seg'];
  let roles: MoveRole[] | undefined;
  if (s.kind === 'block') {
    const mask = activeMask(s);
    seg = classifyRoute(base, ideal, mask).map((e) => ({ name: e.name, from: e.from, to: e.to }));
    roles = routeRoles(base, ideal, mask);
  }
  return { moves: ideal, base, baseLen: state.history.length, seg, roles, rebased };
}

// Start the guided ideal replay. Assumes the cube has physically returned to the
// start of the current step (stepStartCube); never fabricates the model. Reached
// either directly (no moves done this step) or via the pendingLearn return phase.
function beginLearnWalkthrough() {
  const s = currentStep();
  if (!s) return;
  const learn = makeLearnState(state.stepStartCube, s, false);
  if (!learn) { state.status = 'Nothing to learn from here.'; render(); return; }
  state.movesThisStep = [];
  state.movesThisStepTs = [];
  state.stepDone[state.stepIndex] = false;
  state.assist = null;
  state.learn = learn;
  // Show the method route alongside the theoretical optimal so the efficiency
  // gap is visible without teaching the awkward (back/bottom-heavy) optimal.
  const opt = idealLen(state.stepStartCube, s);
  const gap = opt != null && learn.moves.length > opt ? ` (method route; theoretical best ${opt})` : '';
  state.status = `Learn by example: follow the ${learn.moves.length} highlighted moves for ${s.label}${gap}.`;
  render();
}

// You turned off the shown route — recompute it from where the cube is now, so the
// walkthrough always has a way home. The old fixed list pointed at a state you'd
// already left (turn wrong, and every remaining move is nonsense) — that's the
// "I've no idea how to fix it" trap. Same pane; only the moves and their
// annotations change, and `rebased` lets the pane say what happened.
function rebaseWalkthrough(s: StepDef) {
  const learn = makeLearnState(state.cube, s, true);
  if (!learn) return; // solver found nothing from here — keep the old route, don't blank it
  state.learn = learn;
  state.status = 'Off the route — here is the way home from where the cube is now.';
}

function stopLearn() {
  state.learn = null;
  state.status = 'Stopped the walkthrough. Rewind to try the case yourself.';
  render();
}

function setMode(m: TrainMode) {
  state.trainMode = m;
  render();
}

function invertSeq(moves: Move3x3[]): Move3x3[] {
  return [...moves].reverse().map((m) => (m.endsWith('2') ? m : m.endsWith("'") ? (m[0] as Move3x3) : (`${m}'` as Move3x3)));
}

// The sequence to bring the cube from its current (post-solve) state back to the
// same post-scramble state: undo the solve-phase moves.
function undoToScramble(): Move3x3[] {
  return simplifyMoves(invertSeq(state.history.slice(state.solveStartLen)));
}

// Retry the same case: give the user the moves to return to the scrambled state.
function tryAgain() {
  if (!requireHistory()) return;
  state = startScramble(state.cube, state.history, undoToScramble());
  state.status = 'Apply the sequence above to return to the scramble, then solve it again.';
  render();
}

// Re-solve the SAME scramble on the other side axis (free-EO only): rewind to the
// scrambled state (reusing the retry machinery), then pin the opposite axis.
function tryOtherAxis() {
  if (!requireHistory()) return;
  const other = OTHER_AXIS[state.eoAxis];
  state = startScramble(state.cube, state.history, undoToScramble());
  state.eoAxis = other;
  state.eoCommitted = true;
  saveLastEoAxis(other);
  state.status = `Apply the sequence above to return to the scramble, then solve EO on the ${AXIS_LABEL[other]} axis.`;
  render();
}

// Learn the ideal on this case: return to the scramble first, then walk the ideal.
function learnFromReview() {
  if (!requireHistory()) return;
  state = startScramble(state.cube, state.history, undoToScramble());
  state.pendingLearn = true;
  state.status = 'Apply the sequence above to return to the scramble, then follow the ideal.';
  render();
}

function fmtTime(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}

// Brief green edge-flash when a block piece is placed / an edge is oriented.
function flashPieces() {
  const f = document.createElement('div');
  f.className = 'piece-flash';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 600);
}
// Count of placed block pieces (+ oriented edges for EO) — drives the flash.
function placedUnits(cube: Cube3x3, s: StepDef): number {
  const f = faceletString(cube);
  const mask = activeMask(s);
  const placed = blockPiecesFor(mask).filter((g) => g.every((i) => f[i] === SOLVED_STR[i])).length;
  const oriented = mask.eoFaceletIndices ? orientedEdges(cube, s) : 0;
  return placed + oriented;
}
let lastUnits = 0;
let lastFlashKey = '';

// --- solving orientation (phase-flip) + free-EO side-axis choice ---
let orientEnabled = store.getBool('orient', false);
function setOrient(b: boolean) {
  orientEnabled = b;
  store.setBool('orient', b);
  render();
}

// Cube view: the spinnable 3D orbit cube (default) vs the flat 54-sticker net.
// Applies to every trainer category. Persisted like the other display prefs.
type CubeView = '3d' | 'net';
const CUBE_VIEWS: readonly CubeView[] = ['3d', 'net'];
let cubeView: CubeView = store.getEnum<CubeView>('cube-view', CUBE_VIEWS, '3d');
function setCubeView(v: CubeView) {
  cubeView = v;
  store.setEnum('cube-view', v);
  render();
}

// Free-EO axis policy. 'detect' (default) commits NO axis up front and reads which
// one you solved off the finished state — you're free to solve either side. 'gb'/'ro'
// pin the blue/green or red/orange side axis up front, for deliberately drilling one
// side. The last axis used is remembered as detect's provisional mid-solve display.
type EoAxisMode = 'detect' | 'gb' | 'ro';
const EO_AXIS_MODES: readonly EoAxisMode[] = ['detect', 'gb', 'ro'];
const EO_AXES: readonly SolveAxis[] = ['gb', 'ro'];
let eoAxisMode: EoAxisMode = store.getEnum<EoAxisMode>('eo-axis-mode', EO_AXIS_MODES, 'detect');
function setEoAxisMode(m: EoAxisMode) {
  eoAxisMode = m;
  store.setEnum('eo-axis-mode', m);
  render();
}

// Unified 2×2×3 + EO drill: keep a finished 2×2×3 while orienting all edges. Detection
// is against a per-scramble rolled orientation (a random long-side colour); the Method
// setting only picks the display viewpoint (Petrus block-back / APB block-left).
function isBlockEo(s: StepDef | null): boolean {
  return s?.id === 'eo223';
}
const BLOCK_EO_METHODS: readonly BlockEoMethod[] = ['petrus', 'apb'];
let blockEoMethod: BlockEoMethod = store.getEnum<BlockEoMethod>('block-eo-method', BLOCK_EO_METHODS, 'petrus');
function setBlockEoMethod(m: BlockEoMethod) {
  blockEoMethod = m;
  store.setEnum('block-eo-method', m);
  render();
}
function lastEoAxis(): SolveAxis {
  return store.getEnum<SolveAxis>('eo-last-axis', EO_AXES, 'gb');
}
function saveLastEoAxis(a: SolveAxis) {
  store.setEnum('eo-last-axis', a);
}

function eoRot(): RotationMove[] {
  return AXIS_ROTATION[state.eoAxis];
}
/** The side axis an axis-aware EO step is measured against — the chosen axis for
 * free-EO, the rolled orientation's axis for the 2×2×3+EO drill — or null for the
 * fixed F/B-axis steps (which read cube.EO / eoHint directly). */
function eoStepAxis(s: StepDef | null): SolveAxis | null {
  if (isBlockEo(s)) return blockEoAxis(state.blockEoOrient);
  if (isFreeEo(s)) return state.eoAxis;
  return null;
}
function orientedEdges(cube: Cube3x3, s: StepDef): number {
  const ax = eoStepAxis(s);
  return ax ? 12 - axisBad(cube, ax).count : cube.EO.filter(Boolean).length;
}
/** Teaching route for the current step, in MODEL frame so the shared disp()/
 * walkthrough pipeline can render it in the held frame. Free-EO solves the chosen
 * axis's orbit directly in the model frame (no state rotation, no translation). */
function idealRoute(start: Cube3x3, s: StepDef): Move3x3[] {
  if (isBlockEo(s)) return humanSolveFromState(start, blockEoTarget(state.blockEoOrient), s.solver) ?? [];
  if (isFreeEo(s)) return humanSolveFromState(start, eoMaskForStep(s, state.eoAxis), s.solver) ?? [];
  return humanSolveFromState(start, activeMask(s), s.solver) ?? [];
}
// idealFromStart runs on every render and a deep 2×2×3 search costs ~130ms even
// at pd5, so the block-step result is memoized by (step, placement, start state)
// — one slot suffices, the key only changes on a new step or a placement switch.
// null = the solver found nothing (rare budget exhaustion); renders as '?'.
let idealMemo: { key: string; len: number | null } | null = null;
function idealLen(start: Cube3x3, s: StepDef): number | null {
  if (isBlockEo(s)) return solveFromState(start, blockEoTarget(state.blockEoOrient), s.solver)?.length ?? 0;
  if (isFreeEo(s)) return eoAxisOptimalLen(start, s, state.eoAxis);
  const mask = activeMask(s);
  const key = `${s.id}:${state.placementIdx ?? -1}:${start.encode()}`;
  if (idealMemo?.key !== key) {
    idealMemo = { key, len: solveFromState(start, mask, s.solver)?.length ?? null };
  }
  return idealMemo.len;
}

/** Commit (or provisionally set) the EO axis when a free-EO scramble completes. */
function commitEoAxisOnScramble() {
  if (eoAxisMode === 'detect') {
    // Defer the axis entirely: solve EO on whichever side you like and the finished
    // state tells us which (see detectSolvedEoAxis / checkStepCompletion). No prompt,
    // no pre-pick. eoAxis here is only a provisional for any mid-solve display — the
    // on-screen orientation may not match your hands, which is fine (you're on the cube).
    state.eoAxis = lastEoAxis();
    state.eoCommitted = false;
    state.status = 'Solve EO — Red front or Blue front, your call. I’ll read which off the cube.';
    return;
  }
  if (eoAxisMode === 'gb' || eoAxisMode === 'ro') {
    state.eoAxis = eoAxisMode;
    state.eoCommitted = true;
    saveLastEoAxis(eoAxisMode);
    state.status = `Solve EO — ${AXIS_LABEL[eoAxisMode]}.`;
  }
}

/** The rotation list (model -> held frame) for the current solve display.
 * Block-preserving EO (eo223, eo123) hold their frame in BOTH scramble AND
 * solve — the pre-built block should look the same throughout (previously
 * gated to solve-only, so the picture flipped the instant you finished
 * scrambling; the pre-built block looked "wrong" — top-right-ish, white-top —
 * right up until that point). Free-EO and the legacy blocks-category toggle
 * keep the deliberate phase-flip: scramble stays canonical, only the solve
 * phase honours the chosen hold. */
function solveRotation(): RotationMove[] {
  const s = currentStep();
  if (isBlockEo(s)) return blockEoDisplayRots(blockEoMethod, state.blockEoOrient);
  if (s?.id === 'eo123') return ['x2'] as RotationMove[];
  if (state.mode === 'solve' && isFreeEo(s)) return eoRot();
  return orientEnabled ? (['x2'] as RotationMove[]) : [];
}
/** True when the CUBE VIEW should render rotated (picture + tap translation).
 * Block-preserving EO (eo223, eo123) hold this in BOTH scramble and solve —
 * see solveRotation() above. Everything else only in solve.
 *
 * These three read `state.mode` rather than repPhase() ON PURPOSE: they answer
 * "which frame is the cube being displayed in", which is a property of the whole
 * post-scramble half of a rep — it must NOT change under you when a walkthrough
 * starts or the review appears, or the picture would flip mid-rep. `isSolvingPhase`
 * excludes exactly those two, so it is the wrong test here. */
function solveFrame(): boolean {
  const s = currentStep();
  if (isBlockEo(s) || s?.id === 'eo123') return true; // always-on hold, any mode
  return state.mode === 'solve' && solveRotation().length > 0;
}
/** True only during the SOLVE phase's held frame — gates NOTATION translation
 * (typed/manual moves, hint/solution display text). The scramble's own
 * move-list must NEVER be translated — it's always shown/typed in raw model
 * notation (what the physical cube reports), regardless of whether the CUBE
 * VIEW (solveFrame(), above) is already showing the held-frame picture. */
function notationFrame(): boolean {
  return state.mode === 'solve' && solveRotation().length > 0;
}
function disp(moves: Move3x3[]): Move3x3[] {
  return notationFrame() ? toDisplayMoves(moves, solveRotation()) : moves;
}

function continuation(): Move3x3[] {
  const s = currentStep();
  if (!s) return [];
  // Teach the method route (human-ranked / build-then-extend); scoring still
  // uses the true optimal via idealFromStart().
  return idealRoute(state.cube, s);
}
function idealFromStart(): number | null {
  const s = currentStep();
  if (!s) return null;
  return idealLen(state.stepStartCube, s);
}

// --- lookahead drill (eyes-closed predict-z) ---
// Plan the next join while predicting where the piece AFTER it ends up: the
// view blanks, you execute on the real cube, then tap the spot you believe z
// reached. The tracked state is the referee — no honour system needed.
function startPredict() {
  const s = currentStep();
  // Only from plain solving: starting a lookahead rep on top of a walkthrough or
  // another prompt would give two phases a claim on the same sticker taps.
  if (!s || s.kind !== 'block' || repPhase() !== 'solve') return;
  const route = continuation();
  const two = route.length ? nextTwoFocusPieces(state.cube, activeMask(s), route) : null;
  if (!two) { state.status = 'Nothing to look ahead to — fewer than two pieces left.'; render(); return; }
  state.assist = null;
  state.predict = { z: two.second, joinDesc: two.first.description };
  // The standing instruction is the Now bar's now; the toast just confirms the mode
  // started, rather than flashing the same paragraph and then taking it away.
  state.status = 'Lookahead on — the view is blanked.';
  render();
}
function cancelPredict() {
  state.predict = null;
  state.status = 'Lookahead cancelled.';
  render();
}
function answerPredict(viewIdx: number) {
  const p = state.predict;
  if (!p) return;
  const modelIdx = solveFrame() ? [...rotateHighlight(new Set([viewIdx]), solveRotation())][0] : viewIdx;
  const tapped = CUBIES.find((g) => g.includes(modelIdx));
  if (!tapped) return;
  const actual = locatePieceNow(state.cube, p.z.home);
  // Slot identity by coordinate — tapped groups and locate() results come from
  // different arrays, so reference equality would never hold.
  const ok = NET_COORDS[tapped[0]].join(',') === NET_COORDS[actual[0]].join(',');
  const la = recordLookahead(ok);
  const rate = la.recent.length ? Math.round((100 * la.recent.filter(Boolean).length) / la.recent.length) : 0;
  state.predict = null;
  state.predictResult = { stickers: actual, note: 'highlighted: where it actually is' };
  state.status = ok
    ? `✓ Right — the ${p.z.description} is at the ${slotName(actual)}. (${rate}% over last ${la.recent.length})`
    : `✗ The ${p.z.description} is at the ${slotName(actual)}, not the ${slotName(tapped)}. (${rate}% over last ${la.recent.length})`;
  render();
}

function assist(kind: 'nudge' | 'move' | 'ideal') {
  const s = currentStep();
  if (!s) return;
  // EO nudge: point at the misoriented edges (no move revealed).
  if (kind === 'nudge' && s.kind === 'eo') {
    const ax = eoStepAxis(s);
    const bad = ax ? axisBad(state.cube, ax).count : state.cube.EO.filter((g) => !g).length;
    state.assist = { kind: 'nudge', moves: [], focus: null, pattern: null };
    state.status = `${bad} bad edges highlighted — work out how to orient them.`;
    render();
    return;
  }
  const moves = continuation();
  if (moves.length === 0) { state.assist = null; state.status = 'Nothing to suggest from here.'; render(); return; }
  const focus = kind !== 'ideal' && s.kind === 'block' ? nextFocusPiece(state.cube, activeMask(s), moves) : null;
  // Name the pattern the taught route is about to use (its first segment) — the
  // Lars Petrus vocabulary the coaching teaches.
  const pattern = s.kind === 'block'
    ? classifyRoute(state.cube, moves, activeMask(s)).find((e) => e.name)?.name ?? null
    : null;
  const effective = kind === 'nudge' && !focus ? 'move' : kind;
  state.assist = { kind: effective, moves, focus, pattern };
  state.helpUsed = Math.max(state.helpUsed, effective === 'nudge' ? 1 : effective === 'move' ? 2 : 3);
  state.status =
    effective === 'nudge' ? `Hint: focus on the ${focus?.description ?? 'highlighted piece'} — pair and insert it.`
    : effective === 'move' ? `Next move: ${moves[0]}`
    : 'Showing the ideal for this step — press “Walk it through” to try it guided.';
  render();
}

// --- Foundations coaching (the beginner course; lessons in src/lessons.ts) ---

// Solve-start bookkeeping: consume the observe example the moment its scramble
// is APPLIED (retries carry consumed=true, so nothing double-burns), reveal the
// route for examples, and arm the phase's opening prompt.
function startLessonSolve() {
  const def = activeLessonDef();
  const s = currentStep();
  if (!def || !s) return;
  if (state.lessonRep?.example) {
    if (!state.lessonRep.consumed) {
      state.lessonRep.consumed = true;
      bumpLessonObserved(state.trainerId, def.id);
    }
    // Watching IS the lesson at this phase — show the route straight away.
    assist('ideal');
    state.status = `${state.lessonRep.note ?? 'Watch the ideal route.'} Press “Walk it through” to do it on your cube.`;
    return;
  }
  const phase = lessonPhaseNow();
  if (phase === 'guided' || phase === 'observe') {
    if (def.identify) {
      const corner = blockPiecesFor(s.canonicalMask).find((g) => g.length === 3);
      if (corner) {
        state.identify = { stage: 0 };
        // The prompt itself stands in the Now bar; no need to also flash it as a
        // toast that expires while the learner is still hunting for the piece.
        state.status = 'Find the piece on your cube, then tap it.';
        return;
      }
    }
    state.status = `Guided: ${def.outcome}`;
  } else if (phase === 'coached') {
    const f = nextFocusPiece(state.cube, activeMask(s), continuation());
    state.status = f ? `Coached: look for the ${f.description} first.` : `Coached: ${def.outcome}`;
  }
  // independent / done: the generic "Scrambled!" status stands.
}

// Serve the next curated example ON DEMAND, from wherever the cube is.
//
// Seeds are from-SOLVED scrambles, so they can only be applied to a solved
// cube. Left to the automatic path that means a learner sees roughly one
// example per lesson: after the first practice rep the cube is no longer
// solved, and once the guided gate is met the observe phase never returns.
// A Foundations beginner usually cannot solve the cube back by hand, so the
// examples would simply become unreachable — the opposite of inviting.
//
// The fix uses the app's own idiom (never teleport the model; hand back moves
// the learner physically applies): ONE tracked setup = undo the history back
// to solved, then the seed's scramble. The scramble panel guides it move by
// move, self-healing, exactly like any other scramble.
function examplesLeft(): number {
  const def = activeLessonDef();
  if (!def) return 0;
  return Math.max(0, lessonSeedsFor(def.id).length - lessonProgFor(state.trainerId, def.id).observed);
}
// Longest setup worth handing a beginner; beyond it, ask for a reset instead.
const MAX_EXAMPLE_SETUP = 40;
function watchExample() {
  const def = activeLessonDef();
  if (!def) return;
  const seeds = lessonSeedsFor(def.id);
  const prog = lessonProgFor(state.trainerId, def.id);
  const sc = seeds[prog.observed];
  if (!sc) { state.status = 'You have seen every example for this lesson.'; render(); return; }
  const seedMoves = parseMoves(sc.scramble);
  const solvedNow = faceletString(state.cube) === SOLVED_STR;
  if (!solvedNow && !state.historyValid) {
    state.status = 'I have lost track of your cube. Solve it, then press “Reset Cube” to see the next example.';
    render();
    return;
  }
  // Undo everything back to solved, then apply the seed — as one sequence.
  const setup = solvedNow ? seedMoves : simplifyMoves([...invertSeq(state.history), ...seedMoves]);
  if (setup.length > MAX_EXAMPLE_SETUP) {
    state.status = 'That would be a long way back. Solve your cube, then press “Reset Cube” for the next example.';
    render();
    return;
  }
  state = startScramble(state.cube, state.history, setup);
  state.lessonRep = { example: true, consumed: false, note: sc.note ?? null };
  // The setup ends at `solved + seed` either way, so once applied the history
  // is exactly the seed — see afterChange.
  state.historyResetTo = seedMoves;
  state.status = solvedNow
    ? `Example — ${sc.note ?? 'watch the ideal route'}. Apply the scramble first.`
    : `Apply the ${setup.length} moves above: they return your cube to solved and set up the example.`;
  render();
}

// Per-move contextual coaching. CHEAP GEOMETRY ONLY — piece diffs, the
// pair-joined test and prereq intactness; never a solver call (a 2×2×3 solve
// costs ~130ms and this runs on every turn). Intactness is TRACKED in every
// phase (the review reports it) but narrated only while being taught.
let lcKey = '';
let lcPlacedKeys: string[] = [];
let lcPairJoined = false;
function lessonLiveCoach(s: StepDef) {
  const def = activeLessonDef();
  if (!def || state.learn || state.stepDone[state.stepIndex]) return;
  let protectedMsg: string | null = null;
  if (s.prereqMask) {
    const sc = scorePlacement(state.cube, s.prereqMask);
    const ok = sc.placed === sc.total;
    if (!ok && state.protectedNow) {
      state.brokeProtected = true;
      protectedMsg = 'Careful — the built block broke. Rebuild it before adding more.';
    } else if (ok && !state.protectedNow) {
      protectedMsg = 'Good recovery — the block is back together.';
    }
    state.protectedNow = ok;
  }
  const mask = activeMask(s);
  const pieces = blockPiecesFor(mask);
  const f = faceletString(state.cube);
  const placedNow = pieces.filter((g) => g.every((i) => f[i] === SOLVED_STR[i]));
  const placedKeys = placedNow.map((g) => NET_COORDS[g[0]].join(','));
  const corner = pieces.find((g) => g.length === 3) ?? null;
  const edges = pieces.filter((g) => g.length === 2);
  const joined = corner != null && edges.some((e) => isPairJoined(state.cube.stateData, corner, e));
  const key = `${state.trainerId}:${state.stepIndex}:${state.scrambleBaseLen}`;
  const sameRep = key === lcKey;
  const prevPlaced = lcPlacedKeys;
  const prevJoined = lcPairJoined;
  lcKey = key;
  lcPlacedKeys = placedKeys;
  lcPairJoined = joined;
  const phase = lessonPhaseNow();
  const talkative = !state.lessonRep?.example && (phase === 'guided' || phase === 'observe' || phase === 'coached');
  if (!talkative) return;
  // The protect warning is NOT gated on the rep baseline — protectedNow starts
  // true (the prereq arrives built), so a break on the very first move must
  // still speak. Only the placed/joined narration needs a prior-move baseline.
  if (protectedMsg) { state.status = protectedMsg; return; }
  if (!sameRep || phase === 'coached') return; // coached gets its opening line only
  const newly = placedNow.find((g) => !prevPlaced.includes(NET_COORDS[g[0]].join(',')));
  const cornerPlaced = corner != null && placedNow.includes(corner);
  if (newly) {
    const left = pieces.length - placedNow.length;
    if (left > 0) state.status = `Placed the ${pieceDescription(newly)} — ${left} piece${left === 1 ? '' : 's'} to go.`;
  } else if (joined && !prevJoined && !cornerPlaced) {
    state.status = 'Pair made — keep it together and take it home.';
  } else if (!joined && prevJoined && !cornerPlaced) {
    state.status = 'The pair split — bring the corner back to its edge.';
  }
}

// The standing find-the-piece instruction for an active identify task, derived
// from its stage rather than stored — so it survives every re-render and lives in
// the console, where state.status (a passing toast) can't. Null when no find is
// running. The toast still flashes the tap-by-tap reaction (see answerIdentify).
function identifyPrompt(s: StepDef): string | null {
  if (!state.identify) return null;
  const corner = blockPiecesFor(s.canonicalMask).find((g) => g.length === 3);
  if (!corner) return null;
  return state.identify.stage === 0
    ? `Find the ${pieceDescription(corner)} — the piece with exactly those three colours — then tap any of its stickers.`
    : `Good — that's the ${pieceDescription(corner)}. Now tap an edge that shares two of its colours.`;
}

// L1 tap-identification: find the corner, then any matching edge. The tap
// answer is checked against the tracked state (locatePieceNow) exactly like
// the lookahead drill; a correct find rings the piece via predictResult.
function answerIdentify(viewIdx: number) {
  const iq = state.identify;
  const s = currentStep();
  if (!iq || !s) return;
  const modelIdx = solveFrame() ? [...rotateHighlight(new Set([viewIdx]), solveRotation())][0] : viewIdx;
  const tapped = CUBIES.find((g) => g.includes(modelIdx));
  if (!tapped) return;
  const corner = blockPiecesFor(s.canonicalMask).find((g) => g.length === 3);
  if (!corner) { state.identify = null; return; }
  const tappedKey = NET_COORDS[tapped[0]].join(',');
  if (iq.stage === 0) {
    const at = locatePieceNow(state.cube, corner);
    if (NET_COORDS[at[0]].join(',') === tappedKey) {
      state.identify = { stage: 1 };
      state.predictResult = { stickers: at, note: 'highlighted: the corner you found' };
      state.status = `That's it — the ${pieceDescription(corner)}. Now tap an edge that shares two of its colours.`;
    } else {
      state.status = `Not that one — look for the ${pieceDescription(corner)}: three stickers, exactly those colours.`;
    }
  } else {
    // Any of the step's accepted pair edges counts as a find.
    const edgeHomes: number[][] = [];
    for (const m of s.candidateMasks) {
      for (const g of blockPiecesFor(m)) if (g.length === 2 && !edgeHomes.some((h) => h[0] === g[0])) edgeHomes.push(g);
    }
    const hit = edgeHomes.find((h) => NET_COORDS[locatePieceNow(state.cube, h)[0]].join(',') === tappedKey);
    if (hit) {
      state.identify = null;
      state.predictResult = { stickers: locatePieceNow(state.cube, hit), note: 'highlighted: the edge you found' };
      state.status = `That's the ${pieceDescription(hit)} — corner and edge make your pair. Join them, then take them home.`;
    } else {
      state.status = 'Not quite — you want an edge showing two of the corner’s colours.';
    }
  }
  render();
}

// Completion recording: proficiency gates, never efficiency. Success = the
// target completed without the full route being revealed (helpUsed < 3);
// Hint and Next move are allowed in every phase. Phase/lesson transitions
// speak here; the lesson summary rides on lastResult for the beginner review.
function recordFoundationsRep(s: StepDef, solvedMask: StepDef['canonicalMask'], optimalArr: Move3x3[]) {
  const def = activeLessonDef();
  if (!def || !state.lastResult) return;
  const seeds = lessonSeedsFor(def.id);
  // The "next visual decision" for the review: the first piece the route places.
  const focusNext = nextFocusPiece(state.stepStartCube, solvedMask, optimalArr)?.description;
  if (state.lessonRep?.example) {
    state.lastResult.lesson = { example: true, hadPrereq: !!s.prereqMask, focusNext };
    state.status = 'Example done — Next serves a case for you to try the same idea.';
    return;
  }
  const progBefore = lessonProgFor(state.trainerId, def.id);
  const phaseBefore = derivePhase(def, progBefore, seeds.length);
  const recPhase: LessonPhase = phaseBefore === 'observe' ? 'guided' : phaseBefore;
  const success = state.helpUsed < 3;
  const prog = recordLessonRep(state.trainerId, def, recPhase, success);
  lastRecord.lesson = { trainerId: state.trainerId, def, phase: recPhase };
  state.lastResult.lesson = { example: false, success, brokeProtected: state.brokeProtected, hadPrereq: !!s.prereqMask, focusNext };
  const phaseAfter = derivePhase(def, prog, seeds.length);
  const defs = lessonsFor(state.trainerId)!;
  const idx = defs.indexOf(def);
  if (prog.done && !progBefore.done) {
    if (idx + 1 < defs.length) {
      setFoundationsCurrent(state.trainerId, idx + 1);
      state.status = `Lesson complete! 🎉 Next lesson: ${defs[idx + 1].title}.`;
    } else {
      state.status = 'Foundations complete! 🏆 Continue in Course › 2×2×3 or the free Blocks drills.';
    }
  } else if (!success) {
    state.status = 'Done — but the route was revealed, so this rep isn’t counted. The next one is yours.';
  } else if (phaseAfter === 'coached' && phaseBefore !== 'coached') {
    state.status = 'Guided done ✓ — coached practice unlocked: you lead, I’ll point before you start.';
  } else if (phaseAfter === 'independent' && phaseBefore !== 'independent') {
    state.status = `Coached done ✓ — independent practice: ${def.gates.indepNeed} of your latest ${def.gates.indepWindow} finish the lesson.`;
  }
}


// --- rendering ---

const STATUS_FLASH_MS = 3500;
let shownStatus = '';
let statusShownAt = 0;
let statusTimer: number | undefined;

function render() {
  const s = currentStep();
  const info = s ? progressInfo(state.cube, s) : { frac: 1, pct: 100, caption: '' };
  const phase = repPhase();
  document.documentElement.dataset.theme = resolveTheme(getTheme());

  // Flash the status message over the cube view when it changes (it's where the
  // eye is and where the visible change happens). statusShownAt drives a CSS
  // fade in buildCubePanel; the timer drops the toast if nothing else re-renders.
  if (state.status !== shownStatus) {
    shownStatus = state.status;
    statusShownAt = Date.now();
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(render, STATUS_FLASH_MS + 100);
  }

  const app = document.createDocumentFragment();
  app.appendChild(buildTopBar());
  app.appendChild(buildStepBar());
  if (state.showPicker) app.appendChild(buildToolbar());

  // Left column: the scramble (while it's live), the stage, then the Now bar —
  // directly under the cube, because that's where the eye is.
  const main = el('div', 'main');
  const left = el('div', 'col');
  const strip = buildScrambleStrip();
  if (strip) left.appendChild(strip);
  left.appendChild(buildCubePanel(s));
  const now = buildNowBar(s);
  if (now) left.appendChild(now);
  if (trainer().course) left.appendChild(buildCoursePanel());
  else if (activeLessonDef()) left.appendChild(buildFoundationsPanel());
  main.appendChild(left);

  // The right pane holds one thing at a time: the Stats overlay if it's open,
  // otherwise whatever this rep's phase calls for.
  const right = el('div', 'panel grow');
  if (state.showStats) buildStatsPane(right);
  else if (phase === 'review') buildReviewPane(right);
  else if (phase === 'walkthrough' && s) buildLearnPane(right, s);
  else buildSessionPane(right, s, info);
  main.appendChild(right);
  app.appendChild(main);

  appEl.replaceChildren(app);
  // The standing brief sits above the coaching output. Once help has actually been
  // asked for, pin the console to the bottom so a long lesson brief can't push the
  // answer below the fold — press Hint, see the hint.
  if (state.assist || state.predictResult) {
    const con = appEl.querySelector('.console');
    if (con) con.scrollTop = con.scrollHeight;
  }
  if (state.showSettings) renderSettings();
}

// --- top bar + toolbar ---
function segBtn(label: string, onClick: () => void, active: boolean): HTMLButtonElement {
  return btn(label, onClick, `seg-btn${active ? ' active' : ''}`);
}
function iconBtn(label: string, onClick: () => void): HTMLButtonElement {
  return btn(label, onClick, 'icon-btn');
}

function buildTopBar(): HTMLElement {
  const top = el('div', 'topbar');
  const brand = el('div', 'brand');
  brand.appendChild(el('span', 'logo', '◧'));
  brand.appendChild(document.createTextNode('SmartCube Gym'));
  top.appendChild(brand);

  top.appendChild(el('div', 'spacer'));

  // Cube pill (click = connect/disconnect)
  const battery = state.battery != null ? ` · ${state.battery}%` : '';
  const pill = el('span', `cube-pill ${state.connected ? '' : 'off'}`);
  pill.appendChild(el('span', 'dot'));
  pill.appendChild(document.createTextNode(state.connected ? `${cube.deviceName || 'Cube'}${battery}` : 'No cube'));
  pill.style.cursor = 'pointer';
  pill.title = state.connected ? 'Disconnect' : 'Connect cube';
  pill.addEventListener('click', toggleConnect);
  top.appendChild(pill);

  const statsBtn = iconBtn('Stats', () => { state.showStats = !state.showStats; render(); });
  if (state.showStats) { statsBtn.style.borderColor = 'var(--accent)'; statsBtn.style.fontWeight = '600'; statsBtn.style.color = 'var(--accent)'; }
  statsBtn.title = state.showStats ? 'Close stats' : 'Show stats';
  top.appendChild(statsBtn);
  const help = iconBtn('?', () => window.open('https://github.com/ianjohndawson/smartcube-gym/blob/main/MANUAL.md', '_blank'));
  help.title = 'User manual';
  top.appendChild(help);
  top.appendChild(iconBtn('⚙', () => { state.showSettings = true; render(); }));
  return top;
}

function catLabel(c: Category): string {
  return c === 'Blocks' ? 'Block building' : c === 'EO' ? 'Edge Orientation' : c;
}
// The current selection as one sentence (Category · Trainer · Mode) with a Change
// button that reveals the full picker — sits just below the top bar. It also holds
// the cube controls: they're wanted in every mode, so giving them a panel of their
// own in the left column would cost the cube view height for the whole session,
// whereas this bar has to exist anyway and had a screen's width of dead space.
function buildStepBar(): HTMLElement {
  const bar = el('div', 'stepbar');
  const crumb = el('span', 'crumb');
  crumb.appendChild(el('span', 'crumb-part', catLabel(state.category)));
  crumb.appendChild(el('span', 'crumb-sep', '·'));
  crumb.appendChild(el('span', 'crumb-part', trainer().label));
  crumb.appendChild(el('span', 'crumb-sep', '·'));
  crumb.appendChild(el('span', 'crumb-part', state.trainMode === 'timed' ? 'Timed' : 'Efficiency'));
  crumb.style.cursor = 'pointer';
  crumb.title = 'Change what you are training';
  crumb.addEventListener('click', togglePicker);
  bar.appendChild(crumb);
  bar.appendChild(el('div', 'spacer'));
  // Only offered mid-solve: while you're still applying one, a fresh scramble is
  // what "Reset Cube" plus the strip already gives you.
  if (repPhase() !== 'setup') bar.appendChild(btn('Next scramble', nextScramble, 'btn'));
  bar.appendChild(btn('Reset Cube', resetToSolved, 'btn'));
  // Sync = read the cube's real state and correct the model (for BLE drift).
  bar.appendChild(btn('Sync to Cube state', syncCube, 'btn'));
  bar.appendChild(btn(state.showPicker ? 'Close' : 'Change', togglePicker, 'btn'));
  return bar;
}
function buildToolbar(): HTMLElement {
  const tb = el('div', 'toolbar');
  // Category (Course / EO / Block building)
  const cs = el('div', 'seg');
  for (const c of CATEGORIES) cs.appendChild(segBtn(catLabel(c), () => selectCategory(c), state.category === c));
  tb.appendChild(cs);
  tb.appendChild(el('span', 'div', '│'));
  // Trainer within the chosen category
  const ts = el('div', 'seg');
  for (const t of trainersIn(state.category)) ts.appendChild(segBtn(t.label, () => selectTrainerFlat(t.id), state.trainerId === t.id));
  tb.appendChild(ts);
  tb.appendChild(el('span', 'div', '│'));
  const mo = el('div', 'seg');
  mo.appendChild(segBtn('Efficiency', () => setMode('efficiency'), state.trainMode === 'efficiency'));
  mo.appendChild(segBtn('Timed', () => setMode('timed'), state.trainMode === 'timed'));
  tb.appendChild(mo);
  return tb;
}

// --- left column panels ---
// The scramble is live only while you're applying it — once solving starts it's
// hidden (it would be the optimal solution reversed; e.g. an EO scramble is the
// inverse). So rather than leave a panel standing empty for the rest of the rep,
// the whole strip leaves the column and the cube view takes the height. Header-
// less and button-less for the same reason: its buttons are in the step bar.
// The strip is now just the move tokens: what it used to say underneath ("next L ·
// 10 to go · solving auto-starts when matched") is the current instruction, so it
// moved to the Now bar with every other instruction. The tokens stay here because
// they're a picture of the sequence, not a sentence about it.
function buildScrambleStrip(): HTMLElement | null {
  if (repPhase() !== 'setup') return null;
  const p = el('div', 'panel scramble-strip');
  p.appendChild(renderScramble());
  return p;
}

// --- Now bar: the one place that says what to do next ---
//
// One task, one message. The current instruction used to be spread across four
// places — the scramble strip's caption, the cube panel's caption, a [find] line in
// the console, and a toast that fades after 3.5s. That last one had already been
// patched once (commit 6a9d868) because a find-the-piece prompt vanished before the
// learner had acted on it; the same objection applied to every other instruction.
// It sits under the cube because that's where the eye already is — the reason the
// toast was drawn over the cube in the first place.
//
// Rendered for the four phases that share the generic session pane. Walkthrough and
// review are deliberately EXCLUDED: each has a dedicated right-hand pane that
// already owns its instruction and its verbs (buildLearnPane carries the route, the
// per-move role and the pattern's why), so a second copy here would either duplicate
// them or need filler text to justify the space.
//
// Verbs appear here only for a phase you can BACK OUT OF — a mode with a way to
// leave it. Help keeps its own home in the session pane; the cube utilities keep
// theirs in the step bar.
function buildNowBar(s: StepDef | null): HTMLElement | null {
  const phase = repPhase();
  if (phase === 'walkthrough' || phase === 'review') return null;

  const bar = el('div', 'nowbar');
  const line = el('div', 'now-text');
  const verbs = el('div', 'now-verbs');
  let hot = false;

  const say = (...parts: (string | HTMLElement)[]) => {
    for (const part of parts) {
      if (typeof part === 'string') line.appendChild(document.createTextNode(part));
      else line.appendChild(part);
    }
  };
  const move = (m: string) => el('span', 'accent-fg mono', m);

  if (phase === 'setup') {
    const { done, offTrack } = scrambleStatus();
    const total = state.scrambleMoves.length;
    // enterLearn borrows the setup phase to rewind the cube to the step start, so
    // this is two different errands. Say which — "apply the scramble" is actively
    // wrong when what's wanted is undoing your own moves.
    const goal = state.pendingLearn
      ? `Rewind to the start of ${s?.label ?? 'the step'}`
      : 'Apply the scramble';
    if (offTrack) {
      // Off track, the self-healing sequence is the only thing that knows the way
      // back, so its head is the move to make. Its LENGTH isn't quoted: simplifyMoves
      // is a single pass over consecutive same-face runs, so a cancellation that only
      // becomes adjacent after an inner pair vanishes survives, and the count comes
      // out inflated. The move is right either way; a wrong number is not worth it.
      const fix = scrambleRemaining()[0];
      hot = true;
      if (fix) say('That turn was off the scramble — undo it with ', move(fix), ', then carry on.');
      else say('That turn was off the scramble — undo it to carry on.');
    } else if (done < total) {
      // On track: read straight off the token the strip is highlighting, so the two
      // always agree about what "next" means.
      say(`${goal} — next `, move(state.scrambleMoves[done]), ` · ${total - done} to go.`);
    } else {
      say(`${goal} from your cube — solving starts by itself the moment it matches.`);
    }
  } else if (phase === 'identify') {
    hot = true;
    say((s && identifyPrompt(s)) || 'Find the piece on your cube and tap it.');
  } else if (phase === 'lookahead') {
    const p = state.predict!;
    say(`Place the ${p.joinDesc} while you track the ${p.z.description}. The view is blank — execute on your cube, then tap where you think it ended up.`);
    verbs.appendChild(btn('Cancel lookahead', cancelPredict, 'btn ghost'));
  } else {
    // solve
    if (!s) say('Pick something to train from the Change menu.');
    else {
      const task = s.kind === 'eo'
        ? `Orient all 12 edges${s.prereqMask ? `, keeping the ${s.label} intact` : ''}.`
        : `Build the ${s.label}.`;
      const aimable = s.kind === 'block' && s.family === '222' && s.candidateMasks.length > 1;
      say(aimable ? `${task} Tap a corner on the cube to aim it there.` : task);
    }
  }

  if (hot) bar.classList.add('hot');
  bar.appendChild(line);
  if (verbs.childElementCount) bar.appendChild(verbs);
  return bar;
}

function buildCubePanel(s: StepDef | null): HTMLElement {
  const p = el('div', 'panel grow');
  p.appendChild(el('div', 'panel-hd', 'Cube view'));
  const wrap = el('div', 'cube-wrap');
  const phase = repPhase();
  // Sticker taps serve three flows, and the phase says which: answering a lookahead
  // rep, answering a Foundations find-the-piece prompt, or tap-to-aim on the free
  // 2×2×2 steps (pinPlacementAt — plain solving, no prompt outstanding). These used
  // to be three hand-ordered conditions that each restated the precedence; now the
  // precedence lives in repPhase and they're mutually exclusive by construction.
  const predicting = phase === 'lookahead';
  const identifying = phase === 'identify';
  const aimable = phase === 'solve' && !!s && s.kind === 'block' && s.family === '222' && s.candidateMasks.length > 1;
  if (aimable || predicting || identifying) {
    wrap.classList.add('pickable');
    wrap.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-facelet-index]') as HTMLElement | null;
      if (!t?.dataset.faceletIndex) return;
      if (predicting) answerPredict(Number(t.dataset.faceletIndex));
      else if (identifying) answerIdentify(Number(t.dataset.faceletIndex));
      else pinPlacementAt(Number(t.dataset.faceletIndex), s!);
    });
  }
  let highlight: Set<number> | null = null;
  let note = '';
  if (state.assist) {
    if (state.assist.kind === 'ideal') { highlight = new Set(activeMask(s!).solvedFaceletIndices); note = 'highlighted: the target facelets'; }
    else if (state.assist.kind === 'nudge' && s?.kind === 'eo') {
      // Bad-edge stickers are model-frame (computed without rotating the state),
      // so they go through the same rotateHighlight as every other highlight.
      const ax = eoStepAxis(s);
      highlight = new Set(ax ? axisBad(state.cube, ax).stickers : badEdgeStickers(state.cube));
      note = 'highlighted: the misoriented edges';
    }
    else if (state.assist.focus) { highlight = new Set(state.assist.focus.current); note = `highlighted: the ${state.assist.focus.description}`; }
  }
  // Lookahead answer / identify-find reveal: ring the piece (model frame).
  if (state.predictResult) { highlight = new Set(state.predictResult.stickers); note = state.predictResult.note ?? 'highlighted: where it actually is'; }
  if (solveFrame() && highlight) highlight = rotateHighlight(highlight, solveRotation());
  // Foundations: keep a muted persistent outline on the prerequisite block while it
  // must be protected — dropped for independent reps (training wheels off), during
  // setup (the block isn't built yet, and enterLearn's rewind passes through here),
  // and while a lookahead rep has the whole view blanked. `lp` is the LESSON phase
  // (observe/guided/coached/independent) — a different ladder from the rep phase.
  let keep: Set<number> | null = null;
  if (s?.prereqMask && phase !== 'setup' && phase !== 'lookahead' && activeLessonDef()) {
    const lp = lessonPhaseNow();
    if (lp === 'observe' || lp === 'guided' || lp === 'coached') {
      keep = new Set(s.prereqMask.solvedFaceletIndices);
      if (solveFrame()) keep = rotateHighlight(keep, solveRotation());
    }
  }
  // Blank the corners for any EO step that keeps no block — corner state is
  // irrelevant to edge orientation, so it's hidden for Full EO, EOLine and
  // EOCross alike. A block-preserving EO step (Petrus / the eo123·eo223 drills)
  // has corner facelets in its target, so its corners stay visible.
  const pureEo = s?.kind === 'eo' && !s.canonicalMask.solvedFaceletIndices.some((i) => CORNER_SET.has(i));
  // Lookahead rep: the whole view blanks — you're predicting, not reading.
  const blank = predicting ? ALL_FACELETS : pureEo ? new Set(CORNER_FACELETS) : null;
  const facelets = solveFrame() ? rotatedFacelets(state.cube, solveRotation()) : faceletString(state.cube);
  // Same facelets/highlight/blank/keep feed either view; the toggle only picks the shape.
  wrap.appendChild(cubeView === '3d' ? renderCube3D(facelets, highlight, blank, keep) : renderCubeNet(facelets, highlight, blank, keep));
  // Transient status toast over the cube (fades via CSS; see STATUS_FLASH_MS).
  if (state.status && Date.now() - statusShownAt < STATUS_FLASH_MS) {
    wrap.appendChild(el('div', 'cube-toast', state.status));
  }
  p.appendChild(wrap);
  // The stage's caption annotates the PICTURE — how to hold the cube, and what a
  // highlight ring means. What to DO about it is the Now bar's job, so the old
  // "tap a corner to aim" / "execute, then tap where it landed" instructions have
  // moved there. (The hold deliberately stayed: it describes the view, not the
  // phase, and it must not scroll away with the instruction when the phase turns.)
  const holdNote = s?.hold
    ? s.hold
    : `${solveFrame() ? `hold ${orientLabel(solveRotation())}` : 'hold white-up / green-front'}${s ? ` · ${s.label} target` : ''}`;
  p.appendChild(el('div', 'meter-cap', note || holdNote));
  return p;
}

function setCourseLevel(id: string, level: number) {
  setCourseCurrent(id, level);
  state = freshTrainer(id); // fresh banded scramble at the new level (from solved)
  render();
}

function buildCoursePanel(): HTMLElement {
  const tr = trainer();
  const bands = tr.course!;
  const track = courseTrack(tr.id);
  const cur = track.current;
  const p = el('div', 'panel');
  p.appendChild(el('div', 'panel-hd', 'Course'));
  const chips = el('div', 'chips');
  bands.forEach((b, i) => {
    const locked = i > track.unlocked;
    const stars = track.levels[i]?.stars ?? 0;
    const c = el('div', `chip ${i === cur ? 'active' : stars > 0 ? 'done' : ''}`);
    c.appendChild(el('div', 'nm', b.label));
    c.appendChild(el('div', 'st', locked ? '🔒 locked' : `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`));
    if (!locked) { c.style.cursor = 'pointer'; c.addEventListener('click', () => setCourseLevel(tr.id, i)); }
    chips.appendChild(c);
  });
  p.appendChild(chips);
  // Everything the panel used to say — example progress, the grading rule — now
  // reads in the console (see buildBriefing). The panel is the chips you click.
  return p;
}

// --- Foundations panel (the lessons' home; replaces the Course bands panel) ---

function phaseLabel(ph: LessonPhase): string {
  return ph === 'observe' ? 'watching' : ph === 'guided' ? 'guided' : ph === 'coached' ? 'coached' : ph === 'independent' ? 'independent' : 'complete';
}

function selectLesson(idx: number) {
  setFoundationsCurrent(state.trainerId, idx);
  state = freshTrainer(state.trainerId); // fresh lesson case (from solved, like course levels)
  render();
}

function buildFoundationsPanel(): HTMLElement {
  const defs = lessonsFor(state.trainerId)!;
  const track = foundationsTrack(state.trainerId);
  const cur = Math.min(track.current, defs.length - 1);
  const open = firstOpenLesson(defs, (d) => lessonProgFor(state.trainerId, d.id));
  const def = defs[cur];
  const prog = lessonProgFor(state.trainerId, def.id);
  const phase = derivePhase(def, prog, lessonSeedsFor(def.id).length);
  const p = el('div', 'panel');
  p.appendChild(el('div', 'panel-hd', 'Foundations'));
  // Lesson chips: complete ✓ · active · forward-locked (anything behind is revisitable).
  const chips = el('div', 'chips');
  defs.forEach((d, i) => {
    const dp = lessonProgFor(state.trainerId, d.id);
    const locked = i > open;
    const c = el('div', `chip ${i === cur ? 'active' : dp.done ? 'done' : ''}`);
    c.appendChild(el('div', 'nm', `L${i + 1} · ${d.title}`));
    c.appendChild(el('div', 'st', locked ? '🔒 locked' : dp.done ? '✓ complete' : i === cur ? phaseLabel(phase) : 'open'));
    if (!locked) { c.style.cursor = 'pointer'; c.addEventListener('click', () => selectLesson(i)); }
    chips.appendChild(c);
  });
  p.appendChild(chips);
  // The lesson card — what, why, the phase ladder — now reads in the console
  // (see buildBriefing), so the panel is the chips plus the one action below.
  // Examples stay available in EVERY phase — skipping ahead never locks them
  // away, and you don't need to be able to solve the cube to get back to one.
  // Hidden while an unapplied example is already on the board.
  const left = examplesLeft();
  const exampleOnBoard = !!state.lessonRep?.example && !state.lessonRep.consumed;
  if (left > 0 && !exampleOnBoard) {
    const row = el('div', 'row');
    row.style.marginTop = '10px';
    row.appendChild(btn(`Watch an example (${left} left)`, watchExample, 'btn'));
    p.appendChild(row);
  }
  return p;
}

// --- right pane: session (actions on top + meter + output console) ---

function buildSessionPane(right: HTMLElement, s: StepDef | null, info: { frac: number; caption: string }) {
  const ideal = idealFromStart();
  const hd = el('div', 'panel-tabs');
  hd.appendChild(el('div', 'spacer'));
  if (ideal != null) hd.appendChild(el('span', 'tag', `ideal ${ideal}`));
  right.appendChild(hd);

  right.appendChild(buildActions(s));
  right.appendChild(buildStepMeter(s, info, ideal));
  right.appendChild(buildCoachBody(s));
}

// --- right pane: Stats overlay (top-bar toggle; available in any mode) ---
function buildStatsPane(right: HTMLElement) {
  const hd = el('div', 'panel-tabs');
  hd.appendChild(el('div', 'panel-hd', 'Stats'));
  hd.appendChild(el('div', 'spacer'));
  hd.appendChild(btn('Close', () => { state.showStats = false; render(); }, 'btn ghost'));
  right.appendChild(hd);
  right.appendChild(buildStatsBody());
}

function buildActions(s: StepDef | null): HTMLElement {
  const phase = repPhase();
  // Help applies whenever you're working the target yourself — plain solving, or
  // either prompt phase, which still have you turning the cube. Setup has nothing
  // to help with yet.
  const solving = isSolvingPhase(phase) && !!s;
  const actions = el('div', 'row');
  actions.style.marginBottom = '14px';
  actions.appendChild(btn('Hint', () => assist('nudge'), 'btn default', !solving));
  actions.appendChild(btn('Next move', () => assist('move'), 'btn', !solving));
  actions.appendChild(btn('Show ideal', () => assist('ideal'), 'btn', !solving));
  // Lookahead rep (block steps): predict where the next-but-one piece lands.
  // Offered from plain solving only — not from inside another prompt — and hidden
  // on Foundations lessons, one skill at a time for beginners.
  if (phase === 'solve' && !!s && s.kind === 'block' && !activeLessonDef()) {
    actions.appendChild(btn('Lookahead', startPredict, 'btn'));
  }
  // Cancel lookahead is NOT here: leaving a mode is a phase verb, and those live in
  // the Now bar next to the instruction for the mode you're leaving.
  // Once the ideal is revealed (assist === 'ideal'), offer to try it: "Walk it
  // through" hands the cube back to the step start, then guides the moves. Only
  // surfaced while solving and only when there's actually a solution shown.
  if (solving && state.assist?.kind === 'ideal') {
    actions.appendChild(btn('Walk it through', enterLearn, 'btn default'));
  }
  actions.appendChild(btn('Retry', tryAgain, 'btn', !solving));
  return actions;
}

// The meter reports whichever task is actually live. During setup that's the
// SCRAMBLE, not the step: progressInfo measures the step target against a cube
// that hasn't been scrambled yet, so on a solved cube every target piece is
// trivially in place and the bar sat at 100% with "4/4 pieces placed" while the
// user was still turning. Same widget, phase-appropriate reading.
function buildStepMeter(s: StepDef | null, info: { frac: number; caption: string }, ideal: number | null): HTMLElement {
  if (repPhase() === 'setup') return buildScrambleMeter();
  const wrap = el('div', 'step-meter');
  const used = htmCount(state.movesThisStep);
  const hd = el('div', 'dock-hd');
  hd.appendChild(el('span', '', s ? `Step · ${s.label}` : 'No step'));
  if (state.trainMode === 'timed') {
    const txt = state.solveStartMs == null ? '0:00.00' : fmtTime((state.finishedMs ?? Date.now()) - state.solveStartMs);
    const t = el('span', 'timer', txt);
    t.id = 'live-timer';
    hd.appendChild(t);
  } else {
    hd.appendChild(el('span', '', `${used} / ${ideal ?? '?'}`));
  }
  wrap.appendChild(hd);
  const meter = el('div', 'meter');
  const fill = el('div', 'fill');
  fill.style.width = `${Math.round(info.frac * 100)}%`;
  meter.appendChild(fill);
  wrap.appendChild(meter);
  wrap.appendChild(el('div', 'meter-cap', s ? `${info.caption}${ideal != null ? ` · ideal ${ideal}` : ''}` : ''));
  return wrap;
}

// Setup-phase meter: how far through applying the scramble you are. The strip
// above says WHICH moves are left; this says how far, and keeps the pane from
// changing shape when solving starts.
function buildScrambleMeter(): HTMLElement {
  const wrap = el('div', 'step-meter');
  const total = state.scrambleMoves.length;
  const { done, offTrack } = scrambleStatus();
  const hd = el('div', 'dock-hd');
  // enterLearn borrows this phase to rewind to the step start — same progress
  // mechanics, different errand, so it gets its own label (as in the Now bar).
  hd.appendChild(el('span', '', state.pendingLearn ? 'Rewind' : 'Scramble'));
  hd.appendChild(el('span', '', `${done} / ${total}`));
  wrap.appendChild(hd);
  const meter = el('div', 'meter');
  const fill = el('div', 'fill');
  fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  meter.appendChild(fill);
  wrap.appendChild(meter);
  wrap.appendChild(el('div', 'meter-cap',
    offTrack ? 'off track — undo the wrong turn to carry on'
    : state.pendingLearn ? 'returning to the start of the step' : 'applying the scramble'));
  return wrap;
}

function coachLine(parent: HTMLElement, tag: string, cls: string, msg: string) {
  const l = el('div', 'cline');
  if (tag) l.appendChild(el('span', 'ctag', `[${tag}]`));
  const m = el('span', `cmsg ${cls}`);
  m.textContent = msg;
  l.appendChild(m);
  parent.appendChild(l);
}

// The standing brief: what the current level or lesson is asking of you, and how
// far through it you are. It reads here rather than under the chips because the
// console is the one place that's meant to hold words — it scrolls, so prose can
// be as long as it needs to be without ever costing the cube view height.
function buildBriefing(c: HTMLElement) {
  const tr = trainer();
  const def = activeLessonDef();
  if (def) {
    const defs = lessonsFor(state.trainerId)!;
    const cur = Math.min(foundationsTrack(state.trainerId).current, defs.length - 1);
    const prog = lessonProgFor(state.trainerId, def.id);
    const seeds = lessonSeedsFor(def.id);
    const phase = derivePhase(def, prog, seeds.length);
    coachLine(c, 'lesson', 'c-good', `L${cur + 1} · ${def.title}`);
    coachLine(c, '', 'c-coach', def.explain);
    coachLine(c, '', 'c-muted', `Goal: ${def.outcome}`);
    coachLine(c, '', 'c-muted', `Why this matters: ${def.why}`);
    const g = successCount(prog.guided);
    const co = successCount(prog.coached);
    const iw = successCount(prog.indep.slice(-def.gates.indepWindow));
    const seg = (label: string, active: boolean, done: boolean) => `${active ? '▶ ' : ''}${label}${done ? ' ✓' : ''}`;
    coachLine(c, 'phase', 'c-muted', [
      seg(`watch ${Math.min(prog.observed, seeds.length)}/${seeds.length}`, phase === 'observe', prog.observed >= seeds.length),
      seg(`guided ${Math.min(g, def.gates.guided)}/${def.gates.guided}`, phase === 'guided', g >= def.gates.guided),
      seg(`coached ${Math.min(co, def.gates.coached)}/${def.gates.coached}`, phase === 'coached', co >= def.gates.coached),
      seg(`solo ${iw}/${def.gates.indepNeed} of latest ${def.gates.indepWindow}`, phase === 'independent', prog.done),
    ].join('  ·  '));
    if (prog.done && cur === defs.length - 1) {
      coachLine(c, '', 'c-muted', 'Foundations complete 🏆 — continue in Course › 2×2×3 or the free Blocks drills.');
    } else if (phase === 'observe') {
      coachLine(c, '', 'c-muted', 'Examples are demonstrations — watch one, or walk it through on your cube. Nothing here is graded.');
    } else {
      coachLine(c, '', 'c-muted', 'A rep counts once you finish without “Show ideal” — Hint and Next move are always fair game.');
    }
    return;
  }
  if (!tr.course) return;
  const track = courseTrack(tr.id);
  const cur = track.current;
  coachLine(c, 'course', 'c-good', `${tr.course[cur].label} · ${tr.label}`);
  // Seeded lessons: show example progress; the next example needs a solved
  // cube (lesson entry resets to one), practice reps generate in between.
  const seeds = seedsFor(tr.id, cur);
  const intro = Math.min(courseIntro(tr.id, cur), seeds.length);
  if (seeds.length) {
    coachLine(c, '', 'c-muted',
      state.courseSeedPending
        ? `example ${Math.min(intro + 1, seeds.length)}/${seeds.length} on the board — apply the scramble`
        : intro < seeds.length
        ? `examples ${intro}/${seeds.length} shown — next needs a solved cube`
        : `examples ${seeds.length}/${seeds.length} shown — practice until clean`);
  }
  const recent = track.levels[cur]?.recent ?? [];
  const clean = recent.filter((w) => w <= COURSE_TOLERANCE).length;
  coachLine(c, '', 'c-muted',
    recent.length
      ? `${clean}/${recent.length} clean (≤ +${COURSE_TOLERANCE}) · clear at ${Math.round(COURSE_STAR_RATES[0] * 100)}% over ${COURSE_WINDOW}`
      : `solve ${COURSE_WINDOW} here to be graded · "clean" = within +${COURSE_TOLERANCE} of optimal`);
}

// Output console: the brief above, then requested help only (Hint/Next move/Show
// ideal) — never auto-answers.
function buildCoachBody(s: StepDef | null): HTMLElement {
  const c = el('div', 'console');
  buildBriefing(c);
  if (c.childElementCount) c.appendChild(el('div', 'crule'));
  if (!s) { coachLine(c, '', 'c-muted', 'No active step.'); return c; }
  if (repPhase() === 'setup') { coachLine(c, '', 'c-muted', 'Apply the scramble — solving auto-starts when matched.'); return c; }
  // A find-the-piece task (Foundations observe/guided) is a STANDING instruction, so
  // it now reads in the Now bar with every other instruction — it used to be here
  // because the console was the only thing that wouldn't fade. It's still checked,
  // though: while a prompt is outstanding, don't also nag about the help buttons.
  const findOutstanding = !!identifyPrompt(s);
  const a = state.assist;
  if (!a) {
    if (!findOutstanding) coachLine(c, '', 'c-muted', 'Press Hint, Next move or Show ideal when you want help.');
    return c;
  }
  if (a.kind === 'nudge') {
    // Rule-based recognition + technique (no exact moves — that's Next move / Show ideal).
    const ax = eoStepAxis(s);
    const h = s.kind === 'eo' ? (ax ? freeEoHint(axisBad(state.cube, ax).count) : eoHint(state.cube)) : blockHint(a.focus, true);
    // A recognised Lars Petrus pattern outranks the generic size-based label.
    if (a.pattern) {
      coachLine(c, 'pattern', 'c-good', a.pattern);
      coachLine(c, '', 'c-coach', PATTERN_HOW[a.pattern]);
    } else if (h.name) coachLine(c, 'pattern', 'c-good', h.name);
    for (const ln of h.lines) coachLine(c, '', 'c-coach', ln);
  } else if (a.kind === 'move') {
    coachLine(c, 'hint', 'c-hint', `next ▸ ${disp([a.moves[0]])[0]}`);
  } else if (a.kind === 'ideal') {
    coachLine(c, 'solver', 'c-good', `solution ▸ ${disp(a.moves).join(' ')}`);
  }
  return c;
}

// --- right pane: beginner (Foundations) review — the roadmap's four answers:
// did I make it · what went well · the key pattern · what to notice next time.
// Advanced signals (placement ranking, inspection) stay out of the way here.
function buildLessonReview(right: HTMLElement, r: NonNullable<State['lastResult']>) {
  const li = r.lesson!;
  right.appendChild(el('div', 'solved-banner',
    li.example ? '🎓 Example complete — that shape is what the lesson trains.'
    : li.success ? '🎉 Built it yourself — this rep counts.'
    : '✔ Built — but the route was revealed, so this rep isn’t counted.'));
  right.appendChild(el('div', 'meter-cap', `You completed the ${r.step}.`));
  if (li.hadPrereq) {
    right.appendChild(el('div', 'meter-cap', li.brokeProtected
      ? 'The built block broke along the way and you recovered it — next time look for a route that keeps it whole.'
      : 'Your built block stayed intact the whole way — that is the core skill.'));
  }
  if (r.patterns?.yours.length) right.appendChild(el('div', 'meter-cap', `Your solve used: ${r.patterns.yours.join(' · ')}.`));
  const kp = r.patterns?.ideal[0];
  if (kp) right.appendChild(el('div', 'meter-cap', `The taught route is a ${kp} — ${PATTERN_HOW[kp]}`));
  const yours = disp(simplifyMoves(r.yourMoves));
  const cmp = el('div', 'coach');
  cmp.textContent =
    `your moves (${r.used}): ${yours.join(' ') || '—'}\n` +
    `ideal (${r.optimal ?? '?'}):  ${disp(r.idealMoves).join(' ')}`;
  right.appendChild(cmp);
  if (!li.example && r.optimal != null) {
    right.appendChild(el('div', 'meter-cap', r.used <= r.optimal
      ? 'That was the shortest route. Superb.'
      : li.focusNext
      ? `Next time: spot the ${li.focusNext} before your first turn — it starts the shortest route.`
      : `${r.used - r.optimal} extra move${r.used - r.optimal === 1 ? '' : 's'} — completely fine while learning.`));
  }
  const row = el('div', 'row');
  row.style.marginTop = '14px';
  row.appendChild(btn('Learn the ideal', learnFromReview, 'btn default'));
  row.appendChild(btn('Try again', tryAgain, 'btn'));
  // Chain straight into the next demonstration after an example — the moment
  // it's most wanted, and when the way back to solved is shortest.
  if (li.example && examplesLeft() > 0) row.appendChild(btn('Next example', watchExample, 'btn'));
  row.appendChild(btn('Next scramble', nextScramble, 'btn'));
  if (!li.example) row.appendChild(btn('Discard', discardLastSolve, 'btn ghost'));
  right.appendChild(row);
}

// --- right pane: all-done review ---
function buildReviewPane(right: HTMLElement) {
  right.appendChild(el('div', 'panel-hd', 'Solved'));
  const rl = state.lastResult;
  if (rl?.lesson && lessonsFor(state.trainerId)) { buildLessonReview(right, rl); return; }
  right.appendChild(el('div', 'solved-banner', '🎉 Solved! Here’s how you did.'));
  const r = state.lastResult;
  if (r) {
    const yours = disp(simplifyMoves(r.yourMoves));
    const extra = r.optimal != null ? r.used - r.optimal : 0;
    const verdict = r.optimal == null ? '' : extra <= 0 ? '🏆 optimal!' : extra <= 2 ? '👍 very efficient' : extra <= 5 ? 'good — room to tighten' : 'lots of room to improve';
    if (r.case) right.appendChild(el('div', 'meter-cap', `case: ${r.case}`));
    // Planning verdict + inspection — the "did you read the scramble well" lines.
    if (r.rank) {
      right.appendChild(el('div', 'meter-cap', r.rank.yoursBest
        ? `placements: you built the cheapest — ${r.rank.yoursName} (${r.rank.yoursLen})`
        : `placements: cheapest was the ${r.rank.bestName} (${r.rank.bestLen}) — you built the ${r.rank.yoursName} (${r.rank.yoursLen})`));
    }
    if (r.insp != null) right.appendChild(el('div', 'meter-cap', `inspection ${(r.insp / 1000).toFixed(1)}s`));
    if (r.patterns && (r.patterns.ideal.length || r.patterns.yours.length)) {
      const fmt = (xs: string[]) => (xs.length ? xs.join(' · ') : '—');
      right.appendChild(el('div', 'meter-cap', `patterns — ideal: ${fmt(r.patterns.ideal)} · yours: ${fmt(r.patterns.yours)}`));
    }
    const cmp = el('div', 'coach');
    cmp.textContent =
      `your solution (${r.used}): ${yours.join(' ') || '—'}\n` +
      `ideal (${r.optimal ?? '?'}):  ${disp(r.idealMoves).join(' ')}` +
      (verdict ? `\n${verdict}` : '');
    right.appendChild(cmp);
    if (r.eo) {
      const solved = state.eoAxis;
      const other = OTHER_AXIS[solved];
      const sl = r.eo[solved].len;
      const ol = r.eo[other].len;
      const verdictAxis =
        sl < ol ? `you picked the shorter axis (${AXIS_SHORT[solved]} ${sl} vs ${AXIS_SHORT[other]} ${ol}) ✓`
        : sl > ol ? `${AXIS_SHORT[other]} front was shorter (${ol} vs ${sl}) — worth a look`
        : `both axes were equal (${sl} moves)`;
      const cmpAxis = el('div', 'coach');
      cmpAxis.textContent =
        `EO axes — ${AXIS_SHORT.gb}: ${r.eo.gb.len} moves (${r.eo.gb.bad} bad) · ${AXIS_SHORT.ro}: ${r.eo.ro.len} moves (${r.eo.ro.bad} bad)\n${verdictAxis}`;
      right.appendChild(cmpAxis);
    }
  }
  if (state.trainMode === 'timed' && state.solveStartMs != null && state.finishedMs != null) {
    const ms = state.finishedMs - state.solveStartMs;
    const moves = htmCount(state.history.slice(state.solveStartLen));
    const tps = ms > 0 ? (moves / (ms / 1000)).toFixed(1) : '–';
    const t = el('div', 'timer');
    t.textContent = `⏱ ${fmtTime(ms)}`;
    right.appendChild(t);
    right.appendChild(el('div', 'meter-cap', `${moves} moves · ${tps} TPS`));
  }
  const row = el('div', 'row');
  row.style.marginTop = '14px';
  row.appendChild(btn('Learn the ideal', learnFromReview, 'btn default'));
  row.appendChild(btn('Try again', tryAgain, 'btn'));
  if (r?.eo) row.appendChild(btn(`Try ${AXIS_SHORT[OTHER_AXIS[state.eoAxis]]} front`, tryOtherAxis, 'btn'));
  row.appendChild(btn('Next scramble', nextScramble, 'btn'));
  row.appendChild(btn('Discard', discardLastSolve, 'btn ghost'));
  right.appendChild(row);
}

// --- right pane: learn-by-example walkthrough ---
// Move roles spelled out for the caption — the walkthrough's running "why".
const ROLE_PHRASE: Record<MoveRole, string> = {
  setup: 'setup — line the pieces up',
  join: 'the join — corner and edge become one unit',
  carry: 'carry the joined pair toward home',
  place: 'lock it into the block',
};
function buildLearnPane(right: HTMLElement, s: StepDef) {
  right.appendChild(el('div', 'panel-hd', `Learn — ${s.label}`));
  const learn = state.learn!;
  const annotated = !!learn.seg?.length;
  // The re-plan note is persistent (a toast would fade — the very failure this
  // feature fixes): after a wrong turn the moves below are a fresh route from the
  // cube's current position, not the original plan.
  right.appendChild(el('div', 'blurb', learn.rebased
    ? 'Re-planned from where your cube is now — these moves lead home from here. Follow them move by move; another wrong turn just re-plans again.'
    : annotated
    ? 'Follow the route move by move — green done, red wrong turn. It is grouped by technique: each box is one named pattern doing one job.'
    : 'Follow the ideal move by move. Each turn goes green; a wrong turn shows red.'));
  const { done, errorIndex } = progressOver(learn.moves, state.history.slice(learn.baseLen));
  const shown = disp(learn.moves);
  const tok = (i: number) => {
    const cls = i < done ? 'tok done' : i === errorIndex ? 'tok error' : i === done ? 'tok next' : 'tok';
    const sp = el('span', cls);
    sp.textContent = shown[i];
    const role = learn.roles?.[i];
    if (role) sp.title = role; // hover/long-press: the move's job
    return sp;
  };
  if (annotated) {
    const wrap = el('div', 'seg-route');
    for (const g of learn.seg!) {
      const grp = el('div', `seg-group${done > g.to ? ' done' : done >= g.from ? ' live' : ''}`);
      grp.appendChild(el('div', 'seg-label', g.name ?? 'build'));
      const line = el('div', 'movelist');
      for (let i = g.from; i <= g.to; i++) line.appendChild(tok(i));
      grp.appendChild(line);
      wrap.appendChild(grp);
    }
    right.appendChild(wrap);
  } else {
    const box = el('div', 'movelist');
    box.style.marginTop = '12px';
    shown.forEach((_, i) => box.appendChild(tok(i)));
    right.appendChild(box);
  }
  if (done < shown.length) {
    const role = learn.roles?.[done];
    right.appendChild(el('div', 'meter-cap',
      `next move: ${shown[done]} (${done}/${shown.length})${role ? ` · ${ROLE_PHRASE[role]}` : ''}`));
    // The current segment's one-liner — the why, delivered mid-execution.
    const cur = learn.seg?.find((g) => done >= g.from && done <= g.to);
    if (cur?.name) {
      const c = el('div', 'coach');
      c.textContent = `${cur.name} — ${PATTERN_HOW[cur.name]}`;
      right.appendChild(c);
    }
  }
  const row = el('div', 'row');
  row.style.marginTop = '14px';
  row.appendChild(btn('Stop walkthrough', stopLearn, 'btn'));
  right.appendChild(row);
}

// --- right pane: stats ---
// Course progress for the Stats tab: stars climbed per track.
function buildCourseStats(): HTMLElement {
  const sect = el('div', 'stat-sect');
  sect.appendChild(el('div', 'sh', 'course progress · stars per level'));
  const prog = loadCourse();
  for (const t of trainersIn('Course')) {
    // Foundations tracks have lessons, not graded bands: show lessons complete.
    const defs = lessonsFor(t.id);
    if (defs) {
      const row = el('div', 'steprow');
      row.appendChild(el('div', 'nm', t.label));
      const cells = el('div', 'row');
      cells.style.flex = '1';
      cells.style.gap = '12px';
      defs.forEach((d, i) => {
        const cell = el('span', '', lessonProgFor(t.id, d.id).done ? '✓' : '·');
        cell.title = `L${i + 1} · ${d.title}`;
        cells.appendChild(cell);
      });
      row.appendChild(cells);
      const doneN = defs.filter((d) => lessonProgFor(t.id, d.id).done).length;
      row.appendChild(el('div', 'val', `${doneN}/${defs.length}`));
      sect.appendChild(row);
      continue;
    }
    const bands = t.course!;
    const track = prog[t.id];
    const row = el('div', 'steprow');
    row.appendChild(el('div', 'nm', t.label));
    const cells = el('div', 'row');
    cells.style.flex = '1';
    cells.style.gap = '12px';
    bands.forEach((b, i) => {
      const locked = i > (track?.unlocked ?? 0);
      const stars = track?.levels?.[i]?.stars ?? 0;
      const cell = el('span', '', locked ? '🔒' : `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`);
      cell.title = b.label;
      cell.style.opacity = locked ? '0.5' : '1';
      cells.appendChild(cell);
    });
    row.appendChild(cells);
    const total = bands.reduce((a, _b, i) => a + (track?.levels?.[i]?.stars ?? 0), 0);
    row.appendChild(el('div', 'val', `${total}/${bands.length * 3}`));
    sect.appendChild(row);
  }
  return sect;
}

// Simple SVG line chart (lower = better, e.g. solve times trending down).
function buildLineChart(values: number[]): HTMLElement {
  const wrap = el('div', 'linechart');
  const W = 320, H = 80, pad = 6;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  if (values.length >= 2) {
    const max = Math.max(...values), min = Math.min(...values), range = (max - min) || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * (W - pad * 2) + pad;
      const y = H - pad - ((v - min) / range) * (H - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pts);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', 'var(--accent)');
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);
  }
  wrap.appendChild(svg);
  return wrap;
}

function buildStatsBody(): HTMLElement {
  const wrap = el('div', 'stats');
  const st = computeStats();
  const tiles = el('div', 'stat-tiles');
  const t1 = el('div', 'tile');
  t1.appendChild(el('div', 'big', st.solves ? (st.avgOverIdeal >= 0 ? `+${st.avgOverIdeal.toFixed(1)}` : st.avgOverIdeal.toFixed(1)) : '—'));
  t1.appendChild(el('div', 'cap', 'avg over ideal'));
  tiles.appendChild(t1);
  const t2 = el('div', 'tile alt');
  t2.appendChild(el('div', 'big', st.solves ? `${st.optimalPct}%` : '—'));
  t2.appendChild(el('div', 'cap', 'optimal solves'));
  tiles.appendChild(t2);
  wrap.appendChild(tiles);

  // Course progress — stars climbed per track (always shown).
  wrap.appendChild(buildCourseStats());

  // Lookahead drill accuracy (predict-z reps).
  const la = loadLookahead();
  if (la.attempts) {
    const sect = el('div', 'stat-sect');
    const rate = la.recent.length ? Math.round((100 * la.recent.filter(Boolean).length) / la.recent.length) : 0;
    sect.appendChild(el('div', 'sh', `lookahead · ${la.correct}/${la.attempts} all-time · ${rate}% over last ${la.recent.length}`));
    wrap.appendChild(sect);
  }

  if (!st.solves) {
    wrap.appendChild(el('div', 'blurb', 'No solves logged yet. Finish a step to start tracking efficiency.'));
    return wrap;
  }

  // Solve-time trend (only single-step solves carry a time).
  if (st.lastTimes.length) {
    const tsec = el('div', 'stat-sect');
    tsec.appendChild(el('div', 'sh', `solve time · last ${st.lastTimes.length} (best ${fmtTime(st.bestMs!)} · avg ${fmtTime(st.avgMs!)})`));
    tsec.appendChild(buildLineChart(st.lastTimes));
    wrap.appendChild(tsec);
  }

  const sect1 = el('div', 'stat-sect');
  sect1.appendChild(el('div', 'sh', 'extra moves · last 12 solves'));
  const chart = el('div', 'barchart');
  const maxExtra = Math.max(1, ...st.last12);
  st.last12.forEach((v) => {
    const b = el('div', `b ${v === 0 ? 'zero' : v >= 3 ? 'hi' : ''}`);
    b.style.height = `${Math.max(6, (v / maxExtra) * 100)}%`;
    chart.appendChild(b);
  });
  sect1.appendChild(chart);
  wrap.appendChild(sect1);

  const sect2 = el('div', 'stat-sect');
  sect2.appendChild(el('div', 'sh', 'by step · avg over optimal'));
  const maxAvg = Math.max(1, ...st.byStep.map((x) => x.avg));
  st.byStep.forEach((x) => {
    const r = el('div', 'steprow');
    r.appendChild(el('div', 'nm', x.label));
    const track = el('div', 'track');
    const f = el('div', 'fill');
    f.style.width = `${(x.avg / maxAvg) * 100}%`;
    track.appendChild(f);
    r.appendChild(track);
    r.appendChild(el('div', 'val', `+${x.avg.toFixed(1)}`));
    sect2.appendChild(r);
  });
  wrap.appendChild(sect2);
  wrap.appendChild(el('div', 'stat-foot', `${st.solves} solves · best streak ${st.bestStreak} optimal`));
  return wrap;
}

// Short step label for the console / stats ('2×2×2', '2×2×3', '1×2×3', 'EO', …).
function stepShort(s: StepDef): string {
  if (s.family) return s.family === '222' ? '2×2×2' : s.family === '223' ? '2×2×3' : '1×2×3';
  return s.label;
}

// Bookkeeping for the last completed solve, so it can be discarded ("didn't
// count"). The history/course data layer lives in stats.ts; this controller
// action also touches app state, so it stays here.
let lastRecord: { history: boolean; trainerId?: string; level?: number; lesson?: { trainerId: string; def: LessonDef; phase: LessonPhase } } = { history: false };
// Remove the last recorded solve from Stats + the course window (a botched solve).
function discardLastSolve() {
  if (lastRecord.history) {
    const h = loadHistory();
    h.pop();
    store.setJSON('history', h);
  }
  if (lastRecord.trainerId != null && lastRecord.level != null) {
    const p = loadCourse();
    const lv = p[lastRecord.trainerId]?.levels?.[lastRecord.level];
    if (lv?.recent.length) { lv.recent.pop(); saveCourse(p); }
  }
  if (lastRecord.lesson) {
    const { trainerId, def, phase } = lastRecord.lesson;
    popLessonRep(trainerId, def, phase);
    // If the discarded rep was the one that completed the lesson, step back to it.
    if (!lessonProgFor(trainerId, def.id).done) {
      const idx = lessonsFor(trainerId)?.indexOf(def) ?? -1;
      if (idx >= 0 && foundationsTrack(trainerId).current > idx) setFoundationsCurrent(trainerId, idx);
    }
  }
  lastRecord = { history: false };
  state.status = 'Solve discarded — not counted.';
  nextScramble();
}

// Track progress through a token sequence at the face level: tokens completed in
// order, plus the index of a token being applied with the wrong face -> red.
function progressOver(tokens: Move3x3[], moves: Move3x3[]): { done: number; errorIndex: number } {
  let ti = 0;
  let acc = 0;
  for (const mv of moves) {
    if (ti >= tokens.length) break;
    if (moveFace(mv) === moveFace(tokens[ti])) {
      acc = (acc + moveAmount(mv)) % 4;
      if (acc === moveAmount(tokens[ti]) % 4) {
        ti++;
        acc = 0;
      }
    } else {
      return { done: ti, errorIndex: ti }; // turned the wrong face
    }
  }
  return { done: ti, errorIndex: -1 };
}

// Scramble progress: how many leading tokens are done, and whether the cube is
// currently OFF the scramble path (a wrong turn) — so the next token can go red.
// Recovery-friendly: undoing the wrong move puts you back on the path.
// Mid double-turn (one quarter of the expected X2 done) is NOT an error yet —
// you're allowed to finish the second quarter before it goes green.
function scrambleStatus(): { done: number; offTrack: boolean } {
  const reached = state.scrambleReached;
  const cur = state.cube.encode();
  if (state.prefixEncodes[reached] === cur) return { done: reached, offTrack: false };
  const next = state.scrambleMoves[reached];
  if (next && next.includes('2')) {
    const target = state.prefixEncodes[reached + 1];
    const face = next[0];
    // One more quarter (either direction) of the expected face completes the double.
    if (applyMove(state.cube, face as Move3x3).encode() === target || applyMove(state.cube, `${face}'` as Move3x3).encode() === target) {
      return { done: reached, offTrack: false };
    }
  }
  return { done: reached, offTrack: true };
}

// Self-healing remaining moves to reach the scrambled target from wherever the
// cube is now: undo what's been done this scramble, then the original scramble,
// simplified. On-track this is the clean tail; off-track it prepends corrections.
function scrambleRemaining(): Move3x3[] {
  const phase = state.history.slice(state.scrambleBaseLen);
  return simplifyMoves(invertSeq(phase).concat(state.scrambleMoves));
}

function renderScramble(): HTMLElement {
  const box = el('div', 'scramble mono');
  const { done, offTrack } = scrambleStatus();
  state.scrambleMoves.forEach((mv, i) => {
    // done = green, the current token = next (highlighted) or red if off-track, rest plain.
    const cls = i < done ? 'tok done' : i === done ? (offTrack ? 'tok error' : 'tok next') : 'tok';
    const span = el('span', cls);
    span.textContent = mv;
    box.appendChild(span);
    box.appendChild(document.createTextNode(' '));
  });
  return box;
}

function renderSettings() {
  const close = () => { state.showSettings = false; render(); };
  const backdrop = el('div', 'modal-backdrop');
  const modal = el('div', 'modal');

  const title = el('div', 'm-title');
  title.appendChild(el('h3', '', 'Settings'));
  title.appendChild(iconBtn('✕', close));
  modal.appendChild(title);

  // Theme
  const themeGroup = el('div', 'group');
  themeGroup.appendChild(el('div', 'glabel', 'Theme'));
  const themeSeg = el('div', 'seg');
  for (const [id, label] of [['borland', 'Borland Pascal'], ['future', 'Holo']] as [string, string][])
    themeSeg.appendChild(segBtn(label, () => { setTheme(id); render(); }, getTheme() === id));
  themeGroup.appendChild(themeSeg);
  modal.appendChild(themeGroup);

  modal.appendChild(el('hr'));

  // Cube view — 3D orbit cube vs flat net (applies to every trainer, EO included)
  const viewGroup = el('div', 'group');
  viewGroup.appendChild(el('div', 'glabel', 'Cube view'));
  const viewSeg = el('div', 'seg');
  viewSeg.appendChild(segBtn('3D cube', () => setCubeView('3d'), cubeView === '3d'));
  viewSeg.appendChild(segBtn('Flat net', () => setCubeView('net'), cubeView === 'net'));
  viewGroup.appendChild(viewSeg);
  viewGroup.appendChild(el('div', 'hint', 'Drag or use the arrow keys to spin the 3D cube; the floating panels are back-views of the hidden faces. Flat net shows all six faces unfolded.'));
  modal.appendChild(viewGroup);

  modal.appendChild(el('hr'));

  // Solve orientation
  const orientGroup = el('div', 'group');
  orientGroup.appendChild(el('div', 'glabel', 'Solve orientation'));
  const orientSeg = el('div', 'seg');
  orientSeg.appendChild(segBtn('White-top', () => setOrient(false), !orientEnabled));
  orientSeg.appendChild(segBtn('Yellow-top (x2)', () => setOrient(true), orientEnabled));
  orientGroup.appendChild(orientSeg);
  orientGroup.appendChild(el('div', 'hint', 'Other trainers: scramble white-top / green-front, then solve in the chosen hold.'));
  modal.appendChild(orientGroup);

  modal.appendChild(el('hr'));

  // Full EO trainer — side-axis policy
  const eoGroup = el('div', 'group');
  eoGroup.appendChild(el('div', 'glabel', 'Full EO · side axis'));
  const eoSeg = el('div', 'seg');
  const eoModes: [EoAxisMode, string][] = [['detect', 'Detect'], ['gb', 'Blue front'], ['ro', 'Red front']];
  for (const [m, label] of eoModes) eoSeg.appendChild(segBtn(label, () => setEoAxisMode(m), eoAxisMode === m));
  eoGroup.appendChild(eoSeg);
  eoGroup.appendChild(el('div', 'hint', 'Full EO trainer only: practise EO against either side axis. Detect commits no axis — solve whichever side you like and it reads which off your finished cube. Blue/Red pin an axis up front. All are solved yellow-top.'));
  modal.appendChild(eoGroup);

  modal.appendChild(el('hr'));

  // 2×2×3 + EO trainer — hold/method (display-only; same solve, transposed notation)
  const beoGroup = el('div', 'group');
  beoGroup.appendChild(el('div', 'glabel', '2×2×3 + EO · method'));
  const beoSeg = el('div', 'seg');
  const beoModes: [BlockEoMethod, string][] = [['petrus', 'Petrus (back)'], ['apb', 'APB (left)']];
  for (const [m, label] of beoModes) beoSeg.appendChild(segBtn(label, () => setBlockEoMethod(m), blockEoMethod === m));
  beoGroup.appendChild(beoSeg);
  beoGroup.appendChild(el('div', 'hint', '2×2×3 + EO drill only: same solve, your hold. Petrus turns the block to the bottom-back (fix with R/L); APB keeps it on the left (fix with F/B). Always yellow-top / white-bottom; the long-side colour is random each scramble.'));
  modal.appendChild(beoGroup);

  modal.appendChild(el('hr'));

  // Cube
  const cubeGroup = el('div', 'group');
  cubeGroup.appendChild(el('div', 'glabel', 'Cube'));
  const macCount = Object.keys(getSavedMacs()).length;
  cubeGroup.appendChild(el('div', 'hint', macCount
    ? `${macCount} cube MAC${macCount === 1 ? '' : 's'} saved (one per cube). If a cube won’t connect, try forgetting them.`
    : 'No cube MAC saved. If auto-detection fails on connect, you’ll be asked for it once.'));
  const macRow = el('div', 'row');
  macRow.appendChild(btn('Forget saved MACs', () => { clearSavedMacs(); state.status = 'Saved cube MACs cleared.'; render(); }, 'btn ghost'));
  cubeGroup.appendChild(macRow);
  modal.appendChild(cubeGroup);

  modal.appendChild(el('hr'));

  // Cube event log (diagnostics) — raw MOVE/FACELETS/etc. from the cube.
  const logGroup = el('div', 'group');
  logGroup.appendChild(el('div', 'glabel', 'Cube event log'));
  const log = el('div', 'console');
  log.style.maxHeight = '160px';
  const lines = state.log ?? [];
  if (lines.length) for (const ln of lines.slice(-40)) { const l = el('div', 'cline'); l.appendChild(el('span', 'cmsg c-muted', ln)); log.appendChild(l); }
  else log.appendChild(el('div', 'cline', 'No cube events yet.'));
  logGroup.appendChild(log);
  const logRow = el('div', 'row');
  logRow.appendChild(btn('Clear log', () => { state.log = []; render(); }, 'btn ghost'));
  logGroup.appendChild(logRow);
  modal.appendChild(logGroup);

  const actions = el('div', 'm-actions');
  actions.appendChild(btn('Done', close, 'btn default'));
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  appEl.appendChild(backdrop);
}

// --- boot ---
store.runMigrations();
applyTheme(getTheme());
// Resume where you left off (e.g. start in Edge Orientation if that's what you
// were practising); fall back to the graded 2×2×2 course on first run.
const savedTrainer = store.getRaw('last-trainer');
state = freshTrainer(trainerById(savedTrainer ?? 'course222').id);
render();

// Hidden test hook (Manual Moves panel was removed from the UI). predictTarget
// exposes the live lookahead answer so the e2e checks can tap the right spot;
// identifyTarget/ideal do the same for the Foundations find-prompts and routes.
(window as unknown as { gym: unknown }).gym = {
  apply: (s: string) => handleManualMoves(s),
  // `apply` goes straight to step(), which is the one path the hands-free review
  // GESTURES don't run on — they hang off handleMove, the live BLE callback. So
  // the U/D advance and side-face retry gestures were unreachable from e2e and
  // could only be checked on hardware. `move` is that callback: raw MODEL moves,
  // one at a time, exactly as a cube reports them.
  move: (s: string) => { for (const m of s.trim().split(/\s+/)) if (m) handleMove(m); },
  predictTarget: () => (state.predict ? locatePieceNow(state.cube, state.predict.z.home) : null),
  identifyTarget: () => {
    const s = currentStep();
    if (!state.identify || !s) return null;
    const want = state.identify.stage === 0 ? 3 : 2;
    const piece = blockPiecesFor(s.canonicalMask).find((g) => g.length === want);
    return piece ? locatePieceNow(state.cube, piece) : null;
  },
  // MODEL-frame moves. `apply` translates display→model whenever the step
  // holds a rotated frame (the EO trainers), so feeding this straight back
  // would double-translate there — pass the DISPLAYED solution text instead.
  // Block steps hold no rotation by default, so round-tripping is safe.
  ideal: () => { const s = currentStep(); return s ? idealRoute(state.cube, s) : []; },
};

// Tick the live timer (timed mode) without a full re-render.
setInterval(() => {
  const t = document.getElementById('live-timer');
  if (t && state.trainMode === 'timed' && state.mode === 'solve' && state.solveStartMs != null && state.finishedMs == null) {
    t.textContent = fmtTime(Date.now() - state.solveStartMs);
  }
}, 100);
