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
import { CubeManager, clearSavedMac, getSavedMac } from './bluetooth.ts';
import { getApiKey, getCoaching, hasApiKey, setApiKey } from './coaching.ts';

type Mode = 'scramble' | 'solve';

interface State {
  category: Category;
  trainerId: string;
  stepIndex: number;
  mode: Mode;
  cube: Cube3x3; // live tracked state
  base: Cube3x3; // cube state when the current scramble was issued
  target: Cube3x3; // base + scramble
  scrambleMoves: Move3x3[];
  scrambleBaseLen: number; // history length when this scramble was issued
  history: Move3x3[]; // all moves from solved
  stepStartHistory: Move3x3[];
  movesThisStep: Move3x3[];
  stepDone: boolean[];
  assist: { kind: 'nudge' | 'move' | 'ideal'; moves: Move3x3[]; focus: FocusPiece | null } | null;
  lastResult: { step: string; used: number; optimal: number | null } | null;
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
  const n = first.kind === 'eo' ? 10 : 16; // EO needs only a short scramble
  for (let attempt = 0; attempt < 25; attempt++) {
    const moves = genScramble(n);
    const targetHistory = [...baseHistory, ...moves];
    const solved =
      first.kind === 'eo'
        ? isMaskSolvedFromHistory(targetHistory, first.canonicalMask)
        : anySolved(applyMoves(newSolved(), targetHistory), [first.canonicalMask]);
    if (!solved) return moves;
  }
  return genScramble(n);
}

/** Begin a new scramble from a given base cube + history (continuous reps). */
function startScramble(base: Cube3x3, baseHistory: Move3x3[]): State {
  const t = trainerById(state?.trainerId ?? 'petrus');
  const moves = makeScramble(base, baseHistory, t.steps);
  return {
    category: state?.category ?? 'Blocks',
    trainerId: t.id,
    stepIndex: 0,
    mode: 'scramble',
    cube: base,
    base,
    target: applyMoves(base, moves),
    scrambleMoves: moves,
    scrambleBaseLen: baseHistory.length,
    history: [...baseHistory],
    stepStartHistory: [...baseHistory],
    movesThisStep: [],
    stepDone: t.steps.map(() => false),
    assist: null,
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
  if (state.mode === 'solve') state.movesThisStep.push(move);
  state.assist = null;
  afterChange();
}

function afterChange() {
  if (state.mode === 'scramble') {
    if (state.cube.encode() === state.target.encode()) {
      state.mode = 'solve';
      state.stepStartHistory = [...state.history];
      state.movesThisStep = [];
      state.assist = null;
      state.status = `Scrambled! ${currentStep()?.label ?? ''} — find your solution.`;
    }
  } else {
    checkStepCompletion();
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
    const optimal = optimalToMask(state.stepStartHistory, s.canonicalMask, s.solver);
    state.lastResult = { step: s.label, used: htmCount(state.movesThisStep), optimal: optimal ? optimal.length : null };
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
  for (const tok of parseMoves(text)) step(tok);
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
  let count = 0;
  let i = 0;
  while (i < moves.length) {
    const f = moveFace(moves[i]);
    let net = 0;
    while (i < moves.length && moveFace(moves[i]) === f) {
      net = (net + moveAmount(moves[i])) % 4;
      i++;
    }
    if (net !== 0) count++;
  }
  return count;
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
  state.history = [...state.history, ...state.scrambleMoves];
  afterChange();
  render();
}
function rewindStep() {
  state.cube = applyMoves(newSolved(), state.stepStartHistory);
  state.history = [...state.stepStartHistory];
  state.movesThisStep = [];
  state.stepDone[state.stepIndex] = false;
  state.assist = null;
  state.status = 'Step rewound to its starting state.';
  render();
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
  top.appendChild(el('h1', '', 'Cube Skills Trainer'));
  const battery = state.battery != null ? ` · ${state.battery}%` : '';
  top.appendChild(el('span', `pill ${state.connected ? 'ok' : ''}`, state.connected ? `${cube.deviceName || 'Cube'}${battery}` : 'No cube'));
  top.appendChild(btn(state.connected ? 'Disconnect' : 'Connect cube', toggleConnect, state.connected ? 'ghost' : 'primary'));
  top.appendChild(btn('⚙', () => { state.showSettings = true; render(); }, 'ghost'));
  app.appendChild(top);

  // Category + trainer selector
  const pick = el('div', 'card');
  pick.appendChild(el('h2', '', 'Trainer'));
  const cats = el('div', 'segmented');
  for (const c of CATEGORIES) cats.appendChild(btn(c === 'Blocks' ? 'Block building' : c, () => selectCategory(c), state.category === c ? 'active' : ''));
  pick.appendChild(cats);
  const trs = el('div', 'segmented');
  trs.style.marginTop = '8px';
  for (const t of trainersIn(state.category)) trs.appendChild(btn(t.label, () => selectTrainer(t.id), state.trainerId === t.id ? 'active' : ''));
  pick.appendChild(trs);
  pick.appendChild(el('p', 'blurb', trainer().description));
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
    scrCard.appendChild(el('div', 'hint', 'Apply these moves from your current cube. Solving begins automatically when it matches.'));
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
  wrap.appendChild(renderCubeNet(faceletString(state.cube), highlight));
  viewCard.appendChild(wrap);
  viewCard.appendChild(el('div', 'hint', highlightNote || 'Reflects the model cube. Hold your cube white-up, green-front so it matches.'));
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
    const sc = el('div', 'card');
    sc.appendChild(el('div', 'solved-banner', '🧩 Apply the scramble above to begin.'));
    app.appendChild(sc);
  } else if (allDone) {
    const done = el('div', 'card');
    done.appendChild(el('div', 'solved-banner', '🎉 Done! Click “Next scramble” to keep practising from here.'));
    const r = el('div', 'row');
    r.style.marginTop = '12px';
    r.appendChild(btn('Next scramble', nextScramble, 'primary'));
    done.appendChild(r);
    app.appendChild(done);
  } else if (s) {
    const cur = el('div', 'card');
    const ideal = idealFromStart();
    const head = el('div', 'row');
    head.style.justifyContent = 'space-between';
    head.appendChild(el('h2', '', `Current step — ${s.label}`));
    if (ideal != null) head.appendChild(el('span', 'pill ok', `ideal ${ideal} moves`));
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
    actions.appendChild(btn('Rewind', rewindStep, 'ghost'));
    cur.appendChild(actions);
    cur.appendChild(el('div', 'hint', 'Nudge = point at the piece · Reveal move = next turn · Show ideal = whole solution.'));

    if (state.assist) {
      const a = state.assist;
      if (a.kind === 'nudge' && a.focus) cur.appendChild(el('div', 'ideal', `Focus on the ${a.focus.description}. Find it (highlighted), then pair and insert it.`));
      else if (a.kind === 'move') { const box = el('div', 'ideal mono'); box.innerHTML = `<span style="color:var(--accent-2)">next ▸ ${a.moves[0]}</span>`; cur.appendChild(box); }
      else if (a.kind === 'ideal') { cur.appendChild(el('div', 'ideal mono', a.moves.join(' '))); cur.appendChild(el('div', 'hint', 'Full solution from your current position.')); }
    }
    app.appendChild(cur);
  }

  // Last result — you vs ideal
  if (state.lastResult) {
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

  // Coaching
  const coachCard = el('div', 'card');
  coachCard.appendChild(el('h2', '', 'AI coach'));
  const ca = el('div', 'row');
  ca.appendChild(btn(state.coachBusy ? 'Thinking…' : 'Get a tip', () => askCoach(), 'primary', state.coachBusy));
  coachCard.appendChild(ca);
  const qWrap = el('div', 'row');
  qWrap.style.marginTop = '10px';
  const q = document.createElement('input');
  q.type = 'text';
  q.placeholder = 'Ask the coach a question…';
  q.addEventListener('keydown', (ev) => { if ((ev as KeyboardEvent).key === 'Enter' && q.value.trim()) { askCoach(q.value.trim()); q.value = ''; } });
  qWrap.appendChild(q);
  coachCard.appendChild(qWrap);
  if (state.coachText) coachCard.appendChild(el('div', 'coach', state.coachText));
  if (!hasApiKey()) coachCard.appendChild(el('div', 'hint', 'Add an Anthropic API key in Settings (⚙) to enable coaching.'));
  app.appendChild(coachCard);

  // Manual moves
  const manualCard = el('div', 'card');
  manualCard.appendChild(el('h2', '', 'Manual moves (no cube)'));
  const mWrap = el('div', 'row');
  const m = document.createElement('input');
  m.type = 'text';
  m.placeholder = "Type moves, e.g. R U R' U'";
  m.addEventListener('keydown', (ev) => { if ((ev as KeyboardEvent).key === 'Enter' && m.value.trim()) { handleManualMoves(m.value.trim()); m.value = ''; } });
  mWrap.appendChild(m);
  manualCard.appendChild(mWrap);
  app.appendChild(manualCard);

  app.appendChild(el('div', 'hint', state.status));

  appEl.replaceChildren(app);
  if (state.showSettings) renderSettings();
}

// Track scramble progress at the face level: tokens completed in order, plus the
// index of a token the solver is mid-applying incorrectly (wrong face) -> red.
function scrambleProgress(tokens: Move3x3[], moves: Move3x3[]): { done: number; errorIndex: number } {
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

function renderScramble(): HTMLElement {
  const box = el('div', 'scramble mono');
  const phaseMoves = state.history.slice(state.scrambleBaseLen);
  const { done, errorIndex } = scrambleProgress(state.scrambleMoves, phaseMoves);
  state.scrambleMoves.forEach((mv, i) => {
    const cls = i < done ? 'tok done' : i === errorIndex ? 'tok error' : 'tok';
    const span = el('span', cls);
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
state = freshTrainer('petrus');
render();
