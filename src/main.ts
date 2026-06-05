import './style.css';
import {
  Cube3x3,
  applyMove,
  applyMoves,
  faceletString,
  newSolved,
  optimalToMask,
  parseMoves,
  maskProgress,
  maskProgressFromHistory,
  anySolved,
  isMaskSolvedFromHistory,
  type Move3x3,
} from './engine-api.ts';
import {
  CATEGORIES,
  genScramble,
  trainerById,
  trainersIn,
  type Category,
  type StepDef,
} from './steps.ts';
import { nextFocusPiece, type FocusPiece } from './pieces.ts';
import { sampleEoScramble } from './eo-scramble.ts';
import { genEoSafeScramble } from './steps.ts';

const SOLVED_ENCODE = newSolved().encode();
import { ORIENT_LABEL, rotateHighlight, rotatedFacelets, toDisplayMoves, toModelMoves } from './orient.ts';
import { CubeManager, clearSavedMac, getSavedMac } from './bluetooth.ts';
import { getApiKey, getCoaching, hasApiKey, setApiKey } from './coaching.ts';

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
  prefixEncodes: string[]; // encoded states base..target (for green progress)
  pendingLearn: boolean; // after this setup completes, start the ideal walkthrough
  history: Move3x3[]; // all moves from solved
  stepStartHistory: Move3x3[];
  movesThisStep: Move3x3[];
  stepDone: boolean[];
  assist: { kind: 'nudge' | 'move' | 'ideal'; moves: Move3x3[]; focus: FocusPiece | null } | null;
  learn: { moves: Move3x3[]; baseLen: number } | null; // guided ideal replay
  lastResult: { step: string; used: number; optimal: number | null; yourMoves: Move3x3[]; idealMoves: Move3x3[] } | null;
  coachText: string;
  coachBusy: boolean;
  connected: boolean;
  battery: number | null;
  status: string;
  showSettings: boolean;
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
  // EO: pick the bad-edge count from the binomial, then use the shortest sequence
  // that yields it (exact distribution, ~5-move scrambles). Permutation-independent,
  // so it works applied from the current cube. From a solved cube, prepend an
  // EO-preserving permutation scramble so the first case still looks messed up.
  if (first.kind === 'eo') {
    const eoSeq = sampleEoScramble();
    return base.encode() === SOLVED_ENCODE ? [...genEoSafeScramble(10), ...eoSeq] : eoSeq;
  }
  // Blocks: a normal-length random scramble, rejecting any that pre-solve the step.
  for (let attempt = 0; attempt < 25; attempt++) {
    const moves = genScramble(16);
    const targetHistory = [...baseHistory, ...moves];
    if (!anySolved(applyMoves(newSolved(), targetHistory), [first.canonicalMask])) return moves;
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
    prefixEncodes: computePrefixEncodes(base, moves),
    pendingLearn: false,
    history: [...baseHistory],
    stepStartHistory: [...baseHistory],
    movesThisStep: [],
    stepDone: t.steps.map(() => false),
    assist: null,
    learn: null,
    lastResult: state?.lastResult ?? null,
    coachText: '',
    coachBusy: false,
    connected: state?.connected ?? false,
    battery: state?.battery ?? null,
    status: 'Apply the scramble to your cube. The cube view follows along.',
    showSettings: false,
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
    checkStepCompletion();
    if (state.stepDone.every(Boolean) && state.finishedMs == null && state.solveStartMs != null) {
      state.finishedMs = Date.now();
    }
  }
}

function stepSolved(s: StepDef): boolean {
  return s.kind === 'eo'
    ? isMaskSolvedFromHistory(state.history, s.canonicalMask)
    : anySolved(state.cube, [s.canonicalMask]);
}

function checkStepCompletion() {
  const s = currentStep();
  if (!s || state.stepDone[state.stepIndex]) return;
  if (stepSolved(s)) {
    const optimal = optimalToMask(state.stepStartHistory, s.canonicalMask, s.solver) ?? [];
    state.lastResult = {
      step: s.label,
      used: htmCount(state.movesThisStep),
      optimal: optimal.length,
      yourMoves: [...state.movesThisStep],
      idealMoves: optimal,
    };
    state.stepDone[state.stepIndex] = true;
    state.assist = null;
    state.status = `${s.label} done!`;
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
function handleManualMoves(text: string) {
  // In the solve frame the user types what they see (held frame); translate to model.
  const toks = solveFrame() ? toModelMoves(parseMoves(text)) : parseMoves(text);
  for (const tok of toks) step(tok);
  render();
}

// --- actions ---

const cube = new CubeManager({
  onMove: (m) => handleMove(m),
  onBattery: (b) => { state.battery = b; render(); },
  onConnect: (name) => { state.connected = true; state.lastError = ''; state.status = `Connected to ${name}.`; render(); },
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

function selectCategory(c: Category) {
  state.category = c;
  freshTrainerInPlace(trainersIn(c)[0].id);
}
function selectTrainer(id: string) {
  freshTrainerInPlace(id);
}
function freshTrainerInPlace(id: string) {
  state = freshTrainer(id);
  render();
}
function nextScramble() {
  // continuous: new scramble applied from the current cube state
  state = startScramble(state.cube, state.history);
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
  state = startScramble(state.cube, state.history, undoToScramble());
  state.status = 'Apply the sequence above to return to the scramble, then solve it again.';
  render();
}

// Learn the ideal on this case: return to the scramble first, then walk the ideal.
function learnFromReview() {
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
function applyTheme(t: string) {
  document.body.className = t === 'dark' ? '' : `theme-${t}`;
}

// --- solving orientation (phase-flip; static x2 for now) ---
const ORIENT_KEY = 'cube-trainer.orient';
let orientEnabled = localStorage.getItem(ORIENT_KEY) === '1';
function setOrient(b: boolean) {
  orientEnabled = b;
  localStorage.setItem(ORIENT_KEY, b ? '1' : '0');
  render();
}
let showPicker = false; // Trainer selector collapsed by default

/** True when the solve-phase held frame is active (rotate view + translate notation). */
function solveFrame(): boolean {
  return orientEnabled && state.mode === 'solve';
}
function disp(moves: Move3x3[]): Move3x3[] {
  return solveFrame() ? toDisplayMoves(moves) : moves;
}

function continuation(): Move3x3[] {
  const s = currentStep();
  if (!s) return [];
  return optimalToMask(state.history, s.canonicalMask, s.solver) ?? [];
}
function idealFromStart(): number | null {
  const s = currentStep();
  if (!s) return null;
  const m = optimalToMask(state.stepStartHistory, s.canonicalMask, s.solver);
  return m ? m.length : null;
}

function assist(kind: 'nudge' | 'move' | 'ideal') {
  const s = currentStep();
  if (!s) return;
  const moves = continuation();
  if (moves.length === 0) { state.assist = null; state.status = 'Nothing to suggest from here — try the AI coach.'; render(); return; }
  const focus = kind !== 'ideal' && s.kind === 'block' ? nextFocusPiece(state.cube, s.canonicalMask, moves) : null;
  const effective = kind === 'nudge' && !focus ? 'move' : kind;
  state.assist = { kind: effective, moves, focus };
  state.status =
    effective === 'nudge' ? `Nudge: focus on the ${focus?.description ?? 'highlighted piece'} — pair and insert it.`
    : effective === 'move' ? `Next move: ${moves[0]}`
    : 'Showing the full solution for this step.';
  render();
}

async function askCoach(question?: string) {
  if (!hasApiKey()) { state.showSettings = true; render(); return; }
  const s = currentStep();
  if (!s) return;
  state.coachBusy = true;
  state.coachText = '';
  render();
  try {
    const cont = continuation();
    const focus = s.kind === 'block' ? nextFocusPiece(state.cube, s.canonicalMask, cont) : null;
    const text = await getCoaching({
      method: trainer().label,
      methodDescription: trainer().description,
      stepName: s.label,
      stepBlurb: s.blurb,
      scramble: state.scrambleMoves.join(' '),
      movesDone: state.movesThisStep,
      optimalContinuation: cont.join(' '),
      nextPiece: focus?.description,
      progress: s.kind === 'eo' ? maskProgressFromHistory(state.history, s.canonicalMask) : maskProgress(state.cube, s.canonicalMask),
      question,
    });
    state.coachText = text || '(no response)';
  } catch (e) {
    state.coachText = `Error: ${String((e as Error)?.message ?? e)}`;
  } finally {
    state.coachBusy = false;
    render();
  }
}

// --- rendering ---

function render() {
  const s = currentStep();
  const progress = s
    ? Math.round((s.kind === 'eo' ? maskProgressFromHistory(state.history, s.canonicalMask) : maskProgress(state.cube, s.canonicalMask)) * 100)
    : 100;
  const allDone = state.stepDone.every(Boolean);

  // Build into a fragment and swap atomically (avoids the blank-then-repaint flash).
  const app = document.createDocumentFragment();

  // Top bar
  const top = el('div', 'topbar');
  top.appendChild(el('h1', '', 'SmartCube Gym'));
  const battery = state.battery != null ? ` · ${state.battery}%` : '';
  top.appendChild(el('span', `pill ${state.connected ? 'ok' : ''}`, state.connected ? `${cube.deviceName || 'Cube'}${battery}` : 'No cube'));
  top.appendChild(btn(state.connected ? 'Disconnect' : 'Connect cube', toggleConnect, state.connected ? 'ghost' : 'primary'));
  top.appendChild(btn('⚙', () => { state.showSettings = true; render(); }, 'ghost'));
  app.appendChild(top);

  // Trainer selector (collapsed to a summary until you want to change it)
  const pick = el('div', 'card');
  const cat = state.category === 'Blocks' ? 'Block building' : state.category;
  const head = el('div', 'row');
  head.style.justifyContent = 'space-between';
  head.style.alignItems = 'center';
  head.appendChild(el('div', '', `${cat} · ${trainer().label} · ${state.trainMode === 'timed' ? 'Timed' : 'Efficiency'}`));
  head.appendChild(btn(showPicker ? 'Done' : 'Change', () => { showPicker = !showPicker; render(); }, 'ghost'));
  pick.appendChild(head);
  if (showPicker) {
    const cats = el('div', 'segmented');
    cats.style.marginTop = '10px';
    for (const c of CATEGORIES) cats.appendChild(btn(c === 'Blocks' ? 'Block building' : c, () => selectCategory(c), state.category === c ? 'active' : ''));
    pick.appendChild(cats);
    const trs = el('div', 'segmented');
    trs.style.marginTop = '8px';
    for (const t of trainersIn(state.category)) trs.appendChild(btn(t.label, () => selectTrainer(t.id), state.trainerId === t.id ? 'active' : ''));
    pick.appendChild(trs);
    pick.appendChild(el('p', 'blurb', trainer().description));
    const modeRow = el('div', 'segmented');
    modeRow.appendChild(btn('Efficiency', () => setMode('efficiency'), state.trainMode === 'efficiency' ? 'active' : ''));
    modeRow.appendChild(btn('Timed', () => setMode('timed'), state.trainMode === 'timed' ? 'active' : ''));
    pick.appendChild(modeRow);
  }
  app.appendChild(pick);

  // Scramble (with progress highlight)
  const scrCard = el('div', 'card');
  const scrHead = el('div', 'row');
  scrHead.style.justifyContent = 'space-between';
  scrHead.appendChild(el('h2', '', 'Scramble'));
  scrHead.appendChild(btn('Next scramble', nextScramble, 'ghost'));
  scrCard.appendChild(scrHead);
  scrCard.appendChild(renderScramble());
  const scrActions = el('div', 'row');
  scrActions.style.marginTop = '12px';
  if (state.mode === 'scramble') {
    const rem = scrambleRemaining();
    if (rem.length) {
      const expected = state.scrambleMoves[scrambleDone()];
      const isFix = expected != null && rem[0][0] !== expected[0];
      const line = el('div', 'hint');
      line.innerHTML = `Next: <b style="color:var(--accent-2)">${rem[0]}</b>${isFix ? ' — corrects a wrong turn' : ''} · ${rem.length} to go`;
      scrCard.appendChild(line);
    } else {
      scrCard.appendChild(el('div', 'hint', 'Apply the scramble from your current cube. Solving begins automatically when it matches.'));
    }
    scrActions.appendChild(btn('Apply scramble for me', applyScrambleNow));
    scrActions.appendChild(btn('Reset to solved', resetToSolved, 'ghost'));
  } else {
    scrActions.appendChild(btn('Reset to solved', resetToSolved, 'ghost'));
  }
  scrCard.appendChild(scrActions);
  app.appendChild(scrCard);

  // Cube view
  const viewCard = el('div', 'card');
  viewCard.appendChild(el('h2', '', 'Cube view'));
  const wrap = el('div', 'cube-wrap');
  let highlight: Set<number> | null = null;
  let highlightNote = '';
  if (state.assist) {
    if (state.assist.kind === 'ideal') { highlight = new Set(s!.canonicalMask.solvedFaceletIndices); highlightNote = 'Highlighted: the target facelets.'; }
    else if (state.assist.focus) { highlight = new Set(state.assist.focus.current); highlightNote = `Highlighted: the ${state.assist.focus.description} to place next.`; }
  }
  if (solveFrame() && highlight) highlight = rotateHighlight(highlight);
  const facelets = solveFrame() ? rotatedFacelets(state.cube) : faceletString(state.cube);
  wrap.appendChild(renderCubeNet(facelets, highlight));
  viewCard.appendChild(wrap);
  const holdNote = orientEnabled
    ? (state.mode === 'solve' ? `Hold ${ORIENT_LABEL} (rotate x2 from the scramble).` : 'Hold white-top / green-front to scramble.')
    : 'Hold your cube white-up, green-front so it matches.';
  viewCard.appendChild(el('div', 'hint', highlightNote || `Reflects the model cube. ${holdNote}`));
  app.appendChild(viewCard);

  // Journey chips (only show if multi-step)
  if (steps().length > 1) {
    const jc = el('div', 'card');
    jc.appendChild(el('h2', '', 'Journey'));
    const chips = el('div', 'phases');
    const solving = state.mode === 'solve';
    steps().forEach((p, i) => {
      const isCurrent = solving && i === state.stepIndex;
      const cls = state.stepDone[i] ? 'done' : isCurrent ? 'active' : '';
      const chip = el('div', `phase-chip ${cls}`);
      chip.appendChild(el('div', 'name', p.label));
      chip.appendChild(el('div', 'state', state.stepDone[i] ? '✓ done' : isCurrent ? 'in progress' : 'upcoming'));
      chips.appendChild(chip);
    });
    jc.appendChild(chips);
    app.appendChild(jc);
  }

  // Current step / banners
  if (state.mode === 'scramble') {
    // no banner needed — the Scramble card already guides the user
  } else if (allDone) {
    const done = el('div', 'card');
    done.appendChild(el('div', 'solved-banner', '🎉 Solved! Here’s how you did.'));
    const r = state.lastResult;
    if (r) {
      const yours = disp(simplifyMoves(r.yourMoves));
      const extra = r.optimal != null ? r.used - r.optimal : 0;
      const verdict = r.optimal == null ? '' : extra <= 0 ? '🏆 optimal!' : extra <= 2 ? '👍 very efficient' : extra <= 5 ? 'good — room to tighten' : 'lots of room to improve';
      const cmp = el('div', 'coach mono');
      cmp.innerHTML =
        `your solution (${r.used}): ${yours.join(' ') || '—'}\n` +
        `ideal (${r.optimal ?? '?'}):  ${disp(r.idealMoves).join(' ')}` +
        (verdict ? `\n${verdict}` : '');
      done.appendChild(cmp);
    }
    if (state.trainMode === 'timed' && state.solveStartMs != null && state.finishedMs != null) {
      const ms = state.finishedMs - state.solveStartMs;
      const moves = htmCount(state.history.slice(state.solveStartLen));
      const tps = ms > 0 ? (moves / (ms / 1000)).toFixed(1) : '–';
      done.appendChild(el('div', 'coach', `⏱ ${fmtTime(ms)} · ${moves} moves · ${tps} TPS`));
    }
    const row = el('div', 'row');
    row.style.marginTop = '12px';
    row.appendChild(btn('Learn the ideal', learnFromReview, 'primary'));
    row.appendChild(btn('Try again', tryAgain));
    row.appendChild(btn('Next scramble', nextScramble, 'ghost'));
    done.appendChild(row);
    app.appendChild(done);
  } else if (s && state.learn) {
    const lc = el('div', 'card');
    lc.appendChild(el('h2', '', `Learn by example — ${s.label}`));
    lc.appendChild(el('p', 'blurb', 'Follow the ideal solution move by move. Each move turns green; a wrong turn shows red. This is how the trick gets into your hands.'));
    const { done, errorIndex } = progressOver(state.learn.moves, state.history.slice(state.learn.baseLen));
    const shown = disp(state.learn.moves); // translate to the held frame for display
    const box = el('div', 'scramble mono');
    shown.forEach((mv, i) => {
      const cls = i < done ? 'tok done' : i === errorIndex ? 'tok error' : i === done ? 'tok next' : 'tok';
      const span = el('span', cls);
      span.textContent = mv;
      box.appendChild(span);
      box.appendChild(document.createTextNode(' '));
    });
    lc.appendChild(box);
    if (done < shown.length) lc.appendChild(el('div', 'hint', `Next move: ${shown[done]} (${done}/${shown.length} done)`));
    const la = el('div', 'row');
    la.style.marginTop = '12px';
    la.appendChild(btn('Stop walkthrough', stopLearn, 'ghost'));
    lc.appendChild(la);
    app.appendChild(lc);
  } else if (s) {
    const cur = el('div', 'card');
    const ideal = idealFromStart();
    const head = el('div', 'row');
    head.style.justifyContent = 'space-between';
    head.appendChild(el('h2', '', `Current step — ${s.label}`));
    const pills = el('div', 'row');
    if (state.trainMode === 'timed') {
      const txt = state.solveStartMs == null ? '0:00.00' : fmtTime((state.finishedMs ?? Date.now()) - state.solveStartMs);
      const t = el('span', 'pill', txt);
      t.id = 'live-timer';
      pills.appendChild(t);
    }
    if (ideal != null) pills.appendChild(el('span', 'pill ok', `ideal ${ideal}`));
    head.appendChild(pills);
    cur.appendChild(head);
    cur.appendChild(el('p', 'blurb', s.blurb));
    const bar = el('div', 'progress');
    const fill = el('div');
    fill.style.width = `${progress}%`;
    bar.appendChild(fill);
    cur.appendChild(bar);
    cur.appendChild(el('div', 'hint', `${progress}% complete · your moves: ${htmCount(state.movesThisStep)}${ideal != null ? ` · ideal: ${ideal}` : ''}`));

    const actions = el('div', 'row');
    actions.style.marginTop = '12px';
    actions.appendChild(btn('Nudge', () => assist('nudge'), 'primary'));
    actions.appendChild(btn('Reveal move', () => assist('move')));
    actions.appendChild(btn('Show ideal', () => assist('ideal')));
    actions.appendChild(btn('Learn by example', enterLearn));
    actions.appendChild(btn('Rewind', rewindStep, 'ghost'));
    cur.appendChild(actions);
    cur.appendChild(el('div', 'hint', 'Nudge = point at the piece · Reveal move = next turn · Show ideal = whole solution · Learn by example = walk the ideal.'));

    if (state.assist) {
      const a = state.assist;
      if (a.kind === 'nudge' && a.focus) cur.appendChild(el('div', 'ideal', `Focus on the ${a.focus.description}. Find it (highlighted), then pair and insert it.`));
      else if (a.kind === 'move') { const box = el('div', 'ideal mono'); box.innerHTML = `<span style="color:var(--accent-2)">next ▸ ${disp([a.moves[0]])[0]}</span>`; cur.appendChild(box); }
      else if (a.kind === 'ideal') { cur.appendChild(el('div', 'ideal mono', disp(a.moves).join(' '))); cur.appendChild(el('div', 'hint', 'Full solution from your current position.')); }
    }
    app.appendChild(cur);
  }

  // Last result — you vs ideal (mid-journey only; the all-done review covers it otherwise)
  if (state.lastResult && !allDone) {
    const r = state.lastResult;
    const card = el('div', 'card');
    card.appendChild(el('h2', '', 'Result'));
    if (r.optimal != null) {
      const extra = r.used - r.optimal;
      const verdict = extra <= 0 ? '🏆 optimal!' : extra <= 2 ? '👍 very efficient' : extra <= 5 ? 'good — room to tighten' : 'lots of room to improve';
      card.appendChild(el('div', 'coach', `${r.step}: you solved it in ${r.used} moves — the ideal is ${r.optimal} (${extra <= 0 ? 'matched' : `+${extra}`}). ${verdict}`));
    } else {
      card.appendChild(el('div', 'coach', `${r.step}: solved in ${r.used} moves.`));
    }
    app.appendChild(card);
  }

  // AI coach card removed from the UI; coaching.ts + askCoach() are kept as hooks
  // in case we re-enable it later.

  app.appendChild(el('div', 'hint', state.status));

  appEl.replaceChildren(app);
  if (state.showSettings) renderSettings();
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

// Leading scramble tokens whose resulting state has actually been reached.
function scrambleDone(): number {
  const cur = state.cube.encode();
  let done = 0;
  for (let k = 0; k < state.prefixEncodes.length; k++) if (state.prefixEncodes[k] === cur) done = k;
  return done;
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
  const done = scrambleDone();
  state.scrambleMoves.forEach((mv, i) => {
    const span = el('span', i < done ? 'tok done' : 'tok');
    span.textContent = mv;
    box.appendChild(span);
    box.appendChild(document.createTextNode(' '));
  });
  return box;
}

function renderSettings() {
  const backdrop = el('div', 'modal-backdrop');
  const modal = el('div', 'modal');
  modal.appendChild(el('h2', '', 'Settings'));
  modal.appendChild(el('div', 'hint', 'Anthropic API key for AI coaching. Stored only in this browser. Uses model claude-sonnet-4-20250514.'));
  const input = document.createElement('input');
  input.type = 'password';
  input.placeholder = 'sk-ant-…';
  input.value = getApiKey();
  modal.appendChild(input);
  const row = el('div', 'row');
  row.style.justifyContent = 'flex-end';
  row.appendChild(btn('Save', () => { setApiKey(input.value.trim()); state.showSettings = false; state.status = input.value.trim() ? 'API key saved.' : 'API key cleared.'; render(); }, 'primary'));
  row.appendChild(btn('Close', () => { state.showSettings = false; render(); }, 'ghost'));
  modal.appendChild(row);
  modal.appendChild(el('h2', '', 'Cube'));
  const savedMac = getSavedMac();
  modal.appendChild(el('div', 'hint', savedMac ? `Saved cube MAC: ${savedMac}` : 'No cube MAC saved. If auto-detection fails on connect, you will be asked for it once.'));
  const macRow = el('div', 'row');
  macRow.appendChild(btn('Forget cube MAC', () => { clearSavedMac(); state.status = 'Saved cube MAC cleared.'; render(); }, 'ghost'));
  modal.appendChild(macRow);

  modal.appendChild(el('h2', '', 'Solve orientation'));
  modal.appendChild(el('div', 'hint', 'Scramble white-top / green-front, then solve in the chosen hold. (Static x2 for now.)'));
  const orientRow = el('div', 'segmented');
  orientRow.appendChild(btn('White-top', () => setOrient(false), !orientEnabled ? 'active' : ''));
  orientRow.appendChild(btn('Yellow-top (x2)', () => setOrient(true), orientEnabled ? 'active' : ''));
  modal.appendChild(orientRow);

  modal.appendChild(el('h2', '', 'Theme'));
  const themeRow = el('div', 'segmented');
  const themes: [string, string][] = [['dark', 'Dark'], ['borland', 'Borland']];
  for (const [id, label] of themes) themeRow.appendChild(btn(label, () => { setTheme(id); render(); }, getTheme() === id ? 'active' : ''));
  modal.appendChild(themeRow);

  backdrop.appendChild(modal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { state.showSettings = false; render(); } });
  appEl.appendChild(backdrop);
}

function renderCubeNet(f: string, highlight: Set<number> | null = null): HTMLElement {
  const net = el('div', 'cube-net');
  for (let i = 0; i < 54; i++) {
    let row: number, col: number;
    if (i < 9) { row = Math.floor(i / 3); col = 3 + (i % 3); }
    else if (i < 45) { const p = i - 9; row = 3 + Math.floor(p / 12); col = p % 12; }
    else { const j = i - 45; row = 6 + Math.floor(j / 3); col = 3 + (j % 3); }
    const dim = highlight && !highlight.has(i) ? ' dim' : '';
    const sticker = el('div', `sticker ${f[i]}${dim}`);
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
state = freshTrainer('eo'); // default: Full EO, Efficiency
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
