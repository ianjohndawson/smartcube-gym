import { newSolved, applyMoves, parseMoves, optimalToMask } from '../src/engine-api.ts';
import { MASK_222_DLF } from '../src/blocks.ts';
import { nextFocusPiece } from '../src/pieces.ts';
import { MOVESETS } from '../src/engine-api.ts';
const cfg = { moveSet: MOVESETS.RUFLDB, pruningDepth: 4, depthLimit: 11 };
for (const scr of ["F2 B' D' U F' R2 U2 D B' L2 D' R F' B2 L2 B U2 D' L2 F2", "L' R U F R B2 F' R B2 L F' R' D F2 D2 U' F' D L D"]) {
  const moves = parseMoves(scr);
  const state = applyMoves(newSolved(), moves);
  const sol = optimalToMask(moves, MASK_222_DLF, cfg) ?? [];
  const fp = nextFocusPiece(state, MASK_222_DLF, sol);
  console.log(`sol=[${sol.join(' ')}]  next piece: ${fp?.description}  current facelets: ${fp?.current}`);
}
