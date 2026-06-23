// Cross-validate the new facelet-mask block detection (crystalcube engine)
// against the original cubie-based detection, over many random states.
import { solvedCube, moveCube, all222, all223, all123, goalSolved, type BlockGoal, type CubieCube } from '../src/cube.ts';
import { Cube3x3, type Move3x3, type Cube3x3Mask } from '../src/engine/puzzles/cube3x3/index.ts';
import { all222Masks, all223Masks, all123Masks, NET_COORDS } from '../src/blocks.ts';

// coord-map spot checks vs known engine centres
const centers: Record<number, [number, number, number]> = {
  4: [1, 2, 1], 22: [0, 1, 1], 25: [1, 1, 2], 28: [2, 1, 1], 31: [1, 1, 0], 49: [1, 0, 1],
};
let coordOk = true;
for (const [idx, exp] of Object.entries(centers)) {
  const got = NET_COORDS[+idx];
  if (got[0] !== exp[0] || got[1] !== exp[1] || got[2] !== exp[2]) {
    coordOk = false;
    console.log(`coord MISMATCH at ${idx}: got ${got} exp ${exp}`);
  }
}
console.log('centre coords OK:', coordOk);

const FACES = ['U', 'D', 'L', 'R', 'F', 'B'];
const SUF = ['', '2', "'"];
function randScramble(n: number): Move3x3[] {
  const out: string[] = [];
  let last = '';
  while (out.length < n) {
    const f = FACES[Math.floor(Math.random() * 6)];
    if (f === last) continue;
    last = f;
    out.push(f + SUF[Math.floor(Math.random() * 3)]);
  }
  return out as Move3x3[];
}

function maskSolved(c: Cube3x3, mask: Cube3x3Mask): boolean {
  return c.clone().applyMask(mask).isSolved();
}

const families: [string, () => BlockGoal[], () => Cube3x3Mask[]][] = [
  ['222', all222, all222Masks],
  ['223', all223, all223Masks],
  ['123', all123, all123Masks],
];

let mismatches = 0;
let solvedHits = 0;
const TRIALS = 2000;
for (let t = 0; t < TRIALS; t++) {
  const scr = randScramble(8 + Math.floor(Math.random() * 8));
  let our: CubieCube = solvedCube();
  for (const m of scr) our = moveCube(our, m);
  const eng = new Cube3x3().applyMoves(scr);

  for (const [, goalsFn, masksFn] of families) {
    const goals = goalsFn();
    const masks = masksFn();
    if (goals.length !== masks.length) {
      console.log('length mismatch!', goals.length, masks.length);
      mismatches++;
      continue;
    }
    for (let i = 0; i < goals.length; i++) {
      const oldSolved = goalSolved(our, goals[i]);
      const newSolved = maskSolved(eng, masks[i]);
      if (oldSolved) solvedHits++;
      if (oldSolved !== newSolved) {
        mismatches++;
        if (mismatches <= 5) console.log(`mismatch trial ${t} family idx ${i}: old=${oldSolved} new=${newSolved}`);
      }
    }
  }
}
console.log(`\n${TRIALS} trials, solved-block hits seen: ${solvedHits}, detection mismatches: ${mismatches}`);
console.log(mismatches === 0 ? 'PARITY OK — new mask detection matches old cubie detection.' : 'PARITY FAILED');
if (mismatches !== 0 || !coordOk) process.exitCode = 1;
