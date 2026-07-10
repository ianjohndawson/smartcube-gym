// Tiny DOM construction helpers used throughout the UI layer: `el` (element with
// optional class/text), `btn` (button with click handler), and the two cube views
// — `renderCubeNet` (the 54-sticker unfolded net) and `renderCube3D` (a spinnable
// 3D orbit cube with floating back-view hint panels). Pure DOM — no app state,
// except the persisted 3D camera orientation (see below).

import { NET_COORDS } from './blocks.ts';

export function el(tag: string, className = '', text = ''): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

export function btn(label: string, onClick: () => void, className = '', disabled = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (className) b.className = className;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

export function renderCubeNet(f: string, highlight: Set<number> | null = null, blank: Set<number> | null = null): HTMLElement {
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

// ── 3D orbit cube ──────────────────────────────────────────────────────────
// A spinnable alternative to the flat net, in the CrystalCube idiom: a solid cube
// you drag to orbit, ringed by floating "back-view" panels so the hidden faces
// stay readable (essential for EO bad-edge highlights on the far side). Geometry
// and transforms are ported from the verified CSS-3D spike; the numbers here
// (4u hint distance, ≥34u perspective, home tilt) are load-bearing and match it.
// Colours are NOT set here — the sticker elements reuse the .sticker.<colour>
// classes that the net view uses, so all four themes restyle both views from one
// source (see style.css). Only geometry/placement lives in CSS scoped to .cube-3d.

type Face = 'U' | 'D' | 'L' | 'R' | 'F' | 'B';
const FACES: readonly Face[] = ['U', 'D', 'L', 'R', 'F', 'B'];

// The geometric face a facelet sits on. U is the whole top (0–8), D the whole
// bottom (45–53); the middle "band" repeats L,L,L,F,F,F,R,R,R,B,B,B every 12 —
// the same layout src/blocks.ts encodes as NET_COORDS.
function faceOf(i: number): Face {
  if (i < 9) return 'U';
  if (i >= 45) return 'D';
  return (['L', 'L', 'L', 'F', 'F', 'F', 'R', 'R', 'R', 'B', 'B', 'B'] as const)[(i - 9) % 12];
}

// The 26 cubies, each as its coordinate plus the facelet index living on each of
// its stickered faces. Grouped once from NET_COORDS (which is constant), so a
// re-render just walks this table — cheap, which matters because main.ts rebuilds
// the whole cube subtree on every move.
interface Cubie3D { x: number; y: number; z: number; faces: Map<Face, number>; }
const CUBIES_3D: readonly Cubie3D[] = (() => {
  const byCoord = new Map<string, Cubie3D>();
  NET_COORDS.forEach((c, i) => {
    const k = c.join(',');
    let cu = byCoord.get(k);
    if (!cu) { cu = { x: c[0], y: c[1], z: c[2], faces: new Map() }; byCoord.set(k, cu); }
    cu.faces.set(faceOf(i), i);
  });
  return [...byCoord.values()];
})();

// Camera orientation PERSISTS in module scope, not on the DOM node. main.ts
// re-renders the entire app (appEl.replaceChildren) on every cube move, so a per-
// element orientation would snap back to home on every turn; holding it here lets
// the spin survive re-renders. Home tilt is the spike's rotateX(-30) rotateY(-38);
// pitch is clamped to ±45° so you can't flip under/over the cube.
let cube3dPitch = -30;
let cube3dYaw = -38;
const CUBE3D_PITCH_LIMIT = 45;

/** A spinnable 3D cube. Same argument semantics as {@link renderCubeNet}:
 *  `f` is a 54-char facelet string already in the display frame; `highlight`
 *  rings/glows those sticker indices AND their floating hint-panel twins (so a
 *  bad-edge highlight is legible on a hidden face); `blank` renders those stickers
 *  as plain plastic (the pure-EO corner blanking). */
export function renderCube3D(f: string, highlight: Set<number> | null = null, blank: Set<number> | null = null): HTMLElement {
  const stage = el('div', 'cube-3d-stage');
  stage.tabIndex = 0; // keyboard-focusable so arrow keys can spin it
  stage.setAttribute('role', 'img');
  stage.setAttribute('aria-label', 'Cube view — drag or use the arrow keys to spin');

  const scene = el('div', 'cube-3d-scene');
  const cube = el('div', 'cube-3d');
  scene.appendChild(cube);
  stage.appendChild(scene);

  for (const cu of CUBIES_3D) {
    const cubie = el('div', 'c3-cubie');
    // Cubie coord → position: x 0=L..2=R, y 0=D..2=U, z 0=B..2=F, centred on 1,1,1.
    cubie.style.transform =
      `translate3d(calc(var(--u) * ${cu.x - 1}), calc(var(--u) * ${1 - cu.y}), calc(var(--u) * ${cu.z - 1}))`;
    for (const face of FACES) {
      const faceEl = el('div', `c3-face f-${face}`);
      const i = cu.faces.get(face);
      if (i !== undefined) {
        const isBlank = blank?.has(i);
        const lit = !isBlank && !!highlight?.has(i);
        // Reuse the net's colour classes: `sticker <colour>` (or `sticker blank`)
        // for the fill/bevel, `hl` for the ring — all theme-aware in style.css.
        const cls = isBlank ? 'sticker blank' : `sticker ${f[i]}`;
        const sticker = el('div', `c3-sticker ${cls}${lit ? ' hl' : ''}`);
        sticker.dataset.faceletIndex = String(i); // for a future tap-to-name input
        faceEl.appendChild(sticker);
        // The floating back-view twin: a plane on the CUBIE (its own transform,
        // pushed 4u out and flipped), carrying the same colour + highlight.
        cubie.appendChild(el('div', `c3-hint ${cls}${lit ? ' hl' : ''} h-${face}`));
      }
      cubie.appendChild(faceEl);
    }
    cube.appendChild(cubie);
  }

  // Apply the persisted orientation immediately so the fresh node shows the same
  // spin the last render did. Only this one transform changes during a drag.
  const applyView = () => {
    cube3dPitch = Math.max(-CUBE3D_PITCH_LIMIT, Math.min(CUBE3D_PITCH_LIMIT, cube3dPitch));
    cube.style.transform = `rotateX(${cube3dPitch}deg) rotateY(${cube3dYaw}deg)`;
  };
  applyView();

  // Orbit: pointer drag (yaw free, pitch clamped), light inertia on release, arrow
  // keys. Inertia and the highlight pulse are skipped under reduced-motion.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let drag: { x: number; y: number } | null = null;
  let vYaw = 0;
  let vPitch = 0;
  function inertia() {
    // Stop if a re-render has since swapped this node out, or the glide has decayed.
    if (drag || !stage.isConnected || (Math.abs(vYaw) < 0.06 && Math.abs(vPitch) < 0.06)) return;
    cube3dYaw += vYaw;
    cube3dPitch += vPitch;
    vYaw *= 0.92;
    vPitch *= 0.92;
    applyView();
    requestAnimationFrame(inertia);
  }
  stage.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    vYaw = vPitch = 0;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    cube3dYaw += dx * 0.45;
    cube3dPitch -= dy * 0.45;
    vYaw = dx * 0.45;
    vPitch = -dy * 0.45;
    applyView();
  });
  stage.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    if (!reduced) inertia();
  });
  stage.addEventListener('pointercancel', () => { drag = null; });
  stage.addEventListener('keydown', (e) => {
    const step = 9;
    if (e.key === 'ArrowLeft') cube3dYaw -= step;
    else if (e.key === 'ArrowRight') cube3dYaw += step;
    else if (e.key === 'ArrowUp') cube3dPitch -= step;
    else if (e.key === 'ArrowDown') cube3dPitch += step;
    else return;
    e.preventDefault();
    applyView();
  });

  return stage;
}
