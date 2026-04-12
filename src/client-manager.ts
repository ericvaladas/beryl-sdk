import { Client } from './client';
import type { ClientDescriptor } from './types';

const REGISTRY_URL = 'ws://localhost:21000';
const RECONNECT_INTERVAL = 2000;
const CLIENT_PORT_START = 21001;
const CLIENT_PORT_END = 21020;
const MSG_BECOME_REG = 0x06;

function promoteToRegistry(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      ws.send(new Uint8Array([MSG_BECOME_REG]));
      ws.close();
      resolve();
    };
    ws.onerror = () => reject();
    ws.onclose = () => {};
  });
}

export interface ClientManagerOptions {
  onReady?: () => void;
  onClientConnected: (data: { client: Client; name: string }) => void;
  onClientDisconnected: (data: { pid: number }) => void;
}

interface PendingFile {
  resolve: (value: ArrayBuffer) => void;
  reject: (reason: Error) => void;
}

export class ClientManager {
  private options: ClientManagerOptions;
  private clientMap = new Map<number, Client>();
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hasScanned = false;
  private _nextFileId = 1;
  private _pendingFiles = new Map<number, PendingFile>();

  constructor(options: ClientManagerOptions) {
    this.options = options;
  }

  connect(): void {
    this.ws = new WebSocket(REGISTRY_URL);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.hasScanned = false;
      this.options.onReady?.();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        this.handleFileResponse(event.data);
        return;
      }

      const message = JSON.parse(event.data as string);
      switch (message.type) {
        case 'init':
          this.handleInit(message.clients);
          break;
        case 'add':
          this.handleAdd(message.client);
          break;
        case 'remove':
          this.handleRemove(message.pid);
          break;
      }
    };

    this.ws.onclose = () => {
      for (const [, { reject }] of this._pendingFiles) {
        reject(new Error('WebSocket disconnected'));
      }
      this._pendingFiles.clear();

      if (!this.hasScanned) {
        this.hasScanned = true;
        this.scanForClients();
      }
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {};
  }

  readFile(path: string): Promise<ArrayBuffer> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not connected'));
    }

    const id = this._nextFileId++;
    return new Promise((resolve, reject) => {
      this._pendingFiles.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ type: 'file', id, path }));
    });
  }

  getClient(pid: number): Client | undefined {
    return this.clientMap.get(pid);
  }

  private handleFileResponse(data: ArrayBuffer): void {
    const view = new DataView(data);
    if (data.byteLength < 5) return;

    const id = view.getUint32(0, true);
    const status = view.getUint8(4);

    const entry = this._pendingFiles.get(id);
    if (!entry) return;
    this._pendingFiles.delete(id);

    if (status === 0x00) {
      entry.resolve(data.slice(5));
    } else if (status === 0x01) {
      entry.reject(new Error('File not found'));
    } else {
      entry.reject(new Error('File read error'));
    }
  }

  private handleAdd({ pid, port, name }: ClientDescriptor): void {
    if (!name) return;

    let client = this.clientMap.get(pid);

    if (!client) {
      client = new Client(pid, port, (path) => this.readFile(path));

      client.on('close', () => {
        this.clientMap.delete(pid);
        this.options.onClientDisconnected({ pid });
      });

      this.clientMap.set(pid, client);

      client
        .connect()
        .then(() => {
          this.options.onClientConnected({ client: client!, name });
        })
        .catch((err) => {
          console.error(`Failed to connect to client PID ${pid}:`, err);
          this.clientMap.delete(pid);
        });
    } else {
      this.options.onClientConnected({ client, name });
    }
  }

  private handleRemove(pid: number): void {
    const client = this.clientMap.get(pid);
    if (client) {
      client.close();
    }
  }

  private handleInit(clientList: ClientDescriptor[]): void {
    const activePids = new Set(clientList.map((c) => c.pid));

    for (const [pid, client] of this.clientMap) {
      if (!activePids.has(pid)) {
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
