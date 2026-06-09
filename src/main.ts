import './style.css';
import {
  Cube3x3,
  applyMove,
  applyMoves,
  faceletString,
  newSolved,
  optimalToMask,
  parseMoves,
  maskProgressState,
  isMaskSolvedState,
  cubeFromFacelets,
  findBridge,
  type Move3x3,
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
import { eoHint, blockHint } from './hints.ts';
import { sampleEoScramble } from './eo-scramble.ts';
import { genEoSafeScramble } from './steps.ts';
import { CORNER_FACELETS, NET_COORDS } from './blocks.ts';

const SOLVED_ENCODE = newSolved().encode();
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
  const f = faceletString(cube);
  const pieces = blockPiecesFor(s.canonicalMask);
  const placed = pieces.filter((g) => g.every((i) => f[i] === SOLVED_STR[i])).length;
  if (s.canonicalMask.eoFaceletIndices) {
    const oriented = cube.EO.filter(Boolean).length;
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
    const bad = start.EO.filter((g) => !g).length;
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

// EO orbit facelets (mirror the engine's getEO) so we can highlight bad edges.
const EO_PRIMARY = [1, 3, 5, 7, 32, 24, 26, 30, 46, 48, 50, 52];
const EO_SECONDARY = [19, 10, 16, 13, 21, 23, 27, 29, 37, 34, 40, 43];
function badEdgeStickers(c: Cube3x3): number[] {
  const out: number[] = [];
  c.EO.forEach((good, i) => {
    if (!good) out.push(EO_PRIMARY[i], EO_SECONDARY[i]);
  });
  return out;
}
import { ORIENT_LABEL, rotateHighlight, rotatedFacelets, toDisplayMoves, toModelMoves } from './orient.ts';
import { CubeManager, clearSavedMac, getSavedMac } from './bluetooth.ts';

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
  movesThisStep: Move3x3[];
  stepDone: boolean[];
  assist: { kind: 'nudge' | 'move' | 'ideal'; moves: Move3x3[]; focus: FocusPiece | null } | null;
  learn: { moves: Move3x3[]; baseLen: number } | null; // guided ideal replay
  lastResult: { step: string; used: number; optimal: number | null; yourMoves: Move3x3[]; idealMoves: Move3x3[]; case?: string } | null;
  connected: boolean;
  battery: number | null;
  status: string;
  showSettings: boolean;
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

function makeScramble(base: Cube3x3, baseHistory: Move3x3[], stepsList: StepDef[]): Move3x3[] {
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
    const prereq = first.prereqMask;
    const buildCfg = { ...first.solver, depthLimit: 16 };
    for (let attempt = 0; attempt < 20; attempt++) {
      const scr = genScramble(16);
      const build = optimalToMask([...baseHistory, ...scr], prereq, buildCfg) ?? [];
      const full = [...scr, ...build];
      const cube = applyMoves(base, full);
      if (isMaskSolvedState(cube, prereq) && !isMaskSolvedState(cube, first.canonicalMask)) return full;
    }
    const scr = genScramble(16);
    return [...scr, ...(optimalToMask([...baseHistory, ...scr], prereq, buildCfg) ?? [])];
  }
  if (first.kind === 'eo') {
    const eoSeq = sampleEoScramble();
    return base.encode() === SOLVED_ENCODE ? [...genEoSafeScramble(10), ...eoSeq] : eoSeq;
  }
  // Blocks: a normal-length random scramble, rejecting any that pre-solve the step.
  for (let attempt = 0; attempt < 25; attempt++) {
    const moves = genScramble(16);
    const targetHistory = [...baseHistory, ...moves];
    if (!isMaskSolvedState(applyMoves(newSolved(), targetHistory), first.canonicalMask)) return moves;
  }
  return genScramble(16);
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
  const moves = explicit ?? makeScramble(base, baseHistory, t.steps);
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
    movesThisStep: [],
    stepDone: t.steps.map(() => false),
    assist: null,
    learn: null,
    lastResult: state?.lastResult ?? null,
    connected: state?.connected ?? false,
    battery: state?.battery ?? null,
    status: 'Apply the scramble to your cube. The cube view follows along.',
    showSettings: false,
    rightTab: state?.rightTab ?? 'coach',
    log: state?.log ?? [],
    lastError: state?.lastError ?? '',
  };
}

function freshTrainer(trainerId: string): State {
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
      state.movesThisStep = [];
      state.assist = null;
      state.solveStartMs = null; // timer starts on the first solve move
      state.solveStartLen = state.history.length;
      state.finishedMs = null;
      if (state.pendingLearn) {
        state.pendingLearn = false;
        enterLearn();
        return;
      }
      state.status = `Scrambled! ${currentStep()?.label ?? ''} — find your solution.`;
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

function stepSolved(s: StepDef): boolean {
  return isMaskSolvedState(state.cube, s.canonicalMask);
}

function checkStepCompletion() {
  const s = currentStep();
  if (!s || state.stepDone[state.stepIndex]) return;
  if (stepSolved(s)) {
    // Without a trustworthy history (post hard-resync) we can't score this step.
    const optimal = state.historyValid
      ? optimalToMask(state.stepStartHistory, s.canonicalMask, s.solver) ?? []
      : [];
    const used = htmCount(state.movesThisStep);
    const caseLabel = state.historyValid ? classifyCase(applyMoves(newSolved(), state.stepStartHistory), s, optimal) : '';
    state.lastResult = state.historyValid
      ? {
          step: s.label,
          used,
          optimal: optimal.length,
          yourMoves: [...state.movesThisStep],
          idealMoves: optimal,
          case: caseLabel,
        }
      : null;
    // Log to the Stats history (only when we have a trustworthy ideal to compare to).
    if (state.historyValid) recordSolve({ step: stepShort(s), used, optimal: optimal.length, ts: Date.now() });
    state.stepDone[state.stepIndex] = true;
    state.assist = null;
    state.status = `${s.label} done!`;
    // Course: log this solve toward the current level's average-efficiency target.
    const tr = trainer();
    if (state.historyValid && tr.course) {
      const note = recordCourse(tr.id, tr.course.length, used - optimal.length);
      if (note) state.status = note;
    }
    if (state.stepIndex < steps().length - 1) {
      state.stepIndex += 1;
      state.stepStartHistory = [...state.history];
      state.movesThisStep = [];
    }
  }
}

function handleMove(move: string) {
  step(move as Move3x3);
  render();
}

// Resync the model to the cube's true state. Only act on an *explicit* Sync —
// gan-web-bluetooth requests facelets in the background to validate its own move
// stream, and those snapshots can lag a fraction behind the live moves. Acting on
// them would "correct" the model backwards by a move (undoing a turn you just made,
// so progress never advances). The Sync button sets awaitingSync first.
let awaitingSync = false;
function handleFacelets(kociemba: string) {
  if (!awaitingSync) return;
  awaitingSync = false;
  let trueCube: Cube3x3;
  try {
    trueCube = cubeFromFacelets(kociembaToNet(kociemba));
  } catch {
    return;
  }
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
  // Large divergence: restart cleanly with the cube's TRUE state as the base — a
  // fresh scramble applied from where the cube actually is. This keeps the picture
  // and the scramble/progress consistent (hints stay gated since we can't rebuild
  // the from-solved history).
  state = startScramble(trueCube, []);
  state.status = 'Synced to your cube — fresh scramble from its current state.';
  render();
}
function handleManualMoves(text: string) {
  // In the solve frame the user types what they see (held frame); translate to model.
  const toks = solveFrame() ? toModelMoves(parseMoves(text)) : parseMoves(text);
  for (const tok of toks) step(tok);
  render();
}

// --- actions ---

const cube = new CubeManager({
  onMove: (m) => handleMove(m),
  onFacelets: (f) => handleFacelets(f),
  onBattery: (b) => { state.battery = b; render(); },
  onConnect: (name) => { state.connected = true; state.lastError = ''; state.status = `Connected to ${name} — reading cube state…`; awaitingSync = true; cube.requestFacelets(); render(); },
  onDisconnect: () => { state.connected = false; state.status = 'Cube disconnected.'; render(); },
  onError: (e) => { state.lastError = String((e as Error)?.message ?? e); state.status = `Bluetooth error: ${state.lastError}`; render(); },
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
function selectTrainerFlat(id: string) {
  freshTrainerInPlace(id);
}
// Switching category jumps to the first trainer in that category.
function selectCategory(c: Category) {
  const first = trainersIn(c)[0];
  if (first) freshTrainerInPlace(first.id);
}
function freshTrainerInPlace(id: string) {
  state = freshTrainer(id);
  render();
}
// Hints/rewind/efficiency all need a trustworthy move history (moves from solved).
// After a hard resync that can't be bridged, history is unknown — block those
// actions and point the user at a fresh scramble (which rebuilds valid history).
function requireHistory(): boolean {
  if (state.historyValid) return true;
  state.status = 'Move history was lost on resync — press “Next scramble” for fresh hints.';
  render();
  return false;
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
  render();
}
function applyScrambleNow() {
  state.cube = state.target.clone();
  state.history = [...state.history.slice(0, state.scrambleBaseLen), ...state.scrambleMoves];
  afterChange();
  render();
}
function rewindStep() {
  if (!requireHistory()) return;
  state.cube = applyMoves(newSolved(), state.stepStartHistory);
  state.history = [...state.stepStartHistory];
  state.movesThisStep = [];
  state.stepDone[state.stepIndex] = false;
  state.assist = null;
  state.learn = null;
  state.status = 'Step rewound to its starting state.';
  render();
}

function enterLearn() {
  if (!requireHistory()) return;
  const s = currentStep();
  if (!s) return;
  const ideal = optimalToMask(state.stepStartHistory, s.canonicalMask, s.solver) ?? [];
  if (ideal.length === 0) { state.status = 'Nothing to learn from here.'; render(); return; }
  // rewind to the start of this case, then guide through the ideal
  state.cube = applyMoves(newSolved(), state.stepStartHistory);
  state.history = [...state.stepStartHistory];
  state.movesThisStep = [];
  state.stepDone[state.stepIndex] = false;
  state.assist = null;
  state.learn = { moves: ideal, baseLen: state.history.length };
  state.status = `Learn by example: follow the ${ideal.length} highlighted moves for ${s.label}.`;
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

// --- theming ---
const THEME_KEY = 'cube-trainer.theme';
function getTheme(): string {
  return localStorage.getItem(THEME_KEY) || 'borland';
}
function setTheme(t: string) {
  localStorage.setItem(THEME_KEY, t);
  applyTheme(t);
}
const THEMES = ['dark', 'borland', 'matrix'];
function resolveTheme(t: string): string {
  return THEMES.includes(t) ? t : 'dark';
}
function applyTheme(t: string) {
  // data-theme on <html> drives the token blocks in style.css.
  document.documentElement.dataset.theme = resolveTheme(t);
  ensureMatrixRain();
}

// --- Matrix theme: falling digital rain (lifecycle-managed canvas) ---
let rainRAF = 0;
let rainResize: (() => void) | null = null;
function ensureMatrixRain() {
  const on = resolveTheme(getTheme()) === 'matrix';
  const exists = !!document.getElementById('matrix-rain');
  if (on && !exists) startRain();
  else if (!on && exists) stopRain();
}
function startRain() {
  const canvas = document.createElement('canvas');
  canvas.id = 'matrix-rain';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ0123456789ABCDEF<>*+=:.';
  const fs = 16;
  let cols = 0;
  let drops: number[] = [];
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    cols = Math.ceil(canvas.width / fs);
    drops = Array.from({ length: cols }, () => Math.random() * -50);
  };
  resize();
  rainResize = resize;
  window.addEventListener('resize', resize);
  let last = 0;
  const frame = (t: number) => {
    rainRAF = requestAnimationFrame(frame);
    if (t - last < 55) return; // ~18fps, gentle on the CPU
    last = t;
    ctx.fillStyle = 'rgba(0,6,0,0.10)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${fs}px 'Share Tech Mono', monospace`;
    for (let i = 0; i < cols; i++) {
      const y = drops[i] * fs;
      ctx.fillStyle = Math.random() < 0.03 ? '#c6ffd6' : '#00ff66';
      ctx.fillText(glyphs[Math.floor(Math.random() * glyphs.length)], i * fs, y);
      if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }
  };
  rainRAF = requestAnimationFrame(frame);
}
function stopRain() {
  if (rainRAF) cancelAnimationFrame(rainRAF);
  rainRAF = 0;
  if (rainResize) { window.removeEventListener('resize', rainResize); rainResize = null; }
  document.getElementById('matrix-rain')?.remove();
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
  const oriented = s.canonicalMask.eoFaceletIndices ? cube.EO.filter(Boolean).length : 0;
  return placed + oriented;
}
let lastUnits = 0;
let lastFlashKey = '';

// --- solving orientation (phase-flip; static x2 for now) ---
const ORIENT_KEY = 'cube-trainer.orient';
let orientEnabled = localStorage.getItem(ORIENT_KEY) === '1';
function setOrient(b: boolean) {
  orientEnabled = b;
  localStorage.setItem(ORIENT_KEY, b ? '1' : '0');
  render();
}


/** True when the solve-phase held frame is active (rotate view + translate notation). */
function solveFrame(): boolean {
  return orientEnabled && state.mode === 'solve';
}
function disp(moves: Move3x3[]): Move3x3[] {
  return solveFrame() ? toDisplayMoves(moves) : moves;
}

function continuation(): Move3x3[] {
  const s = currentStep();
  if (!s || !state.historyValid) return [];
  return optimalToMask(state.history, s.canonicalMask, s.solver) ?? [];
}
function idealFromStart(): number | null {
  const s = currentStep();
  if (!s || !state.historyValid) return null;
  const m = optimalToMask(state.stepStartHistory, s.canonicalMask, s.solver);
  return m ? m.length : null;
}

function assist(kind: 'nudge' | 'move' | 'ideal') {
  if (!requireHistory()) return;
  const s = currentStep();
  if (!s) return;
  // EO nudge: point at the misoriented edges (no move revealed).
  if (kind === 'nudge' && s.kind === 'eo') {
    const bad = s.canonicalMask ? state.cube.EO.filter((g) => !g).length : 0;
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
    effective === 'nudge' ? `Nudge: focus on the ${focus?.description ?? 'highlighted piece'} — pair and insert it.`
    : effective === 'move' ? `Next move: ${moves[0]}`
    : 'Showing the full solution for this step.';
  render();
}


// --- rendering ---

function render() {
  const s = currentStep();
  const info = s ? progressInfo(state.cube, s) : { frac: 1, pct: 100, caption: '' };
  const allDone = state.stepDone.every(Boolean);
  document.documentElement.dataset.theme = resolveTheme(getTheme());

  const app = document.createDocumentFragment();
  app.appendChild(buildTopBar());
  app.appendChild(buildToolbar());

  const main = el('div', 'main');
  const left = el('div', 'col');
  left.appendChild(buildScramblePanel());
  left.appendChild(buildCubePanel(s));
  if (trainer().course) left.appendChild(buildCoursePanel());
  else if (steps().length > 1) left.appendChild(buildJourneyPanel());
  main.appendChild(left);

  const right = el('div', 'panel grow');
  if (allDone) buildReviewPane(right);
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
function tabBtn(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
  return btn(label, onClick, `tab${active ? ' active' : ''}`);
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
  top.appendChild(el('span', 'top-meta', `${trainer().label} · ${state.trainMode === 'timed' ? 'Timed' : 'Efficiency'}`));

  // Cube pill (click = connect/disconnect)
  const battery = state.battery != null ? ` · ${state.battery}%` : '';
  const pill = el('span', `cube-pill ${state.connected ? '' : 'off'}`);
  pill.appendChild(el('span', 'dot'));
  pill.appendChild(document.createTextNode(state.connected ? `${cube.deviceName || 'Cube'}${battery}` : 'No cube'));
  pill.style.cursor = 'pointer';
  pill.title = state.connected ? 'Disconnect' : 'Connect cube';
  pill.addEventListener('click', toggleConnect);
  top.appendChild(pill);

  // Theme toggle
  const themeSeg = el('div', 'seg');
  for (const [id, label] of [['borland', 'Borland'], ['dark', 'Dark'], ['matrix', 'Matrix']] as [string, string][])
    themeSeg.appendChild(segBtn(label, () => { setTheme(id); render(); }, getTheme() === id));
  top.appendChild(themeSeg);

  if (state.connected) top.appendChild(iconBtn('Sync', () => { awaitingSync = true; cube.requestFacelets(); state.status = 'Reading cube state…'; render(); }));
  top.appendChild(iconBtn('⚙', () => { state.showSettings = true; render(); }));
  return top;
}

function catLabel(c: Category): string {
  return c === 'Blocks' ? 'Block building' : c;
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
    row.appendChild(btn('Apply for me', applyScrambleNow, 'btn'));
    row.appendChild(btn('Reset', resetToSolved, 'btn'));
  } else {
    p.appendChild(el('div', 'meter-cap', 'Scramble hidden while you solve — press “Next scramble” for a fresh one.'));
    row.appendChild(btn('Next scramble', nextScramble, 'btn'));
    row.appendChild(btn('Reset', resetToSolved, 'btn'));
  }
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
    else if (state.assist.kind === 'nudge' && s?.kind === 'eo') { highlight = new Set(badEdgeStickers(state.cube)); note = 'highlighted: the misoriented edges'; }
    else if (state.assist.focus) { highlight = new Set(state.assist.focus.current); note = `highlighted: the ${state.assist.focus.description}`; }
  }
  if (solveFrame() && highlight) highlight = rotateHighlight(highlight);
  // Blank the corners only for *pure* EO (no block kept). A block-preserving EO
  // step (e.g. Petrus) needs its corners visible.
  const pureEo = s?.kind === 'eo' && s.canonicalMask.solvedFaceletIndices.length <= 6;
  const blank = pureEo ? new Set(CORNER_FACELETS) : null;
  const facelets = solveFrame() ? rotatedFacelets(state.cube) : faceletString(state.cube);
  wrap.appendChild(renderCubeNet(facelets, highlight, blank));
  p.appendChild(wrap);
  const holdNote = s?.hold
    ? s.hold
    : `${orientEnabled && state.mode === 'solve' ? `hold ${ORIENT_LABEL}` : 'hold white-up / green-front'}${s ? ` · ${s.label} target` : ''}`;
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

// --- right pane: session (tabs + actions on top + meter + output console) ---
function buildSessionPane(right: HTMLElement, s: StepDef | null, info: { frac: number; caption: string }) {
  const ideal = idealFromStart();
  const tabs = el('div', 'panel-tabs');
  tabs.appendChild(tabBtn('Coach', state.rightTab === 'coach', () => { state.rightTab = 'coach'; render(); }));
  tabs.appendChild(tabBtn('Stats', state.rightTab === 'stats', () => { state.rightTab = 'stats'; render(); }));
  tabs.appendChild(el('div', 'spacer'));
  if (ideal != null) tabs.appendChild(el('span', 'tag', `ideal ${ideal}`));
  right.appendChild(tabs);

  if (state.rightTab === 'stats') { right.appendChild(buildStatsBody()); return; }

  right.appendChild(buildActions(s));
  right.appendChild(buildStepMeter(s, info, ideal));
  right.appendChild(buildCoachBody(s));
}

function buildActions(s: StepDef | null): HTMLElement {
  const solving = state.mode === 'solve' && !!s;
  const actions = el('div', 'row');
  actions.style.marginBottom = '14px';
  actions.appendChild(btn('Nudge', () => assist('nudge'), 'btn default', !solving));
  actions.appendChild(btn('Reveal', () => assist('move'), 'btn', !solving));
  actions.appendChild(btn('Ideal', () => assist('ideal'), 'btn', !solving));
  actions.appendChild(btn('Learn', enterLearn, 'btn', !solving));
  actions.appendChild(btn('Rewind', rewindStep, 'btn ghost', !solving));
  return actions;
}

function buildStepMeter(s: StepDef | null, info: { frac: number; caption: string }, ideal: number | null): HTMLElement {
  const wrap = el('div', 'step-meter');
  const used = htmCount(state.movesThisStep);
  const hd = el('div', 'dock-hd');
  hd.appendChild(el('span', '', s ? `Step · ${s.label}` : 'No step'));
  if (state.trainMode === 'timed') {
    const txt = state.solveStartMs == null ? '0:00.00' : fmtTime((state.finishedMs ?? Date.now()) - state.solveStartMs);
    const t = el('span', 'pill', txt);
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

// Output console: shows requested hints only (Nudge/Reveal/Ideal), not auto-answers.
function buildCoachBody(s: StepDef | null): HTMLElement {
  const c = el('div', 'console');
  if (!s) { coachLine(c, '', 'c-muted', 'No active step.'); return c; }
  if (state.mode === 'scramble') { coachLine(c, '', 'c-muted', 'Apply the scramble — solving auto-starts when matched.'); return c; }
  if (!state.historyValid) { coachLine(c, 'hint', 'c-hint', 'Move history lost on resync — press “Next scramble”.'); return c; }
  const a = state.assist;
  if (!a) { coachLine(c, '', 'c-muted', 'Press Nudge, Reveal or Ideal when you want help.'); return c; }
  if (a.kind === 'nudge') {
    // Rule-based recognition + technique (no exact moves — that's Reveal/Ideal).
    const h = s.kind === 'eo' ? eoHint(state.cube) : blockHint(a.focus, true);
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
  }
  if (state.trainMode === 'timed' && state.solveStartMs != null && state.finishedMs != null) {
    const ms = state.finishedMs - state.solveStartMs;
    const moves = htmCount(state.history.slice(state.solveStartLen));
    const tps = ms > 0 ? (moves / (ms / 1000)).toFixed(1) : '–';
    right.appendChild(el('div', 'coach', `⏱ ${fmtTime(ms)} · ${moves} moves · ${tps} TPS`));
  }
  const row = el('div', 'row');
  row.style.marginTop = '14px';
  row.appendChild(btn('Learn the ideal', learnFromReview, 'btn default'));
  row.appendChild(btn('Try again', tryAgain, 'btn'));
  row.appendChild(btn('Next scramble', nextScramble, 'btn ghost'));
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
  row.appendChild(btn('Stop walkthrough', stopLearn, 'btn ghost'));
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

// --- stats persistence ---
const HISTORY_KEY = 'cube-trainer.history';
interface HistRec { step: string; used: number; optimal: number; ts: number; }
function loadHistory(): HistRec[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as HistRec[]; } catch { return []; }
}
function recordSolve(rec: HistRec) {
  const h = loadHistory();
  h.push(rec);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-500)));
}
function computeStats() {
  const h = loadHistory();
  const solves = h.length;
  if (!solves) return { solves: 0, avgOverIdeal: 0, optimalPct: 0, bestStreak: 0, last12: [] as number[], byStep: [] as { label: string; avg: number }[] };
  const extras = h.map((r) => r.used - r.optimal);
  const avgOverIdeal = extras.reduce((a, b) => a + b, 0) / solves;
  const optimalPct = Math.round((100 * h.filter((r) => r.used === r.optimal).length) / solves);
  let best = 0, cur = 0;
  for (const r of h) { if (r.used === r.optimal) { cur++; best = Math.max(best, cur); } else cur = 0; }
  const byMap = new Map<string, { sum: number; n: number }>();
  for (const r of h) { const m = byMap.get(r.step) ?? { sum: 0, n: 0 }; m.sum += r.used - r.optimal; m.n++; byMap.set(r.step, m); }
  const byStep = [...byMap.entries()].map(([label, m]) => ({ label, avg: m.sum / m.n })).sort((a, b) => a.label.localeCompare(b.label));
  return { solves, avgOverIdeal, optimalPct, bestStreak: best, last12: extras.slice(-12), byStep };
}

// --- course progress ---
// Levels are cleared by CONSISTENCY, not a single average: over the last
// COURSE_WINDOW solves, what fraction were "clean" (move-waste = used − optimal
// ≤ COURSE_TOLERANCE)? A tolerance is used because the solver's optimal can be
// an awkward, non-ergonomic line, so we reward solid human solving, not exact
// optimality. Pass-rate → stars; ≥ the 1★ rate clears + unlocks the next level.
const COURSE_KEY = 'cube-trainer.course';
const COURSE_WINDOW = 12;
const COURSE_TOLERANCE = 2; // a solve is "clean" if it's within +2 of optimal
const COURSE_STAR_RATES = [0.70, 0.85, 1.0]; // clean-rate for 1★ / 2★ / 3★
interface CourseLevel { recent: number[]; stars: number; }
interface CourseTrack { unlocked: number; current: number; levels: Record<number, CourseLevel>; }
type CourseProg = Record<string, CourseTrack>;

function loadCourse(): CourseProg {
  try { return JSON.parse(localStorage.getItem(COURSE_KEY) || '{}') as CourseProg; } catch { return {}; }
}
function saveCourse(p: CourseProg) { localStorage.setItem(COURSE_KEY, JSON.stringify(p)); }
function courseTrack(id: string): CourseTrack {
  const p = loadCourse();
  return p[id] ?? { unlocked: 0, current: 0, levels: {} };
}
function courseCurrent(id: string): number {
  return courseTrack(id).current;
}
function setCourseCurrent(id: string, level: number) {
  const p = loadCourse();
  const t = p[id] ?? { unlocked: 0, current: 0, levels: {} };
  t.current = level;
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
function recordCourse(trainerId: string, levelCount: number, waste: number): string {
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
  for (const [id, label] of [['borland', 'Borland Pascal'], ['dark', 'Modern Dark'], ['matrix', 'Matrix']] as [string, string][])
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
  orientGroup.appendChild(el('div', 'hint', 'Scramble white-top / green-front, then solve in the chosen hold.'));
  modal.appendChild(orientGroup);

  modal.appendChild(el('hr'));

  // Cube
  const cubeGroup = el('div', 'group');
  cubeGroup.appendChild(el('div', 'glabel', 'Cube'));
  const savedMac = getSavedMac();
  cubeGroup.appendChild(el('div', 'hint', savedMac ? `Saved MAC: ${savedMac}` : 'No cube MAC saved. If auto-detection fails on connect, you’ll be asked for it once.'));
  const macRow = el('div', 'row');
  macRow.appendChild(btn('Forget cube MAC', () => { clearSavedMac(); state.status = 'Saved cube MAC cleared.'; render(); }, 'btn ghost'));
  cubeGroup.appendChild(macRow);
  modal.appendChild(cubeGroup);

  const actions = el('div', 'm-actions');
  actions.appendChild(btn('Done', close, 'btn default'));
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  appEl.appendChild(backdrop);
}

function renderCubeNet(f: string, highlight: Set<number> | null = null, blank: Set<number> | null = null): HTMLElement {
  const net = el('div', 'cube-net');
  for (let i = 0; i < 54; i++) {
    let row: number, col: number;
    if (i < 9) { row = Math.floor(i / 3); col = 3 + (i % 3); }
    else if (i < 45) { const p = i - 9; row = 3 + Math.floor(p / 12); col = p % 12; }
    else { const j = i - 45; row = 6 + Math.floor(j / 3); col = 3 + (j % 3); }
    const isBlank = blank?.has(i);
    const dim = !isBlank && highlight && !highlight.has(i) ? ' dim' : '';
    const sticker = el('div', isBlank ? 'sticker blank' : `sticker ${f[i]}${dim}`);
    sticker.style.gridRow = `${row + 1}`;
    sticker.style.gridColumn = `${col + 1}`;
    net.appendChild(sticker);
  }
  return net;
}

function el(tag: string, className = '', text = ''): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}
function btn(label: string, onClick: () => void, className = '', disabled = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (className) b.className = className;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

// --- boot ---
applyTheme(getTheme());
state = freshTrainer('course222'); // default: the graded 2×2×2 course
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
