// Thin wrapper around gan-web-bluetooth for GAN smart cubes.
//
// Tested target: GAN 356 i Carry 2 (Gen3 protocol). Also works with GAN i4
// Maglev and other GAN BLE cubes supported by the library.
//
// Requires the Web Bluetooth API. On iPad, use the Bluefy browser (Safari does
// not expose Web Bluetooth).

import { connectGanCube, type GanCubeConnection, type GanCubeEvent } from 'gan-web-bluetooth';

export interface CubeHandlers {
  onMove?: (move: string, serial: number) => void;
  onFacelets?: (facelets: string) => void;
  onBattery?: (level: number) => void;
  onConnect?: (name: string) => void;
  onDisconnect?: () => void;
  onError?: (err: unknown) => void;
}

export class CubeManager {
  private conn: GanCubeConnection | null = null;
  private handlers: CubeHandlers;
  private sub: { unsubscribe: () => void } | null = null;

  constructor(handlers: CubeHandlers = {}) {
    this.handlers = handlers;
  }

  get connected(): boolean {
    return this.conn !== null;
  }

  get deviceName(): string {
    return this.conn?.deviceName ?? '';
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  async connect(): Promise<void> {
    if (this.conn) return;
    try {
      this.conn = await connectGanCube();
      this.sub = this.conn.events$.subscribe((e: GanCubeEvent) => this.handleEvent(e));
      this.handlers.onConnect?.(this.conn.deviceName ?? 'GAN cube');
      // Ask the cube for its current facelets so we can sync state immediately.
      try {
        await this.conn.sendCubeCommand({ type: 'REQUEST_FACELETS' });
        await this.conn.sendCubeCommand({ type: 'REQUEST_BATTERY' });
      } catch {
        /* not all protocols support explicit requests; ignore */
      }
    } catch (err) {
      this.conn = null;
      this.handlers.onError?.(err);
      throw err;
    }
  }

  async requestFacelets(): Promise<void> {
    try {
      await this.conn?.sendCubeCommand({ type: 'REQUEST_FACELETS' });
    } catch (err) {
      this.handlers.onError?.(err);
    }
  }

  async disconnect(): Promise<void> {
    try {
      this.sub?.unsubscribe();
      await this.conn?.disconnect();
    } finally {
      this.sub = null;
      this.conn = null;
      this.handlers.onDisconnect?.();
    }
  }

  private handleEvent(e: GanCubeEvent): void {
    switch (e.type) {
      case 'MOVE':
        // e.move is a standard move string like "R" or "R'"
        this.handlers.onMove?.((e as any).move, (e as any).serial ?? 0);
        break;
      case 'FACELETS':
        this.handlers.onFacelets?.((e as any).facelets);
        break;
      case 'BATTERY':
        this.handlers.onBattery?.((e as any).batteryLevel ?? (e as any).level ?? 0);
        break;
      case 'DISCONNECT':
        this.handlers.onDisconnect?.();
        this.conn = null;
        break;
    }
  }
}
