// Small, testable pieces of the smart-cube synchronisation state machine.
// Kept independent of the cube engine and DOM so connection races can be covered
// by the ordinary `npm run check` harness instead of requiring real BLE hardware.

export class MoveSeedGate<T> {
  private waiting = false;
  private queued: T[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  get active(): boolean {
    return this.waiting;
  }

  begin(timeoutMs: number, onTimeout: (queued: T[]) => void): void {
    this.cancel();
    this.waiting = true;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.waiting) return;
      onTimeout(this.release());
    }, timeoutMs);
  }

  /** Queue a move while seeding. Returns false when the move should run now. */
  capture(move: T): boolean {
    if (!this.waiting) return false;
    this.queued.push(move);
    return true;
  }

  /** Finish seeding and return every queued move exactly once, in arrival order. */
  release(): T[] {
    if (!this.waiting) return [];
    this.waiting = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    return this.queued.splice(0);
  }

  /** Abandon a connection attempt without replaying its moves. */
  cancel(): void {
    this.waiting = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queued = [];
  }
}

export function cubeIsAtRest(lastMoveAt: number, now: number, restMs: number): boolean {
  return now - lastMoveAt >= restMs;
}
