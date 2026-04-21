function uint8(value: number): number {
  return value & 0xff;
}

function int8(value: number): number {
  return ((value & 0xff) << 24) >> 24;
}

function uint16(value: number): number {
  return value & 0xffff;
}

function int16(value: number): number {
  return ((value & 0xffff) << 16) >> 16;
}

function uint32(value: number): number {
  return value >>> 0;
}

function int32(value: number): number {
  return value | 0;
}

function toHex(value: number): string {
  const hex = value.toString(16);
  return (hex.length % 2 ? '0' + hex : hex).toUpperCase();
}

export class Packet {
  opcode: number;
  position: number;
  private body: number[];

  constructor(arg: number | Uint8Array) {
    if (typeof arg === 'number') {
      this.opcode = arg;
      this.position = 0;
      this.body = [];
    } else {
      this.opcode = arg[0];
      this.position = 0;
      this.body = Array.from(arg.slice(1));
    }
  }

  buffer(): Uint8Array {
    return new Uint8Array([this.opcode, ...this.body]);
  }

  toString(): string {
    return Array.from(this.buffer())
      .map((byte) => toHex(byte))
      .join(' ');
  }

  read(length: number): number[] {
    if (this.position + length > this.body.length) {
      return [];
    }

    const buffer = this.body.slice(this.position, this.position + length);
    this.position += length;

    return buffer;
  }

  readByte(): number {
    if (this.position + 1 > this.body.length) {
      return 0;
    }

    const value = this.body[this.position];
    this.position += 1;

    return value;
  }

  readSbyte(): number {
    if (this.position + 1 > this.body.length) {
      return 0;
    }

    const value = int8(this.body[this.position]);
    this.position += 1;

    return value;
  }

  readBoolean(): boolean {
    if (this.position + 1 > this.body.length) {
      return false;
    }

    const value = this.body[this.position] !== 0;
    this.position += 1;

    return value;
  }

  readInt16(): number {
    if (this.position + 2 > this.body.length) {
      return 0;
    }

    const value = (this.body[this.position] << 8) | this.body[this.position + 1];
    this.position += 2;

    return int16(value);
  }

  readUint16(): number {
    if (this.position + 2 > this.body.length) {
      return 0;
    }

    const value = (this.body[this.position] << 8) | this.body[this.position + 1];
    this.position += 2;

    return uint16(value);
  }

  readInt32(): number {
    if (this.position + 4 > this.body.length) {
      return 0;
    }

    const value =
      (this.body[this.position] << 24) |
      (this.body[this.position + 1] << 16) |
      (this.body[this.position + 2] << 8) |
      this.body[this.position + 3];
    this.position += 4;

    return int32(value);
  }

  readUint32(): number {
    if (this.position + 4 > this.body.length) {
      return 0;
    }

    const value =
      (this.body[this.position] << 24) |
      (this.body[this.position + 1] << 16) |
      (this.body[this.position + 2] << 8) |
      this.body[this.position + 3];
    this.position += 4;

    return uint32(value);
  }

  readString8(): string {
    if (this.position + 1 > this.body.length) {
      return '';
    }

    const length = this.body[this.position];
    const start = this.position + 1;

    if (start + length > this.body.length) {
      return '';
    }

    const buffer = this.body.slice(start, start + length);
    this.position += length + 1;

    return String.fromCharCode(...buffer);
  }

  readString16(): string {
    if (this.position + 2 > this.body.length) {
      return '';
    }

    const length = (this.body[this.position] << 8) | this.body[this.position + 1];
    const start = this.position + 2;

    if (start + length > this.body.length) {
      return '';
    }

    const buffer = this.body.slice(start, start + length);
    this.position += length + 2;

    return String.fromCharCode(...buffer);
  }

  write(buffer: number[]): void {
    this.body = this.body.concat(buffer);
  }

  writeByte(value: number): void {
    this.body.push(uint8(value));
  }

  writeSbyte(value: number): void {
    this.body.push(int8(value) & 0xff);
  }

  writeBoolean(value: boolean): void {
    this.body.push(value ? 0x01 : 0x00);
  }

  writeInt16(value: number): void {
    value = int16(value);
    this.body.push((value >> 8) & 0xff);
    this.body.push(value & 0xff);
  }

  writeUint16(value: number): void {
    value = uint16(value);
    this.body.push((value >> 8) & 0xff);
    this.body.push(value & 0xff);
  }

  writeInt32(value: number): void {
    value = int32(value);
    this.body.push((value >> 24) & 0xff);
    this.body.push((value >> 16) & 0xff);
    this.body.push((value >> 8) & 0xff);
    this.body.push(value & 0xff);
  }

  writeUint32(value: number): void {
    value = uint32(value);
    this.body.push((value >> 24) & 0xff);
    this.body.push((value >> 16) & 0xff);
    this.body.push((value >> 8) & 0xff);
    this.body.push(value & 0xff);
  }

  writeString(value: string): void {
    const buffer = Array.from(new TextEncoder().encode(value));
    this.body = this.body.concat(buffer);
    this.position += buffer.length;
  }

  writeString8(value: string): void {
    const buffer = Array.from(new TextEncoder().encode(value));
    this.body.push(buffer.length);
    this.body = this.body.concat(buffer);
    this.position += buffer.length + 1;
  }

  writeString16(value: string): void {
    const buffer = Array.from(new TextEncoder().encode(value));
    this.body.push((buffer.length >> 8) & 0xff);
    this.body.push(buffer.length & 0xff);
    this.body = this.body.concat(buffer);
    this.position += buffer.length + 2;
  }
}
