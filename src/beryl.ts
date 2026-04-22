import { Client, MessageType } from './client';
import EventEmitter from './event-emitter';
import { compareSemver } from './semver';
import type { ClientDescriptor, Settings } from './types';

const REGISTRY_PORT = 21000;
const CLIENT_PORT_START = 21001;
const CLIENT_PORT_END = 21020;
const RECONNECT_INTERVAL = 2000;
const REQUEST_TIMEOUT_MS = 10000;
const MIN_AGENT_VERSION = '1.0.0';

function promoteToRegistry(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      ws.send(new Uint8Array([MessageType.BECOME_REGISTRY]));
      ws.close();
      resolve();
    };
    ws.onerror = () => reject();
    ws.onclose = () => {};
  });
}

export type BerylEvents = {
  ready: () => void;
  error: (error: Error) => void;
  clientConnected: (data: { client: Client; name: string }) => void;
  clientDisconnected: (data: { name: string }) => void;
  version: (data: {
    agentVersion: string | null;
    minVersion: string;
    updateRequired: boolean;
  }) => void;
};

interface PendingFile {
  resolve: (value: ArrayBuffer) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingSettings {
  resolve: (settings: Settings) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class Beryl extends EventEmitter<BerylEvents> {
  private clientMap = new Map<string, Client>();
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hasScanned = false;
  private _nextFileId = 1;
  private _pendingFiles = new Map<number, PendingFile>();
  private _pendingSettings: PendingSettings[] = [];
  private _ready = false;
  private _lastEmittedVersion: string | null | undefined = undefined;

  get ready(): boolean {
    return this._ready;
  }

  connect(): void {
    this.ws = new WebSocket(`ws://localhost:${REGISTRY_PORT}`);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.hasScanned = false;
      this._ready = true;
      this.emit('ready');
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        this.handleFileResponse(event.data);
        return;
      }

      const message = JSON.parse(event.data as string);
      switch (message.type) {
        case 'init':
          this.checkAgentVersion(message.agentVersion ?? null);
          this.handleInit(message.clients);
          break;
        case 'add':
          this.handleAdd(message.client);
          break;
        case 'remove':
          this.handleRemove(message.name);
          break;
        case 'settings': {
          const pending = this._pendingSettings.shift();
          if (pending) {
            clearTimeout(pending.timer);
            const { type, ...settings } = message;
            pending.resolve(settings as Settings);
          }
          break;
        }
      }
    };

    this.ws.onclose = () => {
      this._ready = false;
      this.rejectAllPending(new Error('WebSocket disconnected'));

      const existing = this.clientMap.values().next().value;
      if (existing) {
        existing._becomeRegistry();
      } else if (!this.hasScanned) {
        this.hasScanned = true;
        this.scanForClients();
      }
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.emit('error', new Error('Registry WebSocket error'));
    };
  }

  readFile(path: string): Promise<ArrayBuffer> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not connected'));
    }

    const id = this._nextFileId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingFiles.delete(id);
        reject(new Error('File request timed out'));
      }, REQUEST_TIMEOUT_MS);
      this._pendingFiles.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ type: 'file', id, path }));
    });
  }

  getAllowedOrigins(): Promise<string[]> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not connected'));
    }

    return new Promise((resolve, reject) => {
      const entry: PendingSettings = {
        resolve: (settings) => resolve(settings.allowedOrigins ?? []),
        reject,
        timer: setTimeout(() => {
          const idx = this._pendingSettings.indexOf(entry);
          if (idx !== -1) this._pendingSettings.splice(idx, 1);
          reject(new Error('Settings request timed out'));
        }, REQUEST_TIMEOUT_MS),
      };
      this._pendingSettings.push(entry);
      this.ws!.send(JSON.stringify({ type: 'getSettings' }));
    });
  }

  setAllowedOrigins(origins: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(JSON.stringify({ type: 'setSettings', allowedOrigins: origins }));
  }

  private rejectAllPending(error: Error): void {
    for (const [, { reject, timer }] of this._pendingFiles) {
      clearTimeout(timer);
      reject(error);
    }
    this._pendingFiles.clear();

    for (const { reject, timer } of this._pendingSettings) {
      clearTimeout(timer);
      reject(error);
    }
    this._pendingSettings.length = 0;
  }

  private handleFileResponse(data: ArrayBuffer): void {
    const view = new DataView(data);
    if (data.byteLength < 5) return;

    const id = view.getUint32(0, true);
    const status = view.getUint8(4);

    const entry = this._pendingFiles.get(id);
    if (!entry) return;
    this._pendingFiles.delete(id);
    clearTimeout(entry.timer);

    if (status === 0x00) {
      entry.resolve(data.slice(5));
    } else if (status === 0x01) {
      entry.reject(new Error('File not found'));
    } else {
      entry.reject(new Error('File read error'));
    }
  }

  private handleAdd({ port, name }: ClientDescriptor): void {
    if (!name) return;

    let client = this.clientMap.get(name);

    if (!client) {
      client = new Client(name, port, (path) => this.readFile(path));

      client.on('close', () => {
        this.clientMap.delete(name);
        this.emit('clientDisconnected', { name });
      });

      this.clientMap.set(name, client);

      client
        .connect()
        .then(() => {
          this.emit('clientConnected', { client: client!, name });
        })
        .catch((err) => {
          console.error(`Failed to connect to client ${name}:`, err);
          this.clientMap.delete(name);
        });
    } else {
      this.emit('clientConnected', { client, name });
    }
  }

  private handleRemove(name: string): void {
    const client = this.clientMap.get(name);
    if (client) {
      client.close();
    }
  }

  private checkAgentVersion(agentVersion: string | null): void {
    if (this._lastEmittedVersion === agentVersion) return;
    this._lastEmittedVersion = agentVersion;
    const updateRequired = !agentVersion || compareSemver(agentVersion, MIN_AGENT_VERSION) < 0;
    this.emit('version', {
      agentVersion,
      minVersion: MIN_AGENT_VERSION,
      updateRequired,
    });
  }

  private handleInit(clientList: ClientDescriptor[]): void {
    const activeNames = new Set(clientList.map((c) => c.name));

    for (const [name, client] of this.clientMap) {
      if (!activeNames.has(name)) {
        client.close();
      }
    }

    for (const desc of clientList) {
      this.handleAdd(desc);
    }
  }

  private async scanForClients(): Promise<void> {
    for (let port = CLIENT_PORT_START; port <= CLIENT_PORT_END; port++) {
      try {
        await promoteToRegistry(port);
        return;
      } catch {
        // Port not active
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, RECONNECT_INTERVAL);
  }

  close(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
