import { newSolved, applyMoves, faceletString, parseMoves, optimalToMask, MOVESETS, isMaskSolvedFromHistory } from '../src/engine-api.ts';
import { translateMoves, MOVE_PERMS } from '../src/engine/puzzles/cube3x3/index.ts';
import { MASKS } from '../src/engine/puzzles/cube3x3/index.ts';

// 1. x2 is applyable as a single move
const v = applyMoves(newSolved(), ['x2' as any]);
console.log('x2 view of solved (U row should be D=yellow letters):', faceletString(v).slice(0,9));

// 2. translateMoves model->display under x2
const ideal = optimalToMask(parseMoves("F2 B' D' U F' R2 U2 D B' L2 D' R F' B2 L2 B U2 D' L2 F2"), MASKS.EO as any, { moveSet: MOVESETS.RUFLDB, pruningDepth:4, depthLimit:8 }) ?? [];
const disp = translateMoves(ideal, ['x2']);
const back = translateMoves(disp, ['x2']);
console.log('model ideal:', ideal.join(' '));
console.log('display(x2):', disp.join(' '));
console.log('round-trip == model:', back.join(' ') === ideal.join(' '));

// 3. Performing the DISPLAY moves on an x2-held cube == performing model moves (solves EO)
// held cube = solved rotated x2; user does display moves; net effect on model = model ideal.
// Simulate: model state after scramble; apply model ideal -> EO solved. Confirm.
const scr = parseMoves("F2 B' D' U F' R2 U2 D B' L2 D' R F' B2 L2 B U2 D' L2 F2");
console.log('model ideal solves EO:', isMaskSolvedFromHistory([...scr, ...ideal], MASKS.EO as any));

// 4. view permutation from MOVE_PERMS x2
const P = Array.from({length:54}, (_,i)=>i);
for (const [src,dst] of (MOVE_PERMS as any)['x2']) P[dst] = src;
console.log('x2 perm sample P[0..8]:', P.slice(0,9).join(','));
