// Verify the full resync handler path: a Kociemba facelet string from a drifted
// cube converts to net, rebuilds the true Cube3x3, and findBridge recovers the
// exact drift moves (for small drift) so history stays valid.
import { solvedCube, applyMoveList, cubeToFaceletString } from '../src/cube.ts';
import {
  newSolved,
  applyMoves,
  cubeFromFacelets,
  findBridge,
  type Move3x3,
} from '../src/engine-api.ts';
import { kociembaToNet } from '../src/resync.ts';

const FACES = ['U', 'D', 'L', 'R', 'F', 'B'];
const SUF = ['', '2', "'"];
function rnd(n: number): string[] {
  const o: string[] = [];
  let last = '';
  while (o.length < n) {
    const f = FACES[Math.floor(Math.random() * 6)];
    if (f === last) continue;
    last = f;
    o.push(f + SUF[Math.floor(Math.random() * 3)]);
  }
  return o;
}

let bridged = 0;
let exact = 0;
let hard = 0;
const N = 2000;
for (let t = 0; t < N; t++) {
  const base = rnd(10) as Move3x3[];
  const drift = rnd(1 + Math.floor(Math.random() * 4)) as Move3x3[]; // 1..4 extra moves

  // model = where the app *thinks* it is (base only); cube = true (base+drift)
  const model = applyMoves(newSolved(), base);
  const koc = cubeToFaceletString(applyMoveList(solvedCube(), [...base, ...drift]));
  const trueCube = cubeFromFacelets(kociembaToNet(koc));

  const bridge = findBridge(model, trueCube, 4);
  if (bridge) {
    bridged++;
    // applying the bridge to the model must reproduce the true cube
    if (applyMoves(model, bridge).encode() === trueCube.encode()) exact++;
  } else {
    hard++;
  }
}
console.log(`bridge recovered: ${bridged}/${N}, exact reproduction: ${exact}/${bridged}, hard (>4): ${hard}`);
if (bridged !== N || exact !== bridged) process.exitCode = 1;
