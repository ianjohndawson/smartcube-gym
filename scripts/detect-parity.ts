import { newSolved, applyMoves, parseMoves, optimalToMask, MOVESETS, isMaskSolvedState, type Move3x3, type Cube3x3Mask } from '../src/engine-api.ts';
import { anySolved, isMaskSolvedFromHistory } from './oracles.ts';
import { MASKS } from '../src/engine/puzzles/cube3x3/index.ts';
import { all222Masks, all223Masks, all123Masks } from '../src/blocks.ts';

const FACES=['U','D','L','R','F','B'], SUF=['','2',"'"];
const rnd=(n:number)=>{const o:string[]=[];let l='';while(o.length<n){const f=FACES[Math.floor(Math.random()*6)];if(f===l)continue;l=f;o.push(f+SUF[Math.floor(Math.random()*3)]);}return o as Move3x3[];};

const eoMasks: Cube3x3Mask[] = [MASKS.EO as any, MASKS.EOLine as any, MASKS.EOCross as any];
const blockMasks: Cube3x3Mask[] = [...all222Masks(), ...all223Masks(), ...all123Masks()];

let fail=0, eoTrue=0, blkTrue=0, n=0;
const cfg={moveSet:MOVESETS.RUFLDB,pruningDepth:4,depthLimit:8};
for(let t=0;t<1500;t++){
  let S = rnd(10);
  // half the time, solve EO so we get positive EO cases
  if(t%2===0){ const sol = optimalToMask(S, MASKS.EO as any, cfg) ?? []; S=[...S,...sol]; }
  const cube = applyMoves(newSolved(), S);
  for(const m of eoMasks){ const a=isMaskSolvedFromHistory(S,m); const b=isMaskSolvedState(cube,m); if(a)eoTrue++; if(a!==b){fail++; if(fail<=5)console.log('EO mismatch',a,b);} n++; }
  for(const m of blockMasks){ const a=anySolved(cube,[m]); const b=isMaskSolvedState(cube,m); if(a)blkTrue++; if(a!==b){fail++; if(fail<=5)console.log('BLK mismatch',a,b);} n++; }
}
console.log(`checks ${n}, EO-true ${eoTrue}, block-true ${blkTrue}, mismatches ${fail}`);
console.log(fail===0?'PARITY OK — state-based detection matches existing':'PARITY FAILED');
if (fail !== 0) process.exitCode = 1;
