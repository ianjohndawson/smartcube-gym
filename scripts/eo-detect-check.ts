import { Cube3x3, newSolved, applyMoves, parseMoves, optimalToMask, MOVESETS, anySolved, type Move3x3, type Cube3x3Mask } from '../src/engine-api.ts';
import { MASKS } from '../src/engine/puzzles/cube3x3/index.ts';

const EO = MASKS.EO as Cube3x3Mask;
const cfg = { moveSet: MOVESETS.RUFLDB, pruningDepth: 4, depthLimit: 8 };
const scr = parseMoves("F2 B' D' U F' R2 U2 D B' L2 D' R F' B2 L2 B U2 D' L2 F2");

// state-based (block-style) detection — expected to be WRONG for EO
const stateBased = (history: Move3x3[]) => anySolved(applyMoves(newSolved(), history), [EO]);
// history-based detection — apply mask to solved, then moves
const histBased = (history: Move3x3[]) => new Cube3x3().applyMask(EO).applyMoves([...history]).isSolved();

const sol = optimalToMask(scr, EO, cfg) ?? [];
const solved = [...scr, ...sol];
console.log('EO optimal:', sol.join(' '), `(${sol.length} moves)`);
console.log('BEFORE solving EO:  state-based=', stateBased(scr), ' history-based=', histBased(scr));
console.log('AFTER  solving EO:  state-based=', stateBased(solved), ' history-based=', histBased(solved));
