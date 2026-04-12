import { ClientPacket, ServerPacket } from './packet';
import EventEmitter from './event-emitter';

export const MessageType = {
  CLIENT: 0x01,
  SERVER: 0x02,
  WALK: 0x03,
  READ_MEMORY: 0x04,
  WRITE_MEMORY: 0x05,
} as const;

interface PendingMemory {
  resolve: (value: Uint8Array | boolean) => void;
  reject: (reason: Error) => void;
}

export type ClientEvents = {
  clientPacket: (packet: ClientPacket) => void;
  serverPacket: (packet: ServerPacket) => void;
  close: () => void;
};

interface Registry {
  readFile(path: string): Promise<ArrayBuffer>;
}

export class Client extends EventEmitter<ClientEvents> {
  readonly pid: number;
  readonly port: number;
  private registry: Registry;
  private ws: WebSocket | null = null;
  private _nextRequestId = 0;
  private _pendingMemory = new Map<number, PendingMemory>();

  constructor(pid: number, port: number, registry: Registry) {
    super();
    this.pid = pid;
    this.port = port;
    this.registry = registry;
  }

  readFile(path: string): Promise<ArrayBuffer> {
    return this.registry.readFile(path);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${this.port}`);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => resolve();

      this.ws.onmessage = (event: MessageEvent) => {
        this.onMessage(event.data as ArrayBuffer);
      };

      this.ws.onclose = () => {
        this.close();
      };

      this.ws.onerror = () => {
        reject(new Error(`WebSocket error connecting to port ${this.port}`));
      };
    });
  }

  private onMessage(data: ArrayBuffer): void {
    const raw = new Uint8Array(data);
    const type = raw[0];
    const body = raw.slice(1);

    if (type === MessageType.CLIENT) {
      this.emit('clientPacket', new ClientPacket(body));
    } else if (type === MessageType.SERVER) {
      this.emit('serverPacket', new ServerPacket(body));
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

  send(packet: ClientPacket | ServerPacket): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const type = packet instanceof ClientPacket ? MessageType.CLIENT : MessageType.SERVER;
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
