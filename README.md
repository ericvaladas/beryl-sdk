# beryl-sdk

TypeScript SDK for building Dark Ages tools. Connects to a local Beryl agent over WebSocket, discovers running game clients, and exposes an API for reading/writing packets, walking the character, reading files, and reading/writing process memory.

## Install

```sh
npm install beryl-sdk
```

Beryl requires the [Beryl agent](https://github.com/ericvaladas/beryl-agent) to be running locally. The agent attaches to Dark Ages clients and exposes them over WebSocket; this SDK is the interface you use to interact with them.

## Quick start

```ts
import { Beryl, Packet } from 'beryl-sdk';

const beryl = new Beryl();

beryl.on('ready', () => {
  console.log('Connected to agent');
});

beryl.on('clientConnected', ({ client, name }) => {
  console.log(`Client attached: ${name}`);

  client.on('sent', (packet) => {
    console.log('client -> server', packet.toString());
  });

  client.on('received', (packet) => {
    console.log('server -> client', packet.toString());
  });
});

beryl.on('clientDisconnected', ({ name }) => {
  console.log(`Client detached: ${name}`);
});

beryl.connect();
```

## API

### `class Beryl`

Extends an event emitter with the events listed below.

#### Methods

| Method | Description |
| --- | --- |
| `connect(): void` | Open the connection to the agent. If the connection drops, Beryl automatically reconnects every 2 seconds until `close()` is called. |
| `close(): void` | Close the connection to the agent and cancel any pending reconnect. |
| `readFile(path: string): Promise<ArrayBuffer>` | Read a file from the Dark Ages install directory. Paths are resolved relative to that directory and cannot escape it. Rejects with `File not found`, `File read error`, `File request timed out`, or `WebSocket disconnected`. |
| `getAllowedOrigins(): Promise<string[]>` | Fetch the agent's allowed-origins list. Rejects with `Settings request timed out` or `WebSocket disconnected`. |
| `setAllowedOrigins(origins: string[]): void` | Replace the agent's allowed-origins list. Throws if the agent is not connected. |

All request/response methods time out after 10 seconds.

#### Properties

| Property | Description |
| --- | --- |
| `ready: boolean` | `true` while the agent connection is open. |

#### Events (`BerylEvents`)

| Event | Payload |
| --- | --- |
| `ready` | `()` — agent connection opened. |
| `error` | `Error` — agent connection error. |
| `clientConnected` | `{ client: Client, name: string }` |
| `clientDisconnected` | `{ name: string }` |
| `version` | `{ agentVersion: string \| null, minVersion: string, updateRequired: boolean }` — emitted on the first agent connect and again whenever the agent reports a different version. `updateRequired` is `true` if the agent is below the SDK's minimum (or doesn't report a version). |

### `class Client`

Represents one attached game client. Obtained via the `clientConnected` event.

#### Methods

| Method | Description |
| --- | --- |
| `send(packet: Packet): void` | Inject a client→server packet. Throws if the client is not connected. |
| `receive(packet: Packet): void` | Inject a server→client packet. Throws if the client is not connected. |
| `walk(direction: number): void` | Move the character one tile (0=N, 1=E, 2=S, 3=W). Throws if the client is not connected. |
| `readMemory(offsets: number[], size: number): Promise<Uint8Array>` | Follow a pointer chain and read `size` bytes. Rejects with `Memory read timed out` or `WebSocket disconnected`. |
| `writeMemory(offsets: number[], data: Uint8Array): Promise<boolean>` | Follow a pointer chain and write `data`. Resolves `true` on success. Rejects with `Memory write timed out` or `WebSocket disconnected`. |
| `readFile(path: string): Promise<ArrayBuffer>` | Read a file from the Dark Ages install directory. See `Beryl.readFile` for details. |
| `close(): void` | Disconnect from this client. |

Memory operations time out after 10 seconds.

Walking has a dedicated method because the game maintains an internal walk sequence counter. Walking via packet injection would require manually updating that counter in game memory after every step to keep it in sync. `walk()` avoids that by invoking the game's own walk function directly, so the counter stays correct.

#### Properties

| Property | Description |
| --- | --- |
| `name: string` | Client identifier. |
| `port: number` | WebSocket port the client listens on. |

#### Events (`ClientEvents`)

| Event | Payload |
| --- | --- |
| `sent` | `Packet` observed going client→server. |
| `received` | `Packet` observed going server→client. |
| `close` | `()` — connection closed. |

### `class Packet`

Cursor-based reader/writer for Dark Ages packets.

```ts
const p = new Packet(0x0e); // new packet with opcode 0x0e
p.writeByte(0);
p.writeString8('hello');
client.send(p);

const incoming = new Packet(bytes); // parse from Uint8Array
const opcode = incoming.opcode;
const type = packet.readByte();
const id = packet.readUint32();
const message = packet.readString8();
```

#### Constructors

| Signature | Description |
| --- | --- |
| `new Packet(opcode: number)` | Build an empty packet with the given opcode. |
| `new Packet(data: Uint8Array)` | Parse an existing packet. `opcode` is `data[0]` and the cursor starts at the first body byte. |

#### Properties

| Property | Description |
| --- | --- |
| `opcode: number` | Packet opcode. |
| `position: number` | Current cursor position within the body. |

#### Methods

| Method | Description |
| --- | --- |
| `read(length: number): number[]` | Read `length` bytes. |
| `readByte(): number` | Read an unsigned byte. |
| `readSbyte(): number` | Read a signed byte. |
| `readBoolean(): boolean` | Read a byte as a boolean. |
| `readInt16(): number` | Read a signed 16-bit integer. |
| `readUint16(): number` | Read an unsigned 16-bit integer. |
| `readInt32(): number` | Read a signed 32-bit integer. |
| `readUint32(): number` | Read an unsigned 32-bit integer. |
| `readString8(): string` | Read a string with a 1-byte length prefix. |
| `readString16(): string` | Read a string with a 2-byte length prefix. |
| `write(bytes: number[]): void` | Append raw bytes. |
| `writeByte(value: number): void` | Write an unsigned byte. |
| `writeSbyte(value: number): void` | Write a signed byte. |
| `writeBoolean(value: boolean): void` | Write a byte as a boolean. |
| `writeInt16(value: number): void` | Write a signed 16-bit integer. |
| `writeUint16(value: number): void` | Write an unsigned 16-bit integer. |
| `writeInt32(value: number): void` | Write a signed 32-bit integer. |
| `writeUint32(value: number): void` | Write an unsigned 32-bit integer. |
| `writeString(value: string): void` | Write a string with no length prefix. |
| `writeString8(value: string): void` | Write a string with a 1-byte length prefix. |
| `writeString16(value: string): void` | Write a string with a 2-byte length prefix. |
| `buffer(): Uint8Array` | The packet's bytes. |
| `toString(): string` | Space-separated uppercase hex. |

Read methods advance `position`. Reads past the end return a zero value of the matching type: `0` for numbers, `false` for booleans, `''` for strings, `[]` for `read(length)`.

## License

MIT
