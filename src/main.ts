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
import { nextFocusPiece, targetPieceStates, type FocusPiece } from './pieces.ts';
import { humanSolveFromState } from './human-solve.ts';
import { eoHint, blockHint } from './hints.ts';
import { sampleEoScramble } from './eo-scramble.ts';
import { genEoSafeScramble } from './steps.ts';
import { CORNER_FACELETS, NET_COORDS } from './blocks.ts';
import * as store from './storage.ts';
import { applyTheme, getTheme, resolveTheme, setTheme } from './theme.ts';
import { el, btn, renderCubeNet } from './dom.ts';
import {
  loadHistory, recordSolve, computeStats,
  loadCourse, saveCourse, courseTrack, courseCurrent, setCourseCurrent, recordCourse,
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
  const pieces = blockPiecesFor(s.canonicalMask);
  const placed = pieces.filter((g) => g.every((i) => f[i] === SOLVED_STR[i])).length;
  if (s.canonicalMask.eoFaceletIndices) {
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
function classifyCase(start: Cube3x3, s: StepDef, optimal: Move3x3[]): string {
  if (s.kind === 'eo') {
    const ax = eoStepAxis(s);
    const bad = ax ? axisBad(start, ax).count : start.EO.filter((g) => !g).length;
    return bad === 0 ? 'already oriented' : `${bad} bad edges`;
  }
  const homes = blockPiecesFor(s.canonicalMask);
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
  const unsolved = targetPieceStates(start, s.canonicalMask).filter((p) => !p.solved);
  if (!unsolved.length) return 'already built';
  if (unsolved.some((p) => p.coord[1] === 0)) return 'buried piece';
  if (unsolved.length >= 2) return 'pieces apart';
  return 'nearly there';
}

// Corner facelets as a set, for the "EO keeps no block" corner-blank test.
const CORNER_SET = new Set(CORNER_FACELETS);
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
  stepStartHistory: Move3x3[];
  stepStartCube: Cube3x3; // live cube state at the start of the current step (for state-based ideal/scoring)
  movesThisStep: Move3x3[];
  stepDone: boolean[];
  eoAxis: SolveAxis; // free-EO: which side axis EO is solved against this scramble
  eoCommitted: boolean; // free-EO: axis decided for this scramble (vs awaiting an ask-prompt)
  blockEoOrient: number; // 2×2×3+EO: rolled orientation (0..3) — the random long-side colour
  assist: { kind: 'nudge' | 'move' | 'ideal'; moves: Move3x3[]; focus: FocusPiece | null } | null;
  learn: { moves: Move3x3[]; baseLen: number } | null; // guided ideal replay
  lastResult: { step: string; used: number; optimal: number | null; yourMoves: Move3x3[]; idealMoves: Move3x3[]; case?: string; eo?: { gb: { len: number; bad: number }; ro: { len: number; bad: number } } } | null;
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
function steps(): StepDef[] {
  return trainer().steps;
}
function currentStep(): StepDef | null {
  return steps()[state.stepIndex] ?? null;
}

// Scramble lengths. SCRAMBLE_LEN is the uniform random-scramble length shared by
// the general block/drill paths AND the EO path (EO reaches it by padding its short
// bad-edge setup with EO-safe moves, so the mechanism differs but the length now
// matches — #3). The course path bands its own length by difficulty and is
// intentionally exempt.
const SCRAMBLE_LEN = 16;
const EO_SCRAMBLE_LEN = SCRAMBLE_LEN;

function makeScramble(base: Cube3x3, baseHistory: Move3x3[], stepsList: StepDef[], blockEoOrient = 0): Move3x3[] {
  const first = stepsList[0];
  // Course: generate a scramble whose optimal solution to the block lands in the
  // current level's difficulty band. Shorter random scrambles for easier bands.
  const tr = trainerById(state?.trainerId ?? '');
  if (tr.course) {
    const band = tr.course[Math.min(courseCurrent(tr.id), tr.course.length - 1)];
    const cfg = { ...first.solver, depthLimit: 16 };
    const len = band.max >= 99 ? 16 : Math.min(16, band.max + 4);
    let last = genScramble(len);
    for (let attempt = 0; attempt < 25; attempt++) {
      const scr = genScramble(len);
      last = scr;
      const cube = applyMoves(base, scr);
      if (isMaskSolvedState(cube, first.canonicalMask)) continue; // pre-solved
      const opt = (optimalToMask([...baseHistory, ...scr], first.canonicalMask, cfg) ?? []).length;
      const eff = opt === 0 ? 99 : opt; // 0 = deeper than the measure limit
      if (eff >= band.min && eff <= band.max) return scr;
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
    // (isBlockEoSolved), not the static canonical mask.
    const beo = isBlockEo(first);
    const prereq = beo ? blockEoPrereq(blockEoOrient) : first.prereqMask;
    const targetDone = (c: Cube3x3) => beo ? isBlockEoSolved(c, blockEoOrient) : isMaskSolvedState(c, first.canonicalMask);
    const buildCfg = { ...first.solver, depthLimit: 16 };
    for (let attempt = 0; attempt < 20; attempt++) {
      const scr = genScramble(SCRAMBLE_LEN);
      const build = optimalToMask([...baseHistory, ...scr], prereq, buildCfg) ?? [];
      const full = [...scr, ...build];
      const cube = applyMoves(base, full);
      if (isMaskSolvedState(cube, prereq) && !targetDone(cube)) return full;
    }
    const scr = genScramble(SCRAMBLE_LEN);
    return [...scr, ...(optimalToMask([...baseHistory, ...scr], prereq, buildCfg) ?? [])];
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
  // Blocks: a normal-length random scramble, rejecting any that pre-solve the step.
  for (let attempt = 0; attempt < 25; attempt++) {
    const moves = genScramble(SCRAMBLE_LEN);
    const targetHistory = [...baseHistory, ...moves];
    if (!isMaskSolvedState(applyMoves(newSolved(), targetHistory), first.canonicalMask)) return moves;
  }
  return genScramble(SCRAMBLE_LEN);
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
  // Roll the 2×2×3+EO orientation (random long-side colour) for this scramble; reuse
  // the current one when reproducing an explicit setup (retry/undo keeps the case).
  const blockEoOrient = explicit ? (state?.blockEoOrient ?? 0) : isBlockEo(t.steps[0]) ? randomBlockEoOrient() : 0;
  const moves = explicit ?? makeScramble(base, baseHistory, t.steps, blockEoOrient);
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
    stepStartHistory: [...baseHistory],
    stepStartCube: base,
    movesThisStep: [],
    stepDone: t.steps.map(() => false),
    eoAxis: lastEoAxis(),
    eoCommitted: false,
    blockEoOrient,
    assist: null,
    learn: null,
    lastResult: state?.lastResult ?? null,
    connected: state?.connected ?? false,
    battery: state?.battery ?? null,
    status: 'Apply the scramble to your cube. The cube view follows along.',
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
    if (state.solveStartMs == null) state.solveStartMs = Date.now(); // start timer on first move
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
    }
  }
}

function afterChange() {
  if (state.mode === 'scramble') {
    // Track the furthest on-track scramble position (monotonic across off-track
    // excursions): used for green progress and off-track red, recovery-friendly.
    const cur = state.cube.encode();
    for (let k = 0; k < state.prefixEncodes.length; k++) if (state.prefixEncodes[k] === cur) state.scrambleReached = k;
    if (state.cube.encode() === state.target.encode()) {
      state.mode = 'solve';
      state.stepStartHistory = [...state.history];
      state.stepStartCube = state.cube;
      state.movesThisStep = [];
      state.assist = null;
      state.solveStartMs = null; // timer starts on the first solve move
      state.solveStartLen = state.history.length;
      state.finishedMs = null;
      // Free-EO: decide (or prompt for) the side axis now that the scramble is set.
      const cs0 = currentStep();
      if (cs0 && isFreeEo(cs0)) commitEoAxisOnScramble();
      if (state.pendingLearn) {
        state.pendingLearn = false;
        if (isFreeEo(cs0)) state.eoCommitted = true; // a learn walkthrough locks the (provisional) axis
        beginLearnWalkthrough();
        return;
      }
      if (!isFreeEo(cs0)) state.status = `Scrambled! ${currentStep()?.label ?? ''} — find your solution.`;
    }
  } else {
    // Flash when a piece is placed / edge oriented (within the same step).
    const s = currentStep();
    if (s) {
      const key = `${state.trainerId}:${state.stepIndex}:${state.scrambleBaseLen}`;
      const u = placedUnits(state.cube, s);
      if (key === lastFlashKey && u > lastUnits) flashPieces();
      lastFlashKey = key;
      lastUnits = u;
    }
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
    const optimal = isBlockEo(s)
      ? solveFromState(state.stepStartCube, blockEoTarget(state.blockEoOrient), s.solver) ?? []
      : isFreeEo(s)
      ? solveFromState(state.stepStartCube, eoMaskForStep(s, state.eoAxis), s.solver) ?? []
      : solveFromState(state.stepStartCube, solvedMask, s.solver) ?? [];
    const used = htmCount(state.movesThisStep);
    const caseLabel = classifyCase(state.stepStartCube, s, optimal);
    state.lastResult = {
      step: s.label,
      used,
      optimal: optimal.length,
      yourMoves: [...state.movesThisStep],
      idealMoves: optimal,
      case: caseLabel,
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
    // Log to the Stats history. Record solve time only for single-step trainers
    // (EO / course / drills) — the journey timer isn't per-step meaningful.
    lastRecord = { history: false };
    const single = steps().length === 1;
    const ms = single && state.solveStartMs != null ? Date.now() - state.solveStartMs : undefined;
    recordSolve({ step: stepShort(s), used, optimal: optimal.length, ts: Date.now(), ms });
    lastRecord.history = true;
    state.stepDone[state.stepIndex] = true;
    state.assist = null;
    state.status = `${s.label} done!`;
    // Course: log this solve toward the current level's consistency target.
    const tr = trainer();
    if (tr.course) {
      lastRecord.trainerId = tr.id;
      lastRecord.level = courseCurrent(tr.id);
      const note = recordCourse(tr.id, tr.course.length, used - optimal.length);
      if (note) state.status = note;
    }
    if (state.stepIndex < steps().length - 1) {
      state.stepIndex += 1;
      state.stepStartHistory = [...state.history];
      state.stepStartCube = state.cube;
      state.movesThisStep = [];
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
  const inReview = state.mode === 'solve' && !state.learn && state.stepDone.every(Boolean);
  if (!inReview) { advanceRunMove = ''; advanceRunCount = 0; return false; }
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
  const inReview = state.mode === 'solve' && !state.learn && state.stepDone.every(Boolean);
  if (!inReview) { retryRunMove = ''; retryRunCount = 0; return false; }
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
    if (state.mode === 'solve') state.movesThisStep.push(...bridge);
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
  // In the solve frame the user types what they see (held frame); translate to model.
  const toks = solveFrame() ? toModelMoves(parseMoves(text), solveRotation()) : parseMoves(text);
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

// Start the guided ideal replay. Assumes the cube has physically returned to the
// start of the current step (stepStartCube); never fabricates the model. Reached
// either directly (no moves done this step) or via the pendingLearn return phase.
function beginLearnWalkthrough() {
  const s = currentStep();
  if (!s) return;
  const ideal = idealRoute(state.stepStartCube, s);
  if (ideal.length === 0) { state.status = 'Nothing to learn from here.'; render(); return; }
  state.movesThisStep = [];
  state.stepDone[state.stepIndex] = false;
  state.assist = null;
  state.learn = { moves: ideal, baseLen: state.history.length };
  // Show the method route alongside the theoretical optimal so the efficiency
  // gap is visible without teaching the awkward (back/bottom-heavy) optimal.
  const opt = idealLen(state.stepStartCube, s);
  const gap = ideal.length > opt ? ` (method route; theoretical best ${opt})` : '';
  state.status = `Learn by example: follow the ${ideal.length} highlighted moves for ${s.label}${gap}.`;
  render();
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
  const placed = blockPiecesFor(s.canonicalMask).filter((g) => g.every((i) => f[i] === SOLVED_STR[i])).length;
  const oriented = s.canonicalMask.eoFaceletIndices ? orientedEdges(cube, s) : 0;
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
  return humanSolveFromState(start, s.canonicalMask, s.solver) ?? [];
}
function idealLen(start: Cube3x3, s: StepDef): number {
  if (isBlockEo(s)) return solveFromState(start, blockEoTarget(state.blockEoOrient), s.solver)?.length ?? 0;
  if (isFreeEo(s)) return eoAxisOptimalLen(start, s, state.eoAxis);
  return solveFromState(start, s.canonicalMask, s.solver)?.length ?? 0;
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

/** The rotation list (model -> held frame) for the current solve display. Free-EO
 * always uses its chosen side axis (yellow-top); otherwise the legacy phase-flip. */
function solveRotation(): RotationMove[] {
  const s = currentStep();
  if (state.mode === 'solve') {
    if (isBlockEo(s)) return blockEoDisplayRots(blockEoMethod, state.blockEoOrient);
    if (isFreeEo(s)) return eoRot();
  }
  return orientEnabled ? (['x2'] as RotationMove[]) : [];
}
/** True when a solve-phase held frame is active (rotate view + translate notation). */
function solveFrame(): boolean {
  return state.mode === 'solve' && solveRotation().length > 0;
}
function disp(moves: Move3x3[]): Move3x3[] {
  return solveFrame() ? toDisplayMoves(moves, solveRotation()) : moves;
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

function assist(kind: 'nudge' | 'move' | 'ideal') {
  const s = currentStep();
  if (!s) return;
  // EO nudge: point at the misoriented edges (no move revealed).
  if (kind === 'nudge' && s.kind === 'eo') {
    const ax = eoStepAxis(s);
    const bad = ax ? axisBad(state.cube, ax).count : state.cube.EO.filter((g) => !g).length;
    state.assist = { kind: 'nudge', moves: [], focus: null };
    state.status = `${bad} bad edges highlighted — work out how to orient them.`;
    render();
    return;
  }
  const moves = continuation();
  if (moves.length === 0) { state.assist = null; state.status = 'Nothing to suggest from here.'; render(); return; }
  const focus = kind !== 'ideal' && s.kind === 'block' ? nextFocusPiece(state.cube, s.canonicalMask, moves) : null;
  const effective = kind === 'nudge' && !focus ? 'move' : kind;
  state.assist = { kind: effective, moves, focus };
  state.status =
    effective === 'nudge' ? `Hint: focus on the ${focus?.description ?? 'highlighted piece'} — pair and insert it.`
    : effective === 'move' ? `Next move: ${moves[0]}`
    : 'Showing the ideal for this step — press “Walk it through” to try it guided.';
  render();
}


// --- rendering ---

const STATUS_FLASH_MS = 3500;
let shownStatus = '';
let statusShownAt = 0;
let statusTimer: number | undefined;

function render() {
  const s = currentStep();
  const info = s ? progressInfo(state.cube, s) : { frac: 1, pct: 100, caption: '' };
  const allDone = state.stepDone.every(Boolean);
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

  const main = el('div', 'main');
  const left = el('div', 'col');
  left.appendChild(buildScramblePanel());
  left.appendChild(buildCubePanel(s));
  if (trainer().course) left.appendChild(buildCoursePanel());
  else if (steps().length > 1) left.appendChild(buildJourneyPanel());
  main.appendChild(left);

  const right = el('div', 'panel grow');
  if (state.showStats) buildStatsPane(right);
  else if (allDone) buildReviewPane(right);
  else if (s && state.learn) buildLearnPane(right, s);
  else buildSessionPane(right, s, info);
  main.appendChild(right);
  app.appendChild(main);

  appEl.replaceChildren(app);
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
  top.appendChild(iconBtn('⚙', () => { state.showSettings = true; render(); }));
  return top;
}

function catLabel(c: Category): string {
  return c === 'Blocks' ? 'Block building' : c === 'EO' ? 'Edge Orientation' : c;
}
// The current selection as one big sentence (Category · Trainer · Mode) with a
// Change button that reveals the full picker — sits just below the top bar.
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
  bar.appendChild(btn(state.showPicker ? 'Close' : 'Change', togglePicker, 'btn'));
  return bar;
}
function buildToolbar(): HTMLElement {
  const tb = el('div', 'toolbar');
  // Category (EO / Block building / Journey)
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
function buildScramblePanel(): HTMLElement {
  const p = el('div', 'panel');
  p.appendChild(el('div', 'panel-hd', 'Scramble'));
  const row = el('div', 'row');
  row.style.marginTop = '10px';
  if (state.mode === 'scramble') {
    // Only show the scramble while applying it — once solving starts it's hidden
    // (otherwise it's the optimal solution reversed; e.g. EO scramble = inverse).
    p.appendChild(renderScramble());
    const { offTrack } = scrambleStatus();
    const rem = scrambleRemaining();
    if (rem.length) {
      const cap = el('div', 'meter-cap');
      cap.innerHTML = `next <span class="accent-fg">${rem[0]}</span>${offTrack ? ' · corrects a wrong turn' : ''} · ${rem.length} to go · solving auto-starts when matched`;
      p.appendChild(cap);
    } else {
      p.appendChild(el('div', 'meter-cap', 'Apply the scramble from your cube — solving auto-starts when matched.'));
    }
    row.appendChild(btn('Reset Cube', resetToSolved, 'btn'));
  } else {
    p.appendChild(el('div', 'meter-cap', 'Scramble hidden while you solve — press “Next scramble” for a fresh one.'));
    row.appendChild(btn('Next scramble', nextScramble, 'btn'));
    row.appendChild(btn('Reset Cube', resetToSolved, 'btn'));
  }
  // Sync = read the cube's real state and correct the model (for BLE drift).
  row.appendChild(btn('Sync to Cube state', syncCube, 'btn'));
  p.appendChild(row);
  return p;
}

function buildCubePanel(s: StepDef | null): HTMLElement {
  const p = el('div', 'panel grow');
  p.appendChild(el('div', 'panel-hd', 'Cube view'));
  const wrap = el('div', 'cube-wrap');
  let highlight: Set<number> | null = null;
  let note = '';
  if (state.assist) {
    if (state.assist.kind === 'ideal') { highlight = new Set(s!.canonicalMask.solvedFaceletIndices); note = 'highlighted: the target facelets'; }
    else if (state.assist.kind === 'nudge' && s?.kind === 'eo') {
      // Bad-edge stickers are model-frame (computed without rotating the state),
      // so they go through the same rotateHighlight as every other highlight.
      const ax = eoStepAxis(s);
      highlight = new Set(ax ? axisBad(state.cube, ax).stickers : badEdgeStickers(state.cube));
      note = 'highlighted: the misoriented edges';
    }
    else if (state.assist.focus) { highlight = new Set(state.assist.focus.current); note = `highlighted: the ${state.assist.focus.description}`; }
  }
  if (solveFrame() && highlight) highlight = rotateHighlight(highlight, solveRotation());
  // Blank the corners for any EO step that keeps no block — corner state is
  // irrelevant to edge orientation, so it's hidden for Full EO, EOLine and
  // EOCross alike. A block-preserving EO step (Petrus / the eo123·eo223 drills)
  // has corner facelets in its target, so its corners stay visible.
  const pureEo = s?.kind === 'eo' && !s.canonicalMask.solvedFaceletIndices.some((i) => CORNER_SET.has(i));
  const blank = pureEo ? new Set(CORNER_FACELETS) : null;
  const facelets = solveFrame() ? rotatedFacelets(state.cube, solveRotation()) : faceletString(state.cube);
  wrap.appendChild(renderCubeNet(facelets, highlight, blank));
  // Transient status toast over the cube (fades via CSS; see STATUS_FLASH_MS).
  if (state.status && Date.now() - statusShownAt < STATUS_FLASH_MS) {
    wrap.appendChild(el('div', 'cube-toast', state.status));
  }
  p.appendChild(wrap);
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
  const recent = track.levels[cur]?.recent ?? [];
  const clean = recent.filter((w) => w <= COURSE_TOLERANCE).length;
  p.appendChild(el('div', 'meter-cap',
    recent.length
      ? `${clean}/${recent.length} clean (≤ +${COURSE_TOLERANCE}) · clear at ${Math.round(COURSE_STAR_RATES[0] * 100)}% over ${COURSE_WINDOW}`
      : `solve ${COURSE_WINDOW} here to be graded · "clean" = within +${COURSE_TOLERANCE} of optimal`));
  return p;
}

function buildJourneyPanel(): HTMLElement {
  const p = el('div', 'panel');
  p.appendChild(el('div', 'panel-hd', 'Journey'));
  const chips = el('div', 'chips');
  const solving = state.mode === 'solve';
  steps().forEach((st, i) => {
    const isCur = solving && i === state.stepIndex;
    const cls = state.stepDone[i] ? 'done' : isCur ? 'active' : '';
    const c = el('div', `chip ${cls}`);
    c.appendChild(el('div', 'nm', `${i + 1}. ${st.label}`));
    c.appendChild(el('div', 'st', state.stepDone[i] ? '✓ done' : isCur ? '» in progress' : '· upcoming'));
    chips.appendChild(c);
  });
  p.appendChild(chips);
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
  const solving = state.mode === 'solve' && !!s;
  const actions = el('div', 'row');
  actions.style.marginBottom = '14px';
  actions.appendChild(btn('Hint', () => assist('nudge'), 'btn default', !solving));
  actions.appendChild(btn('Next move', () => assist('move'), 'btn', !solving));
  actions.appendChild(btn('Show ideal', () => assist('ideal'), 'btn', !solving));
  // Once the ideal is revealed (assist === 'ideal'), offer to try it: "Walk it
  // through" hands the cube back to the step start, then guides the moves. Only
  // surfaced while solving and only when there's actually a solution shown.
  if (solving && state.assist?.kind === 'ideal') {
    actions.appendChild(btn('Walk it through', enterLearn, 'btn default'));
  }
  actions.appendChild(btn('Retry', tryAgain, 'btn', !solving));
  return actions;
}

function buildStepMeter(s: StepDef | null, info: { frac: number; caption: string }, ideal: number | null): HTMLElement {
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

function coachLine(parent: HTMLElement, tag: string, cls: string, msg: string) {
  const l = el('div', 'cline');
  if (tag) l.appendChild(el('span', 'ctag', `[${tag}]`));
  const m = el('span', `cmsg ${cls}`);
  m.textContent = msg;
  l.appendChild(m);
  parent.appendChild(l);
}

// Output console: shows requested help only (Hint/Next move/Show ideal), not auto-answers.
function buildCoachBody(s: StepDef | null): HTMLElement {
  const c = el('div', 'console');
  if (!s) { coachLine(c, '', 'c-muted', 'No active step.'); return c; }
  if (state.mode === 'scramble') { coachLine(c, '', 'c-muted', 'Apply the scramble — solving auto-starts when matched.'); return c; }
  const a = state.assist;
  if (!a) { coachLine(c, '', 'c-muted', 'Press Hint, Next move or Show ideal when you want help.'); return c; }
  if (a.kind === 'nudge') {
    // Rule-based recognition + technique (no exact moves — that's Next move / Show ideal).
    const ax = eoStepAxis(s);
    const h = s.kind === 'eo' ? (ax ? freeEoHint(axisBad(state.cube, ax).count) : eoHint(state.cube)) : blockHint(a.focus, true);
    if (h.name) coachLine(c, 'pattern', 'c-good', h.name);
    for (const ln of h.lines) coachLine(c, '', 'c-coach', ln);
  } else if (a.kind === 'move') {
    coachLine(c, 'hint', 'c-hint', `next ▸ ${disp([a.moves[0]])[0]}`);
  } else if (a.kind === 'ideal') {
    coachLine(c, 'solver', 'c-good', `solution ▸ ${disp(a.moves).join(' ')}`);
  }
  if (resolveTheme(getTheme()) === 'matrix') {
    const l = el('div', 'cline');
    l.appendChild(el('span', 'ctag', '>'));
    l.appendChild(el('span', 'cursor'));
    c.appendChild(l);
  }
  return c;
}

// --- right pane: all-done review ---
function buildReviewPane(right: HTMLElement) {
  right.appendChild(el('div', 'panel-hd', 'Solved'));
  right.appendChild(el('div', 'solved-banner', '🎉 Solved! Here’s how you did.'));
  const r = state.lastResult;
  if (r) {
    const yours = disp(simplifyMoves(r.yourMoves));
    const extra = r.optimal != null ? r.used - r.optimal : 0;
    const verdict = r.optimal == null ? '' : extra <= 0 ? '🏆 optimal!' : extra <= 2 ? '👍 very efficient' : extra <= 5 ? 'good — room to tighten' : 'lots of room to improve';
    if (r.case) right.appendChild(el('div', 'meter-cap', `case: ${r.case}`));
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
function buildLearnPane(right: HTMLElement, s: StepDef) {
  right.appendChild(el('div', 'panel-hd', `Learn — ${s.label}`));
  right.appendChild(el('div', 'blurb', 'Follow the ideal move by move. Each turn goes green; a wrong turn shows red.'));
  const { done, errorIndex } = progressOver(state.learn!.moves, state.history.slice(state.learn!.baseLen));
  const shown = disp(state.learn!.moves);
  const box = el('div', 'movelist');
  box.style.marginTop = '12px';
  shown.forEach((mv, i) => {
    const cls = i < done ? 'tok done' : i === errorIndex ? 'tok error' : i === done ? 'tok next' : 'tok';
    const sp = el('span', cls);
    sp.textContent = mv;
    box.appendChild(sp);
  });
  right.appendChild(box);
  if (done < shown.length) right.appendChild(el('div', 'meter-cap', `next move: ${shown[done]} (${done}/${shown.length})`));
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
let lastRecord: { history: boolean; trainerId?: string; level?: number } = { history: false };
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
  for (const [id, label] of [['borland', 'Borland Pascal'], ['dark', 'Modern Dark'], ['matrix', 'Matrix'], ['future', 'Future']] as [string, string][])
    themeSeg.appendChild(segBtn(label, () => { setTheme(id); render(); }, getTheme() === id));
  themeGroup.appendChild(themeSeg);
  modal.appendChild(themeGroup);

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
  eoGroup.appendChild(el('div', 'hint', 'Full EO trainer only: practise EO against either side axis. Detect commits no axis — solve whichever side you like and it reads which off your finished cube. Ask prompts each scramble; Auto picks the shorter solution; Blue/Red pin an axis. Both are solved yellow-top.'));
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

// Hidden test hook (Manual Moves panel was removed from the UI).
(window as unknown as { gym: unknown }).gym = { apply: (s: string) => handleManualMoves(s) };

// Tick the live timer (timed mode) without a full re-render.
setInterval(() => {
  const t = document.getElementById('live-timer');
  if (t && state.trainMode === 'timed' && state.mode === 'solve' && state.solveStartMs != null && state.finishedMs == null) {
    t.textContent = fmtTime(Date.now() - state.solveStartMs);
  }
}, 100);
