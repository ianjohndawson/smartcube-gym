import { solvedCube, applyMoveList, cubeToFaceletString } from '../src/cube.ts';
import { newSolved, applyMoves, faceletString, type Move3x3 } from '../src/engine-api.ts';
import { kociembaToNet } from '../src/resync.ts';

const FACES = ['U','D','L','R','F','B']; const SUF = ['','2',"'"];
function rnd(n:number){ const o:string[]=[]; let last=''; while(o.length<n){const f=FACES[Math.floor(Math.random()*6)]; if(f===last)continue; last=f; o.push(f+SUF[Math.floor(Math.random()*3)]);} return o; }

let pass=0, fail=0;
for(let t=0;t<3000;t++){
  const S = rnd(12);
  const koc = cubeToFaceletString(applyMoveList(solvedCube(), S));      // Kociemba string (our independent model)
  const net = faceletString(applyMoves(newSolved(), S as Move3x3[]));   // engine net string
  const converted = kociembaToNet(koc);
  if (converted === net) pass++; else { fail++; if(fail<=3){ console.log('MISMATCH', S.join(' ')); console.log(' conv:', converted); console.log(' net :', net);} }
}
console.log(`resync conversion: pass ${pass}, fail ${fail}`);
console.log(kociembaToNet.length !== undefined ? 'fn ok' : '');
