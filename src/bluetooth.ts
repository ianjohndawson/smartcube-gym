// Thin wrapper around smartcube-web-bluetooth (poliva), a multi-protocol smart-cube
// BLE library. It speaks GAN (Gen1-4), MoYu (AI 2023 / MHC / WRM / WCU_MY3), QiYi,
// Giiker/Mi and GoCube/Rubik's Connected behind one unified `events$` stream — so
// the trainer works beyond just GAN cubes. (Replaces the earlier GAN-only
// gan-web-bluetooth wrapper; the event shape — MOVE/FACELETS/BATTERY/HARDWARE/
// DISCONNECT — is the same, so the rest of the app is unchanged.)
//
// FACELETS arrives as a Kociemba-order string, which is what resync.ts expects.
//
// Requires the Web Bluetooth API. On iPad, use the Bluefy browser (Safari does not
// expose Web Bluetooth).
//
// Some cubes (notably GAN) derive their decryption key from the device MAC, which
// Web Bluetooth does not expose. The library resolves it where it can; otherwise we
// fall back to a remembered/prompted MAC so the cube can still be decrypted.

import { connectSmartCube, type SmartCubeConnection, type SmartCubeEvent } from 'smartcube-web-bluetooth';
import * as store from './storage.ts';

export interface CubeHandlers {
  onMove?: (move: string) => void;
  onFacelets?: (facelets: string) => void;
  onBattery?: (level: number) => void;
  onConnect?: (name: string) => void;
  onDisconnect?: () => void;
  onError?: (err: unknown) => void;
  onLog?: (line: string) => void; // human-readable trace of cube events
}

const MAC_RE = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;

// Cube MACs are remembered PER DEVICE (keyed by the browser's stable per-origin
// device id), so one cube's MAC is never handed to a different cube — the bug that
// made a second cube try to decrypt with the first cube's key.
type MacMap = Record<string, string>;
const macKeyFor = (device: BluetoothDevice): string => device.id || device.name || '';
function loadMacs(): MacMap {
  return store.getJSON<MacMap>('cube-mac', {});
}
function getMacFor(device: BluetoothDevice): string {
  const k = macKeyFor(device);
  return k ? loadMacs()[k] ?? '' : '';
}
function saveMacFor(device: BluetoothDevice, mac: string): void {
  const k = macKeyFor(device);
  if (!k) return;
  const macs = loadMacs();
  macs[k] = mac;
  store.setJSON('cube-mac', macs);
}
export function getSavedMacs(): MacMap {
  return loadMacs();
}
export function clearSavedMacs(): void {
  store.removeRaw('cube-mac');
}

// The library accepts a MAC provider with this signature; it isn't exported as a
// named type, so we mirror it locally.
type MacAddressProvider = (device: BluetoothDevice, isFallbackCall?: boolean) => Promise<string | null>;

const macProvider: MacAddressProvider = async (device, isFallbackCall) => {
  const cached = getMacFor(device);
  if (cached) return cached;
  // Let the library attempt automatic detection first.
  if (!isFallbackCall) return null;
  // Last resort: ask the user for the MAC and remember it.
  const entered = window.prompt(
    "Couldn't read the cube's MAC address automatically.\n\n" +
      "Enter your cube's Bluetooth MAC (format AA:BB:CC:DD:EE:FF).\n" +
      'Find it in the cube\'s official app, or with a BLE scanner (e.g. nRF Connect / LightBlue).',
    '',
  );
  const v = entered?.trim().toUpperCase().replace(/-/g, ':') ?? '';
  if (MAC_RE.test(v)) {
    saveMacFor(device, v);
    return v;
  }
  return null;
};

export class CubeManager {
  private conn: SmartCubeConnection | null = null;
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
      this.conn = await connectSmartCube({
        macAddressProvider: macProvider,
        // Let the library probe the address for QiYi / MoYu32 cubes when the
        // advertisement and name hints don't reveal it (only kicks in for those
        // protocols; GAN auto-reads its MAC and is unaffected).
        enableAddressSearch: true,
        // Surface the library's resolution/status messages in the cube event log
        // (invaluable for diagnosing a new cube on real hardware).
        onStatus: (m) => this.handlers.onLog?.(m),
      });
      this.sub = this.conn.events$.subscribe((e: SmartCubeEvent) => this.handleEvent(e));
      const { deviceName, deviceMAC, protocol } = this.conn;
      this.handlers.onLog?.(`Connected: ${deviceName} [${protocol.name}] (MAC ${deviceMAC || 'unknown'})`);
      this.handlers.onConnect?.(deviceName || protocol.name || 'Smart cube');
      // Pull current state + battery so the UI has something immediately — but only
      // the commands this cube actually supports.
      const caps = this.conn.capabilities;
      try {
        if (caps.hardware) await this.conn.sendCommand({ type: 'REQUEST_HARDWARE' });
        if (caps.battery) await this.conn.sendCommand({ type: 'REQUEST_BATTERY' });
        if (caps.facelets) await this.conn.sendCommand({ type: 'REQUEST_FACELETS' });
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
      if (this.conn?.capabilities.facelets) await this.conn.sendCommand({ type: 'REQUEST_FACELETS' });
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

  private handleEvent(e: SmartCubeEvent): void {
    switch (e.type) {
      case 'MOVE':
        this.handlers.onLog?.(`MOVE ${e.move}`);
        this.handlers.onMove?.(e.move);
        break;
      case 'FACELETS':
        this.handlers.onLog?.('FACELETS sync');
        this.handlers.onFacelets?.(e.facelets);
        break;
      case 'BATTERY':
        this.handlers.onLog?.(`BATTERY ${e.batteryLevel}%`);
        this.handlers.onBattery?.(e.batteryLevel ?? 0);
        break;
      case 'HARDWARE':
        this.handlers.onLog?.(`HARDWARE ${e.hardwareName ?? ''} v${e.softwareVersion ?? '?'}`);
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
