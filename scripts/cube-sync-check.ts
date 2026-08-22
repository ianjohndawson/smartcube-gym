// Behavioural harness for the connection seed gate and idle snapshot policy.
// These are the two synchronisation rules shared by every EO and block trainer.

import { cubeIsAtRest, MoveSeedGate } from '../src/cube-sync.ts';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ ${name}`); }
}
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// A missing initial FACELETS response must release every buffered turn in order.
const timed = new MoveSeedGate<string>();
let timedOut: string[] | null = null;
timed.begin(15, (queued) => { timedOut = queued; });
check('seed gate captures while waiting', timed.capture('R') && timed.capture("U'"));
await wait(30);
check('seed timeout releases in order', JSON.stringify(timedOut) === JSON.stringify(['R', "U'"]));
check('seed gate opens after timeout', !timed.active && !timed.capture('F'));

// A valid snapshot must cancel the timeout and release the queue exactly once.
const landed = new MoveSeedGate<string>();
let lateTimeouts = 0;
landed.begin(15, () => { lateTimeouts++; });
landed.capture('L');
landed.capture('D2');
const released = landed.release();
await wait(30);
check('snapshot releases queued moves', JSON.stringify(released) === JSON.stringify(['L', 'D2']));
check('released queue cannot replay twice', landed.release().length === 0);
check('snapshot cancels seed timeout', lateTimeouts === 0);

// Disconnect must discard a half-open seed attempt without a delayed callback.
const cancelled = new MoveSeedGate<string>();
let cancelledTimeouts = 0;
cancelled.begin(15, () => { cancelledTimeouts++; });
cancelled.capture('B');
cancelled.cancel();
await wait(30);
check('disconnect cancels seed timeout', cancelledTimeouts === 0);
check('disconnect clears queued moves', cancelled.release().length === 0);

check('snapshot inside rest window is rejected', !cubeIsAtRest(1000, 1699, 700));
check('snapshot at rest boundary is accepted', cubeIsAtRest(1000, 1700, 700));
check('long-idle snapshot is accepted', cubeIsAtRest(1000, 5000, 700));

console.log(`cube-sync-check ${pass}/${pass + fail}`);
if (fail) {
  console.log(`CUBE SYNC FAILED — ${fail} mismatch${fail === 1 ? '' : 'es'}`);
  process.exitCode = 1;
} else {
  console.log('CUBE SYNC OK — seed timeout preserves moves; idle snapshots are gated');
}
