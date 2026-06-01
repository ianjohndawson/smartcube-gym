import './style.css';
import {
  applyScramble,
  cloneCube,
  cubeFromFacelets,
  moveCube,
  parseMoves,
  solvedCube,
  type CubieCube,
} from './cube.ts';
import {
  METHODS,
  SCRAMBLES,
  detectFamily,
  familyProgress,
  getIdeal,
  listMethods,
  type Method,
  type PhaseDef,
} from './journeys.ts';
import { CubeManager, clearSavedMac, getSavedMac } from './bluetooth.ts';
import { getApiKey, getCoaching, hasApiKey, setApiKey } from './coaching.ts';

interface State {
  method: Method;
  scrambleIndex: number;
  phaseIndex: number;
  cube: CubieCube; // current cube state (scrambled -> solving)
  phaseStartCube: CubieCube; // snapshot at the start of the current phase (for rewind)
  movesThisPhase: string[];
  showIdeal: boolean;
  phaseDone: boolean[]; // per-phase completion flags
  coachText: string;
  coachBusy: boolean;
  connected: boolean;
  battery: number | null;
  status: string;
  showSettings: boolean;
  log: string[]; // recent cube event trace
  lastError: string;
}

const app = document.getElementById('app')!;

function methodDef() {
  return METHODS[state.method];
}
function phases(): PhaseDef[] {
  return methodDef().phases;
}
function currentScramble() {
  return SCRAMBLES[state.scrambleIndex];
}
function currentPhase(): PhaseDef | null {
  return phases()[state.phaseIndex] ?? null;
}

function freshJourney(method: Method, scrambleIndex: number): State {
  const scr = SCRAMBLES[scrambleIndex];
  const cube = applyScramble(solvedCube(), scr.scramble);
  return {
    method,
    scrambleIndex,
    phaseIndex: 0,
    cube,
    phaseStartCube: cloneCube(cube),
    movesThisPhase: [],
    showIdeal: false,
    phaseDone: phases0(method).map(() => false),
    coachText: '',
    coachBusy: false,
    connected: state?.connected ?? false,
    battery: state?.battery ?? null,
    status: 'Scramble your cube using the sequence above, then start solving.',
    showSettings: false,
    log: state?.log ?? [],
    lastError: state?.lastError ?? '',
  };
}

function pushLog(line: string) {
  const stamp = new Date().toLocaleTimeString();
  state.log = [`${stamp}  ${line}`, ...state.log].slice(0, 12);
  render();
}
function phases0(method: Method) {
  return METHODS[method].phases;
}

let state: State;

// --- Cube input handling (from BLE or manual) ---

function handleMove(move: string) {
  // normalise: gan-web-bluetooth emits standard notation already
  if (!move) return;
  state.cube = moveCube(state.cube, move);
  state.movesThisPhase.push(move);
  checkPhaseCompletion();
  render();
}

function handleManualMoves(text: string) {
  for (const tok of parseMoves(text)) {
    try {
      state.cube = moveCube(state.cube, tok);
      state.movesThisPhase.push(tok);
    } catch {
      /* ignore invalid token */
    }
  }
  checkPhaseCompletion();
  render();
}

function handleFacelets(facelets: string) {
  try {
    state.cube = cubeFromFacelets(facelets);
    checkPhaseCompletion();
    render();
  } catch (e) {
    console.warn('Could not parse facelets', e);
  }
}

function checkPhaseCompletion() {
  const phase = currentPhase();
  if (!phase) return;
  if (state.phaseDone[state.phaseIndex]) return;
  const solved = detectFamily(state.cube, phase.family);
  if (solved) {
    state.phaseDone[state.phaseIndex] = true;
    state.status = `${phase.name} complete!`;
    // advance to next phase, anchoring its start to the current cube
    if (state.phaseIndex < phases().length - 1) {
      state.phaseIndex += 1;
      state.phaseStartCube = cloneCube(state.cube);
      state.movesThisPhase = [];
      state.showIdeal = false;
    }
  }
}

// --- Actions ---

const cube = new CubeManager({
  onMove: (m) => handleMove(m),
  onFacelets: (f) => handleFacelets(f),
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
  const next = (state.scrambleIndex + 1) % SCRAMBLES.length;
  state = freshJourney(state.method, next);
  render();
}

function rewindPhase() {
  state.cube = cloneCube(state.phaseStartCube);
  state.movesThisPhase = [];
  state.phaseDone[state.phaseIndex] = false;
  state.status = 'Phase rewound to its starting state.';
  render();
}

function toggleIdeal() {
  state.showIdeal = !state.showIdeal;
  render();
}

async function askCoach(question?: string) {
  if (!hasApiKey()) {
    state.showSettings = true;
    render();
    return;
  }
  const phase = currentPhase();
  if (!phase) return;
  state.coachBusy = true;
  state.coachText = '';
  render();
  try {
    const text = await getCoaching({
      method: state.method,
      methodDescription: methodDef().description,
      phaseName: phase.name,
      phaseBlurb: phase.blurb,
      scramble: currentScramble().scramble,
      movesDone: state.movesThisPhase,
      ideal: getIdeal(state.method, currentScramble().id, phase.id),
      progress: familyProgress(state.cube, phase.family),
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

// --- Rendering ---

function render() {
  const phase = currentPhase();
  const scr = currentScramble();
  const progress = phase ? Math.round(familyProgress(state.cube, phase.family) * 100) : 100;
  const ideal = phase ? getIdeal(state.method, scr.id, phase.id) : '';
  const allDone = state.phaseDone.every(Boolean);

  app.innerHTML = '';

  // Top bar
  const top = el('div', 'topbar');
  top.appendChild(el('h1', '', 'Block Trainer'));
  const battery = state.battery != null ? ` · ${state.battery}%` : '';
  const conn = el('span', `pill ${state.connected ? 'ok' : ''}`, state.connected ? `${cube.deviceName || 'Cube'}${battery}` : 'No cube');
  top.appendChild(conn);
  top.appendChild(btn(state.connected ? 'Disconnect' : 'Connect cube', toggleConnect, state.connected ? 'ghost' : 'primary'));
  top.appendChild(btn('⚙', () => { state.showSettings = true; render(); }, 'ghost'));
  app.appendChild(top);

  // Cube status / diagnostics (shown when connecting, connected, or after an error)
  if (state.connected || state.lastError || state.log.length) {
    const cubeCard = el('div', 'card');
    const head = el('div', 'row');
    head.style.justifyContent = 'space-between';
    head.appendChild(el('h2', '', 'Cube'));
    const statePill = el('span', `pill ${state.connected ? 'ok' : state.lastError ? 'bad' : ''}`,
      state.connected ? `Connected · ${cube.deviceName || 'GAN'}${state.battery != null ? ` · ${state.battery}%` : ''}` : state.lastError ? 'Error' : 'Idle');
    head.appendChild(statePill);
    cubeCard.appendChild(head);
    if (state.connected) {
      const actions = el('div', 'row');
      actions.appendChild(btn('Sync from cube', () => cube.requestFacelets()));
      cubeCard.appendChild(actions);
    }
    if (state.lastError) {
      cubeCard.appendChild(el('div', 'coach', `⚠ ${state.lastError}`));
    }
    if (state.log.length) {
      const logBox = el('div', 'coach mono');
      logBox.style.fontSize = '13px';
      logBox.textContent = state.log.join('\n');
      cubeCard.appendChild(logBox);
    }
    app.appendChild(cubeCard);
  }

  // Method selector
  const methodCard = el('div', 'card');
  methodCard.appendChild(el('h2', '', 'Method'));
  const seg = el('div', 'segmented');
  for (const md of listMethods()) {
    const b = btn(md.method, () => selectMethod(md.method), state.method === md.method ? 'active' : '');
    seg.appendChild(b);
  }
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
  app.appendChild(scrCard);

  // Phase tracker
  const phaseCard = el('div', 'card');
  phaseCard.appendChild(el('h2', '', 'Journey'));
  const chips = el('div', 'phases');
  phases().forEach((p, i) => {
    const cls = state.phaseDone[i] ? 'done' : i === state.phaseIndex ? 'active' : '';
    const chip = el('div', `phase-chip ${cls}`);
    chip.appendChild(el('div', 'name', p.name));
    chip.appendChild(el('div', 'state', state.phaseDone[i] ? '✓ done' : i === state.phaseIndex ? 'in progress' : 'upcoming'));
    chips.appendChild(chip);
  });
  phaseCard.appendChild(chips);
  app.appendChild(phaseCard);

  // Current phase / solved banner
  if (allDone) {
    const done = el('div', 'card');
    done.appendChild(el('div', 'solved-banner', '🎉 All blocks built! Pick a new scramble or method to keep training.'));
    app.appendChild(done);
  } else if (phase) {
    const cur = el('div', 'card');
    cur.appendChild(el('h2', '', `Current phase — ${phase.name}`));
    cur.appendChild(el('p', 'blurb', phase.blurb));
    const bar = el('div', 'progress');
    const fill = el('div');
    fill.style.width = `${progress}%`;
    bar.appendChild(fill);
    cur.appendChild(bar);
    cur.appendChild(el('div', 'hint', `${progress}% of this block in place · ${state.movesThisPhase.length} moves this phase`));

    const actions = el('div', 'row');
    actions.style.marginTop = '12px';
    actions.appendChild(btn(state.showIdeal ? 'Hide ideal' : 'Show ideal', toggleIdeal));
    actions.appendChild(btn('Rewind phase', rewindPhase));
    cur.appendChild(actions);

    if (state.showIdeal) {
      cur.appendChild(el('div', 'ideal mono', ideal ? ideal : '(no ideal available for this phase)'));
    }
    app.appendChild(cur);
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

  // Manual move input (testing without a cube)
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

  // Status line
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
  row.appendChild(
    btn('Save', () => {
      setApiKey(input.value.trim());
      state.showSettings = false;
      state.status = input.value.trim() ? 'API key saved.' : 'API key cleared.';
      render();
    }, 'primary'),
  );
  row.appendChild(btn('Close', () => { state.showSettings = false; render(); }, 'ghost'));
  modal.appendChild(row);

  // Cube MAC management
  modal.appendChild(el('h2', '', 'Cube'));
  const savedMac = getSavedMac();
  modal.appendChild(el('div', 'hint', savedMac ? `Saved cube MAC: ${savedMac}` : 'No cube MAC saved. If auto-detection fails on connect, you will be asked for it once.'));
  const macRow = el('div', 'row');
  macRow.appendChild(
    btn('Forget cube MAC', () => {
      clearSavedMac();
      state.status = 'Saved cube MAC cleared.';
      render();
    }, 'ghost'),
  );
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
