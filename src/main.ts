import './style.css';
import {
  Cube3x3,
  applyMove,
  faceletString,
  newSolved,
  optimalToMask,
  parseMoves,
  maskProgress,
  anySolved,
  statesEqual,
  type Move3x3,
} from './engine-api.ts';
import { METHODS, SCRAMBLES, listMethods, type Method, type StepDef } from './steps.ts';
import { nextFocusPiece, type FocusPiece } from './pieces.ts';
import { CubeManager, clearSavedMac, getSavedMac } from './bluetooth.ts';
import { getApiKey, getCoaching, hasApiKey, setApiKey } from './coaching.ts';

type Mode = 'scramble' | 'solve';

interface State {
  method: Method;
  scrambleIndex: number;
  stepIndex: number;
  mode: Mode;
  cube: Cube3x3; // live tracked state
  target: Cube3x3; // scrambled target
  history: Move3x3[]; // all moves from solved
  stepStartHistory: Move3x3[]; // history snapshot at start of current step
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

const app = document.getElementById('app')!;

function methodDef() {
  return METHODS[state.method];
}
function steps(): StepDef[] {
  return methodDef().steps;
}
function currentScramble() {
  return SCRAMBLES[state.scrambleIndex];
}
function currentStep(): StepDef | null {
  return steps()[state.stepIndex] ?? null;
}

function freshJourney(method: Method, scrambleIndex: number): State {
  const scr = SCRAMBLES[scrambleIndex];
  const cube = newSolved();
  return {
    method,
    scrambleIndex,
    stepIndex: 0,
    mode: 'scramble',
    cube,
    target: cube.clone().applyMoves(parseMoves(scr.scramble)),
    history: [],
    stepStartHistory: [],
    movesThisStep: [],
    stepDone: METHODS[method].steps.map(() => false),
    assist: null,
    lastResult: null,
    coachText: '',
    coachBusy: false,
    connected: state?.connected ?? false,
    battery: state?.battery ?? null,
    status: 'Start with a solved cube, then apply the scramble. The cube view follows along.',
    showSettings: false,
    log: state?.log ?? [],
    lastError: state?.lastError ?? '',
  };
}

let state: State;

function pushLog(line: string) {
  const stamp = new Date().toLocaleTimeString();
  state.log = [`${stamp}  ${line}`, ...state.log].slice(0, 12);
  render();
}

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
    if (statesEqual(state.cube, state.target)) {
      state.mode = 'solve';
      state.stepStartHistory = [...state.history];
      state.movesThisStep = [];
      state.assist = null;
      state.status = `Scrambled! Build the ${currentStep()?.label ?? 'first block'}.`;
    }
  } else {
    checkStepCompletion();
  }
}

function checkStepCompletion() {
  const s = currentStep();
  if (!s) return;
  if (state.stepDone[state.stepIndex]) return;
  if (anySolved(state.cube, [s.canonicalMask])) {
    const optimal = optimalToMask(state.stepStartHistory, s.canonicalMask, s.solver);
    state.lastResult = {
      step: s.label,
      used: state.movesThisStep.length,
      optimal: optimal ? optimal.length : null,
    };
    state.stepDone[state.stepIndex] = true;
    state.assist = null;
    state.status = `${s.label} complete!`;
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
  onBattery: (b) => {
    state.battery = b;
    render();
  },
  onConnect: (name) => {
    state.connected = true;
    state.lastError = '';
    state.status = `Connected to ${name}.`;
    render();
  },
  onDisconnect: () => {
    state.connected = false;
    state.status = 'Cube disconnected.';
    render();
  },
  onError: (e) => {
    state.lastError = String((e as Error)?.message ?? e);
    state.status = `Bluetooth error: ${state.lastError}`;
    render();
  },
  onLog: (line) => pushLog(line),
});

async function toggleConnect() {
  if (state.connected) {
    await cube.disconnect();
    return;
  }
  if (!CubeManager.isSupported()) {
    state.status = 'Web Bluetooth not available. On iPad use the Bluefy browser.';
    render();
    return;
  }
  state.status = 'Connecting…';
  render();
  try {
    await cube.connect();
  } catch (e) {
    state.status = `Connection failed: ${String((e as Error)?.message ?? e)}`;
    render();
  }
}

function selectMethod(m: Method) {
  state = freshJourney(m, state.scrambleIndex);
  render();
}
function newScramble() {
  state = freshJourney(state.method, (state.scrambleIndex + 1) % SCRAMBLES.length);
  render();
}
function resetToSolved() {
  state = freshJourney(state.method, state.scrambleIndex);
  render();
}
function applyScrambleNow() {
  state.cube = state.target.clone();
  state.history = parseMoves(currentScramble().scramble);
  afterChange();
  render();
}
function rewindStep() {
  state.cube = newSolved().applyMoves(state.stepStartHistory);
  state.history = [...state.stepStartHistory];
  state.movesThisStep = [];
  state.stepDone[state.stepIndex] = false;
  state.assist = null;
  state.status = 'Step rewound to its starting state.';
  render();
}

// Optimal continuation from the current position to the step's target block.
function continuation(): Move3x3[] {
  const s = currentStep();
  if (!s) return [];
  return optimalToMask(state.history, s.canonicalMask, s.solver) ?? [];
}

function assist(kind: 'nudge' | 'move' | 'ideal') {
  const s = currentStep();
  if (!s) return;
  const moves = continuation();
  if (moves.length === 0) {
    state.assist = null;
    state.status = 'Nothing to suggest from here — try the AI coach.';
    render();
    return;
  }
  const focus = kind === 'ideal' ? null : nextFocusPiece(state.cube, s.canonicalMask, moves);
  state.assist = { kind, moves, focus };
  state.status =
    kind === 'nudge'
      ? `Nudge: focus on the ${focus?.description ?? 'highlighted piece'} — work out how to pair and insert it.`
      : kind === 'move'
        ? `Next move: ${moves[0]}`
        : 'Showing the full solution for this block.';
  render();
}

async function askCoach(question?: string) {
  if (!hasApiKey()) {
    state.showSettings = true;
    render();
    return;
  }
  const s = currentStep();
  if (!s) return;
  state.coachBusy = true;
  state.coachText = '';
  render();
  try {
    const cont = continuation();
    const focus = nextFocusPiece(state.cube, s.canonicalMask, cont);
    const text = await getCoaching({
      method: state.method,
      methodDescription: methodDef().description,
      stepName: s.label,
      stepBlurb: s.blurb,
      scramble: currentScramble().scramble,
      movesDone: state.movesThisStep,
      optimalContinuation: cont.join(' '),
      nextPiece: focus?.description,
      progress: maskProgress(state.cube, s.canonicalMask),
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
  const scr = currentScramble();
  const progress = s ? Math.round(maskProgress(state.cube, s.canonicalMask) * 100) : 100;
  const allDone = state.stepDone.every(Boolean);

  app.innerHTML = '';

  // Top bar
  const top = el('div', 'topbar');
  top.appendChild(el('h1', '', 'Cube Skills Trainer'));
  const battery = state.battery != null ? ` · ${state.battery}%` : '';
  top.appendChild(el('span', `pill ${state.connected ? 'ok' : ''}`, state.connected ? `${cube.deviceName || 'Cube'}${battery}` : 'No cube'));
  top.appendChild(btn(state.connected ? 'Disconnect' : 'Connect cube', toggleConnect, state.connected ? 'ghost' : 'primary'));
  top.appendChild(btn('⚙', () => { state.showSettings = true; render(); }, 'ghost'));
  app.appendChild(top);

  // Cube diagnostics
  if (state.connected || state.lastError || state.log.length) {
    const c = el('div', 'card');
    const head = el('div', 'row');
    head.style.justifyContent = 'space-between';
    head.appendChild(el('h2', '', 'Cube'));
    head.appendChild(el('span', `pill ${state.connected ? 'ok' : state.lastError ? 'bad' : ''}`,
      state.connected ? `Connected · ${cube.deviceName || 'GAN'}${state.battery != null ? ` · ${state.battery}%` : ''}` : state.lastError ? 'Error' : 'Idle'));
    c.appendChild(head);
    if (state.lastError) c.appendChild(el('div', 'coach', `⚠ ${state.lastError}`));
    if (state.log.length) {
      const logBox = el('div', 'coach mono');
      logBox.style.fontSize = '13px';
      logBox.textContent = state.log.join('\n');
      c.appendChild(logBox);
    }
    app.appendChild(c);
  }

  // Method selector
  const methodCard = el('div', 'card');
  methodCard.appendChild(el('h2', '', 'Method'));
  const seg = el('div', 'segmented');
  for (const md of listMethods()) seg.appendChild(btn(md.method, () => selectMethod(md.method), state.method === md.method ? 'active' : ''));
  methodCard.appendChild(seg);
  methodCard.appendChild(el('p', 'blurb', methodDef().description));
  app.appendChild(methodCard);

  // Scramble
  const scrCard = el('div', 'card');
  const scrHead = el('div', 'row');
  scrHead.style.justifyContent = 'space-between';
  scrHead.appendChild(el('h2', '', `Scramble (${scr.id})`));
  scrHead.appendChild(btn('New scramble', newScramble, 'ghost'));
  scrCard.appendChild(scrHead);
  scrCard.appendChild(el('div', 'scramble mono', scr.scramble));
  const scrActions = el('div', 'row');
  scrActions.style.marginTop = '12px';
  if (state.mode === 'scramble') {
    scrCard.appendChild(el('div', 'hint', 'Apply these moves to your solved cube. When the cube matches, solving starts automatically.'));
    scrActions.appendChild(btn('Apply scramble for me', applyScrambleNow));
  } else {
    scrCard.appendChild(el('div', 'hint', '✓ Scrambled — now build your blocks.'));
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
    if (state.assist.kind === 'ideal') {
      highlight = new Set(s!.canonicalMask.solvedFaceletIndices);
      highlightNote = 'Highlighted: where the target block belongs.';
    } else if (state.assist.focus) {
      highlight = new Set(state.assist.focus.current);
      highlightNote = `Highlighted: the ${state.assist.focus.description} to place next.`;
    }
  }
  wrap.appendChild(renderCubeNet(faceletString(state.cube), highlight));
  viewCard.appendChild(wrap);
  viewCard.appendChild(el('div', 'hint', highlightNote
    || 'Reflects the model cube — the scramble and every move. Hold your cube white-up, green-front so it matches.'));
  app.appendChild(viewCard);

  // Journey
  const journeyCard = el('div', 'card');
  journeyCard.appendChild(el('h2', '', 'Journey'));
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
  journeyCard.appendChild(chips);
  app.appendChild(journeyCard);

  // Current step / banners
  if (state.mode === 'scramble') {
    const sc = el('div', 'card');
    sc.appendChild(el('div', 'solved-banner', '🧩 Scramble mode — apply the scramble to your solved cube to begin.'));
    app.appendChild(sc);
  } else if (allDone) {
    const done = el('div', 'card');
    done.appendChild(el('div', 'solved-banner', '🎉 All blocks built! Pick a new scramble or method to keep training.'));
    app.appendChild(done);
  } else if (s) {
    const cur = el('div', 'card');
    cur.appendChild(el('h2', '', `Current step — ${s.label}`));
    cur.appendChild(el('p', 'blurb', s.blurb));
    const bar = el('div', 'progress');
    const fill = el('div');
    fill.style.width = `${progress}%`;
    bar.appendChild(fill);
    cur.appendChild(bar);
    cur.appendChild(el('div', 'hint', `${progress}% of this block in place · ${state.movesThisStep.length} moves this step`));

    const actions = el('div', 'row');
    actions.style.marginTop = '12px';
    actions.appendChild(btn('Nudge', () => assist('nudge'), 'primary'));
    actions.appendChild(btn('Reveal move', () => assist('move')));
    actions.appendChild(btn('Show ideal', () => assist('ideal')));
    actions.appendChild(btn('Rewind step', rewindStep, 'ghost'));
    cur.appendChild(actions);
    cur.appendChild(el('div', 'hint', 'Nudge points at the piece (no spoiler) · Reveal move gives the next turn · Show ideal gives the whole solution.'));

    if (state.assist) {
      const a = state.assist;
      if (a.kind === 'nudge' && a.focus) {
        cur.appendChild(el('div', 'ideal', `Focus on the ${a.focus.description}. Find it (highlighted), then work out how to pair and insert it.`));
      } else if (a.kind === 'move') {
        const box = el('div', 'ideal mono');
        box.innerHTML = `<span style="color:var(--accent-2)">next ▸ ${a.moves[0]}</span>`;
        cur.appendChild(box);
      } else if (a.kind === 'ideal') {
        cur.appendChild(el('div', 'ideal mono', a.moves.join(' ')));
        cur.appendChild(el('div', 'hint', 'Full solution from your current position to the target block.'));
      }
    }
    app.appendChild(cur);
  }

  // Last result
  if (state.lastResult && state.mode === 'solve') {
    const r = state.lastResult;
    const card = el('div', 'card');
    card.appendChild(el('h2', '', 'Last block'));
    if (r.optimal != null) {
      const pct = Math.round((r.optimal / Math.max(r.used, 1)) * 100);
      const verdict = r.used <= r.optimal ? '🏆 optimal!' : r.used <= r.optimal + 2 ? '👍 very efficient' : pct >= 60 ? 'good — room to tighten' : 'lots of room to improve';
      card.appendChild(el('div', 'coach', `${r.step}: you ${r.used} moves · optimal ${r.optimal} · ${pct}% efficient — ${verdict}`));
    } else {
      card.appendChild(el('div', 'coach', `${r.step}: solved in ${r.used} moves.`));
    }
    app.appendChild(card);
  }

  // Coaching
  const coachCard = el('div', 'card');
  coachCard.appendChild(el('h2', '', 'AI coach'));
  const coachActions = el('div', 'row');
  coachActions.appendChild(btn(state.coachBusy ? 'Thinking…' : 'Get a tip', () => askCoach(), 'primary', state.coachBusy));
  coachCard.appendChild(coachActions);
  const qWrap = el('div', 'row');
  qWrap.style.marginTop = '10px';
  const q = document.createElement('input');
  q.type = 'text';
  q.placeholder = 'Ask the coach a question…';
  q.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter' && q.value.trim()) {
      askCoach(q.value.trim());
      q.value = '';
    }
  });
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
  m.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter' && m.value.trim()) {
      handleManualMoves(m.value.trim());
      m.value = '';
    }
  });
  mWrap.appendChild(m);
  manualCard.appendChild(mWrap);
  manualCard.appendChild(el('div', 'hint', 'Useful for testing on desktop. Moves apply to the model cube exactly like cube moves.'));
  app.appendChild(manualCard);

  app.appendChild(el('div', 'hint', state.status));

  if (state.showSettings) renderSettings();
}

function renderSettings() {
  const backdrop = el('div', 'modal-backdrop');
  const modal = el('div', 'modal');
  modal.appendChild(el('h2', '', 'Settings'));
  modal.appendChild(el('div', 'hint', 'Anthropic API key for AI coaching. Stored only in this browser (localStorage). Uses model claude-sonnet-4-20250514.'));
  const input = document.createElement('input');
  input.type = 'password';
  input.placeholder = 'sk-ant-…';
  input.value = getApiKey();
  modal.appendChild(input);
  const row = el('div', 'row');
  row.style.justifyContent = 'flex-end';
  row.appendChild(btn('Save', () => {
    setApiKey(input.value.trim());
    state.showSettings = false;
    state.status = input.value.trim() ? 'API key saved.' : 'API key cleared.';
    render();
  }, 'primary'));
  row.appendChild(btn('Close', () => { state.showSettings = false; render(); }, 'ghost'));
  modal.appendChild(row);

  modal.appendChild(el('h2', '', 'Cube'));
  const savedMac = getSavedMac();
  modal.appendChild(el('div', 'hint', savedMac ? `Saved cube MAC: ${savedMac}` : 'No cube MAC saved. If auto-detection fails on connect, you will be asked for it once.'));
  const macRow = el('div', 'row');
  macRow.appendChild(btn('Forget cube MAC', () => {
    clearSavedMac();
    state.status = 'Saved cube MAC cleared.';
    render();
  }, 'ghost'));
  modal.appendChild(macRow);

  backdrop.appendChild(modal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      state.showSettings = false;
      render();
    }
  });
  app.appendChild(backdrop);
}

// Build the unfolded cube net from a 54-char facelet string (engine net order).
function renderCubeNet(f: string, highlight: Set<number> | null = null): HTMLElement {
  const net = el('div', 'cube-net');
  for (let i = 0; i < 54; i++) {
    let row: number, col: number;
    if (i < 9) {
      row = Math.floor(i / 3);
      col = 3 + (i % 3);
    } else if (i < 45) {
      const p = i - 9;
      row = 3 + Math.floor(p / 12);
      col = p % 12;
    } else {
      const j = i - 45;
      row = 6 + Math.floor(j / 3);
      col = 3 + (j % 3);
    }
    const dim = highlight && !highlight.has(i) ? ' dim' : '';
    const sticker = el('div', `sticker ${f[i]}${dim}`);
    sticker.style.gridRow = `${row + 1}`;
    sticker.style.gridColumn = `${col + 1}`;
    net.appendChild(sticker);
  }
  return net;
}

// --- tiny DOM helpers ---

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
state = freshJourney('Petrus', 0);
render();
