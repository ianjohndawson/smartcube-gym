// Convert a GAN cube's Kociemba facelet string into the engine's net-order
// facelet string, so we can resync the model to the cube's true state.
//
// Both representations describe the same 54 stickers; each sticker is uniquely
// identified by (cubie coordinate, face). We map net index -> Kociemba index by
// matching those, then reorder the colour string.

import { KOCIEMBA_FACELET_COORDS } from './cube.ts';
import { NET_COORDS } from './blocks.ts';

// Face of an engine net-order facelet: U(0-8), band L|F|R|B (9-44), D(45-53).
function netFace(n: number): string {
  if (n < 9) return 'U';
  if (n >= 45) return 'D';
  const col = (n - 9) % 12;
  return col < 3 ? 'L' : col < 6 ? 'F' : col < 9 ? 'R' : 'B';
}
// Face of a Kociemba facelet: blocks of 9 in order U R F D L B.
function kocFace(k: number): string {
  return 'URFDLB'[Math.floor(k / 9)];
}

// NET_TO_KOC[n] = the Kociemba index of the sticker shown at engine net index n.
const NET_TO_KOC: number[] = (() => {
  const byKey = new Map<string, number>();
  for (let k = 0; k < 54; k++) byKey.set(KOCIEMBA_FACELET_COORDS[k].join(',') + kocFace(k), k);
  return NET_COORDS.map((co, n) => {
    const key = co.join(',') + netFace(n);
    const k = byKey.get(key);
    if (k === undefined) throw new Error(`resync: no Kociemba facelet for net ${n} (${key})`);
    return k;
  });
})();

/** Reorder a Kociemba facelet string (URFDLB) into the engine's net order. */
export function kociembaToNet(koc: string): string {
  return NET_TO_KOC.map((k) => koc[k]).join('');
}
