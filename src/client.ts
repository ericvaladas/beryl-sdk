import { Packet } from './packet';
import EventEmitter from './event-emitter';

export const MessageType = {
  CLIENT: 0x01,
  SERVER: 0x02,
  WALK: 0x03,
  READ_MEMORY: 0x04,
  WRITE_MEMORY: 0x05,
  BECOME_REGISTRY: 0x06,
  READY: 0x07,
} as const;

interface PendingMemory {
  resolve: (value: Uint8Array | boolean) => void;
  reject: (reason: Error) => void;
}

export type ClientEvents = {
  sent: (packet: Packet) => void;
  received: (packet: Packet) => void;
  close: () => void;
};

export class Client extends EventEmitter<ClientEvents> {
  readonly name: string;
  readonly port: number;
  readonly readFile: (path: string) => Promise<ArrayBuffer>;
  private ws: WebSocket | null = null;
  private _nextRequestId = 0;
  private _pendingMemory = new Map<number, PendingMemory>();
  private _onReady: (() => void) | null = null;

  constructor(name: string, port: number, readFile: (path: string) => Promise<ArrayBuffer>) {
    super();
    this.name = name;
    this.port = port;
    this.readFile = readFile;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${this.port}`);
      this.ws.binaryType = 'arraybuffer';
      this._onReady = resolve;

      this.ws.onmessage = (event: MessageEvent) => {
        this.onMessage(event.data as ArrayBuffer);
      };

      this.ws.onclose = () => {
        this._onReady = null;
        this.close();
      };

      this.ws.onerror = () => {
        this._onReady = null;
        reject(new Error(`WebSocket error connecting to port ${this.port}`));
      };
    });
  }

  private onMessage(data: ArrayBuffer): void {
    const raw = new Uint8Array(data);
    const type = raw[0];
    const body = raw.slice(1);

    if (type === MessageType.READY) {
      if (this._onReady) {
        this._onReady();
        this._onReady = null;
      }
      return;
    }

    if (type === MessageType.CLIENT) {
      this.emit('sent', new Packet(body));
    } else if (type === MessageType.SERVER) {
      this.emit('received', new Packet(body));
    } else if (type === MessageType.READ_MEMORY || type === MessageType.WRITE_MEMORY) {
      const requestId = body[0];
      const pending = this._pendingMemory.get(requestId);
      if (pending) {
        this._pendingMemory.delete(requestId);
        if (type === MessageType.READ_MEMORY) {
          pending.resolve(body.slice(1));
        } else {
          pending.resolve(body[1] === 0);
        }
      }
    }
  }

  send(packet: Packet): void {
    this.sendFramed(MessageType.CLIENT, packet);
  }

  receive(packet: Packet): void {
    this.sendFramed(MessageType.SERVER, packet);
  }

  private sendFramed(type: number, packet: Packet): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const body = packet.buffer();
    const frame = new Uint8Array(1 + body.length);
    frame[0] = type;
    frame.set(body, 1);

    this.ws.send(frame);
  }

  walk(direction: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(new Uint8Array([MessageType.WALK, direction]));
  }

  becomeRegistry(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(new Uint8Array([MessageType.BECOME_REGISTRY]));
  }

  readMemory(offsets: number[], size: number): Promise<Uint8Array> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not connected'));
    }

    const id = this._nextRequestId;
    this._nextRequestId = (this._nextRequestId + 1) & 0xff;

    const chainLength = offsets.length;
    const totalSize = 1 + 1 + 1 + chainLength * 4 + 4;
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);
    let pos = 0;

    view.setUint8(pos++, MessageType.READ_MEMORY);
    view.setUint8(pos++, id);
    view.setUint8(pos++, chainLength);
    for (const offset of offsets) {
      view.setUint32(pos, offset, true);
      pos += 4;
    }
    view.setUint32(pos, size, true);

    return new Promise((resolve, reject) => {
      this._pendingMemory.set(id, {
        resolve: resolve as (value: Uint8Array | boolean) => void,
        reject,
      });
      this.ws!.send(buf);
    });
  }

  writeMemory(offsets: number[], data: Uint8Array): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not connected'));
    }

    const id = this._nextRequestId;
    this._nextRequestId = (this._nextRequestId + 1) & 0xff;

    const chainLength = offsets.length;
    const totalSize = 1 + 1 + 1 + chainLength * 4 + 4 + data.length;
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);
    let pos = 0;

    view.setUint8(pos++, MessageType.WRITE_MEMORY);
    view.setUint8(pos++, id);
    view.setUint8(pos++, chainLength);
    for (const offset of offsets) {
      view.setUint32(pos, offset, true);
      pos += 4;
    }
    view.setUint32(pos, data.length, true);
    pos += 4;
    new Uint8Array(buf, pos).set(data);

    return new Promise((resolve, reject) => {
      this._pendingMemory.set(id, {
        resolve: resolve as (value: Uint8Array | boolean) => void,
        reject,
      });
      this.ws!.send(buf);
    });
  }

  close(): void {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.close();
    }

    this.emit('close');
  }
}
