import './style.css';
import {
  applyScramble,
  cloneCube,
  cubeFromFacelets,
  cubesEqual,
  cubeToFaceletString,
  goalPieceStickers,
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
  hintFor,
  listMethods,
  optimalFor,
  type Hint,
  type Method,
  type PhaseDef,
} from './journeys.ts';
import { CubeManager, clearSavedMac, getSavedMac } from './bluetooth.ts';
import { getApiKey, getCoaching, hasApiKey, setApiKey } from './coaching.ts';

type Mode = 'scramble' | 'solve';

interface State {
  method: Method;
  scrambleIndex: number;
  phaseIndex: number;
  mode: Mode; // 'scramble' until the cube matches the target, then 'solve'
  cube: CubieCube; // current cube state (starts solved)
  targetCube: CubieCube; // the scrambled state to reach
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
  hint: Hint | null; // active hint (optimal continuation + highlighted block)
  lastResult: { phase: string; used: number; optimal: number | null } | null;
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
  const cube = solvedCube();
  return {
    method,
    scrambleIndex,
    phaseIndex: 0,
    mode: 'scramble',
    cube,
    targetCube: applyScramble(solvedCube(), scr.scramble),
    phaseStartCube: cloneCube(cube),
    movesThisPhase: [],
    showIdeal: false,
    phaseDone: phases0(method).map(() => false),
    coachText: '',
    coachBusy: false,
    connected: state?.connected ?? false,
    battery: state?.battery ?? null,
    status: 'Start with a solved cube, then apply the scramble above. The cube view follows along.',
    showSettings: false,
    log: state?.log ?? [],
    lastError: state?.lastError ?? '',
    hint: null,
    lastResult: null,
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

// Apply a single move and update mode/phase state (no render).
function step(move: string) {
  if (!move) return;
  try {
    state.cube = moveCube(state.cube, move);
  } catch {
    return; // ignore invalid token
  }
  if (state.mode === 'solve') state.movesThisPhase.push(move);
  state.hint = null; // position changed; any shown hint is stale
  afterChange();
}

// Called after any change to the cube (move or facelet resync).
function afterChange() {
  if (state.mode === 'scramble') {
    if (cubesEqual(state.cube, state.targetCube)) {
      state.mode = 'solve';
      state.phaseStartCube = cloneCube(state.cube);
      state.movesThisPhase = [];
      state.showIdeal = false;
      state.status = 'Scrambled! Build your first block.';
    }
  } else {
    checkPhaseCompletion();
  }
}

function handleMove(move: string) {
  step(move);
  render();
}

function handleManualMoves(text: string) {
  for (const tok of parseMoves(text)) step(tok);
  render();
}

function handleFacelets(facelets: string) {
  try {
    state.cube = cubeFromFacelets(facelets);
    afterChange();
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
    // Score: your moves vs the optimal solution to the block you actually built.
    const optimal = optimalFor(state.phaseStartCube, solved);
    state.lastResult = {
      phase: phase.name,
      used: state.movesThisPhase.length,
      optimal: optimal ? optimal.length : null,
    };
    state.phaseDone[state.phaseIndex] = true;
    state.hint = null;
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

function resetToSolved() {
  state = freshJourney(state.method, state.scrambleIndex);
  render();
}

function applyScrambleNow() {
  // Jump straight to the scrambled state (for off-cube / desktop practice).
  state.cube = cloneCube(state.targetCube);
  afterChange();
  render();
}

function rewindPhase() {
  state.cube = cloneCube(state.phaseStartCube);
  state.movesThisPhase = [];
  state.phaseDone[state.phaseIndex] = false;
  state.hint = null;
  state.status = 'Phase rewound to its starting state.';
  render();
}

function toggleIdeal() {
  state.showIdeal = !state.showIdeal;
  render();
}

function showHint() {
  const phase = currentPhase();
  if (!phase) return;
  const h = hintFor(state.cube, phase.family);
  if (!h) {
    state.status = 'No short hint found from here — try the AI coach.';
    state.hint = null;
  } else {
    state.hint = h;
    state.status = `Hint: next move ${h.moves[0]} (${h.moves.length} to finish this block).`;
  }
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

  // Live cube view
  const viewCard = el('div', 'card');
  viewCard.appendChild(el('h2', '', 'Cube view'));
  const wrap = el('div', 'cube-wrap');
  const highlight = state.hint ? new Set(goalPieceStickers(state.cube, state.hint.goal)) : null;
  wrap.appendChild(renderCubeNet(cubeToFaceletString(state.cube), highlight));
  viewCard.appendChild(wrap);
  viewCard.appendChild(
    el('div', 'hint', highlight
      ? 'Highlighted: the pieces for the block to build next — gather these.'
      : 'Reflects the model cube — the scramble and every move you make. Hold your cube white-up, green-front so it matches.'),
  );
  app.appendChild(viewCard);

  // Phase tracker
  const phaseCard = el('div', 'card');
  phaseCard.appendChild(el('h2', '', 'Journey'));
  const chips = el('div', 'phases');
  const solving = state.mode === 'solve';
  phases().forEach((p, i) => {
    const isCurrent = solving && i === state.phaseIndex;
    const cls = state.phaseDone[i] ? 'done' : isCurrent ? 'active' : '';
    const chip = el('div', `phase-chip ${cls}`);
    chip.appendChild(el('div', 'name', p.name));
    chip.appendChild(el('div', 'state', state.phaseDone[i] ? '✓ done' : isCurrent ? 'in progress' : 'upcoming'));
    chips.appendChild(chip);
  });
  phaseCard.appendChild(chips);
  app.appendChild(phaseCard);

  // Current phase / solved banner
  if (state.mode === 'scramble') {
    const sc = el('div', 'card');
    sc.appendChild(el('div', 'solved-banner', '🧩 Scramble mode — apply the scramble to your solved cube to begin.'));
    app.appendChild(sc);
  } else if (allDone) {
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
    actions.appendChild(btn('Hint', showHint, 'primary'));
    actions.appendChild(btn(state.showIdeal ? 'Hide ideal' : 'Show ideal', toggleIdeal));
    actions.appendChild(btn('Rewind phase', rewindPhase));
    cur.appendChild(actions);

    if (state.hint) {
      const h = state.hint;
      const box = el('div', 'ideal mono');
      box.innerHTML = `<span style="color:var(--accent-2)">next ▸ ${h.moves[0]}</span>　 ${h.moves.join(' ')}`;
      cur.appendChild(box);
      cur.appendChild(el('div', 'hint', `Optimal continuation to the nearest block (${h.moves.length} moves). The matching pieces are highlighted on the cube above.`));
    }

    if (state.showIdeal) {
      cur.appendChild(el('div', 'ideal mono', ideal ? ideal : '(no ideal available for this phase)'));
      cur.appendChild(el('div', 'hint', 'Optimal solution for this block from the scramble (white-up / green-front).'));
    }
    app.appendChild(cur);
  }

  // Efficiency result from the most recently completed block
  if (state.lastResult && state.mode === 'solve') {
    const r = state.lastResult;
    const card = el('div', 'card');
    card.appendChild(el('h2', '', 'Last block'));
    if (r.optimal != null) {
      const pct = Math.round((r.optimal / Math.max(r.used, 1)) * 100);
      const verdict = r.used <= r.optimal ? '🏆 optimal!' : r.used <= r.optimal + 2 ? '👍 very efficient' : pct >= 60 ? 'good — room to tighten' : 'lots of room to improve';
      card.appendChild(el('div', 'coach', `${r.phase}: you ${r.used} moves · optimal ${r.optimal} · ${pct}% efficient — ${verdict}`));
    } else {
      card.appendChild(el('div', 'coach', `${r.phase}: solved in ${r.used} moves.`));
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

// Build the unfolded cube net from a 54-char facelet string.
function renderCubeNet(f: string, highlight: Set<number> | null = null): HTMLElement {
  const net = el('div', 'cube-net');
  // facelet index ranges -> net face class
  const faces: [string, number][] = [
    ['up', 0],
    ['right', 9],
    ['front', 18],
    ['down', 27],
    ['left', 36],
    ['back', 45],
  ];
  for (const [cls, start] of faces) {
    const face = el('div', `cube-face ${cls}`);
    for (let i = 0; i < 9; i++) {
      const idx = start + i;
      const dim = highlight && !highlight.has(idx) ? ' dim' : '';
      face.appendChild(el('div', `sticker ${f[idx]}${dim}`));
    }
    net.appendChild(face);
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
