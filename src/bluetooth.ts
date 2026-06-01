// Thin wrapper around gan-web-bluetooth for GAN smart cubes.
//
// Tested target: GAN 356 i Carry 2 (Gen3 protocol). Also works with GAN i4
// Maglev and other GAN BLE cubes supported by the library.
//
// Requires the Web Bluetooth API. On iPad, use the Bluefy browser (Safari does
// not expose Web Bluetooth).
//
// GAN cubes derive their AES key from the device MAC address, which Web
// Bluetooth does not expose directly. The library tries to read it from the BLE
// advertisement; when that fails (common on iOS/Bluefy) we fall back to a
// remembered/prompted MAC so the cube can still be decrypted.

import {
  connectGanCube,
  type GanCubeConnection,
  type GanCubeEvent,
  type MacAddressProvider,
} from 'gan-web-bluetooth';

export interface CubeHandlers {
  onMove?: (move: string, serial: number) => void;
  onFacelets?: (facelets: string) => void;
  onBattery?: (level: number) => void;
  onConnect?: (name: string) => void;
  onDisconnect?: () => void;
  onError?: (err: unknown) => void;
  onLog?: (line: string) => void; // human-readable trace of cube events
}

const MAC_KEY = 'block-trainer.cube-mac';
const MAC_RE = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;

export function getSavedMac(): string {
  return localStorage.getItem(MAC_KEY) ?? '';
}
export function clearSavedMac(): void {
  localStorage.removeItem(MAC_KEY);
}

const macProvider: MacAddressProvider = async (_device, isFallbackCall) => {
  const cached = getSavedMac();
  if (cached) return cached;
  // Let the library attempt automatic detection first.
  if (!isFallbackCall) return null;
  // Last resort: ask the user for the MAC and remember it.
  const entered = window.prompt(
    "Couldn't read the cube's MAC address automatically.\n\n" +
      'Enter your GAN cube Bluetooth MAC (format AA:BB:CC:DD:EE:FF).\n' +
      'Find it in the GAN app, or with a BLE scanner app (e.g. nRF Connect / LightBlue).',
    '',
  );
  const v = entered?.trim().toUpperCase().replace(/-/g, ':') ?? '';
  if (MAC_RE.test(v)) {
    localStorage.setItem(MAC_KEY, v);
    return v;
  }
  return null;
};

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
      this.handlers.onLog?.('Requesting cube…');
      this.conn = await connectGanCube(macProvider);
      this.sub = this.conn.events$.subscribe((e: GanCubeEvent) => this.handleEvent(e));
      this.handlers.onLog?.(`Connected: ${this.conn.deviceName} (MAC ${this.conn.deviceMAC || 'unknown'})`);
      this.handlers.onConnect?.(this.conn.deviceName ?? 'GAN cube');
      // Pull current state + battery so the UI has something immediately.
      try {
        await this.conn.sendCubeCommand({ type: 'REQUEST_HARDWARE' });
        await this.conn.sendCubeCommand({ type: 'REQUEST_BATTERY' });
        await this.conn.sendCubeCommand({ type: 'REQUEST_FACELETS' });
      } catch {
        /* not all protocols support explicit requests; ignore */
      }
    } catch (err) {
      this.conn = null;
      this.handlers.onLog?.(`Connect failed: ${msg(err)}`);
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
        this.handlers.onLog?.(`MOVE ${(e as any).move}`);
        this.handlers.onMove?.((e as any).move, (e as any).serial ?? 0);
        break;
      case 'FACELETS':
        this.handlers.onLog?.('FACELETS sync');
        this.handlers.onFacelets?.((e as any).facelets);
        break;
      case 'BATTERY':
        this.handlers.onLog?.(`BATTERY ${(e as any).batteryLevel}%`);
        this.handlers.onBattery?.((e as any).batteryLevel ?? 0);
        break;
      case 'HARDWARE':
        this.handlers.onLog?.(`HARDWARE ${(e as any).hardwareName ?? ''} v${(e as any).softwareVersion ?? '?'}`);
        break;
      case 'GYRO':
        break; // ignore, too chatty
      case 'DISCONNECT':
        this.handlers.onLog?.('DISCONNECT');
        this.handlers.onDisconnect?.();
        this.conn = null;
        break;
    }
  }
}

function msg(err: unknown): string {
  return String((err as Error)?.message ?? err);
}
