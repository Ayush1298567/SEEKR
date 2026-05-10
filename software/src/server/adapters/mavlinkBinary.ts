export interface MavlinkBinaryParseIssue {
  offset: number;
  msgid?: number;
  reason: string;
}

export interface MavlinkBinaryParseResult {
  messages: Array<Record<string, unknown>>;
  rejectedFrames: MavlinkBinaryParseIssue[];
}

const MAVLINK_V1_STX = 0xfe;
const MAVLINK_V2_STX = 0xfd;
const MAVLINK_V2_SIGNATURE_BYTES = 13;

const MESSAGE_DEFINITIONS: Record<number, {
  type: string;
  crcExtra: number;
  decode: (payload: Uint8Array) => Record<string, unknown>;
}> = {
  0: {
    type: "HEARTBEAT",
    crcExtra: 50,
    decode: (payload) => ({
      custom_mode: uint32(payload, 0),
      base_mode: uint8(payload, 6),
      system_status: uint8(payload, 7)
    })
  },
  1: {
    type: "SYS_STATUS",
    crcExtra: 124,
    decode: (payload) => ({
      battery_remaining: int8(payload, 30)
    })
  },
  32: {
    type: "LOCAL_POSITION_NED",
    crcExtra: 185,
    decode: (payload) => ({
      x: float32(payload, 4),
      y: float32(payload, 8),
      z: float32(payload, 12),
      vx: float32(payload, 16),
      vy: float32(payload, 20),
      vz: float32(payload, 24)
    })
  },
  109: {
    type: "RADIO_STATUS",
    crcExtra: 185,
    decode: (payload) => ({
      rssi: uint8(payload, 0),
      remrssi: uint8(payload, 1)
    })
  },
  147: {
    type: "BATTERY_STATUS",
    crcExtra: 154,
    decode: (payload) => ({
      battery_remaining: int8(payload, 35)
    })
  },
  230: {
    type: "ESTIMATOR_STATUS",
    crcExtra: 163,
    decode: (payload) => ({
      vel_ratio: float32(payload, 8),
      pos_horiz_ratio: float32(payload, 12),
      pos_vert_ratio: float32(payload, 16)
    })
  }
};

export function parseMavlinkBinaryMessages(input: Uint8Array): MavlinkBinaryParseResult {
  const messages: Array<Record<string, unknown>> = [];
  const rejectedFrames: MavlinkBinaryParseIssue[] = [];
  let offset = 0;

  while (offset < input.length) {
    const start = input[offset];
    if (start !== MAVLINK_V1_STX && start !== MAVLINK_V2_STX) {
      offset += 1;
      continue;
    }

    const frame = parseFrame(input, offset);
    if (!frame.ok) {
      rejectedFrames.push({ offset, msgid: frame.msgid, reason: frame.reason });
      offset += frame.bytesToSkip;
      continue;
    }

    const definition = MESSAGE_DEFINITIONS[frame.msgid];
    if (!definition) {
      rejectedFrames.push({ offset, msgid: frame.msgid, reason: `Unsupported MAVLink message id ${frame.msgid}` });
      offset = frame.nextOffset;
      continue;
    }

    messages.push({
      ...definition.decode(frame.payload),
      type: definition.type,
      msgid: frame.msgid,
      sysid: frame.sysid,
      compid: frame.compid,
      seq: frame.seq,
      mavlinkVersion: frame.version
    });
    offset = frame.nextOffset;
  }

  return { messages, rejectedFrames };
}

function parseFrame(input: Uint8Array, offset: number):
  | {
      ok: true;
      version: 1 | 2;
      msgid: number;
      sysid: number;
      compid: number;
      seq: number;
      payload: Uint8Array;
      nextOffset: number;
    }
  | { ok: false; msgid?: number; reason: string; bytesToSkip: number } {
  const stx = input[offset];
  if (stx === MAVLINK_V1_STX) return parseV1Frame(input, offset);
  return parseV2Frame(input, offset);
}

function parseV1Frame(input: Uint8Array, offset: number) {
  if (offset + 8 > input.length) return { ok: false as const, reason: "Incomplete MAVLink v1 header", bytesToSkip: 1 };
  const payloadLength = input[offset + 1] ?? 0;
  const frameLength = 8 + payloadLength;
  if (offset + frameLength > input.length) return { ok: false as const, reason: "Incomplete MAVLink v1 frame", bytesToSkip: 1 };

  const msgid = input[offset + 5] ?? 0;
  const definition = MESSAGE_DEFINITIONS[msgid];
  if (definition && !checksumMatches(input, offset + 1, 5 + payloadLength, offset + 6 + payloadLength, definition.crcExtra)) {
    return { ok: false as const, msgid, reason: "MAVLink v1 checksum mismatch", bytesToSkip: frameLength };
  }

  return {
    ok: true as const,
    version: 1 as const,
    msgid,
    sysid: input[offset + 3] ?? 0,
    compid: input[offset + 4] ?? 0,
    seq: input[offset + 2] ?? 0,
    payload: input.slice(offset + 6, offset + 6 + payloadLength),
    nextOffset: offset + frameLength
  };
}

function parseV2Frame(input: Uint8Array, offset: number) {
  if (offset + 12 > input.length) return { ok: false as const, reason: "Incomplete MAVLink v2 header", bytesToSkip: 1 };
  const payloadLength = input[offset + 1] ?? 0;
  const incompatFlags = input[offset + 2] ?? 0;
  const signatureLength = incompatFlags & 0x01 ? MAVLINK_V2_SIGNATURE_BYTES : 0;
  const frameLength = 12 + payloadLength + signatureLength;
  if (offset + frameLength > input.length) return { ok: false as const, reason: "Incomplete MAVLink v2 frame", bytesToSkip: 1 };

  const msgid = uint24(input, offset + 7);
  const definition = MESSAGE_DEFINITIONS[msgid];
  if (definition && !checksumMatches(input, offset + 1, 9 + payloadLength, offset + 10 + payloadLength, definition.crcExtra)) {
    return { ok: false as const, msgid, reason: "MAVLink v2 checksum mismatch", bytesToSkip: frameLength };
  }

  return {
    ok: true as const,
    version: 2 as const,
    msgid,
    sysid: input[offset + 5] ?? 0,
    compid: input[offset + 6] ?? 0,
    seq: input[offset + 4] ?? 0,
    payload: input.slice(offset + 10, offset + 10 + payloadLength),
    nextOffset: offset + frameLength
  };
}

function checksumMatches(input: Uint8Array, crcStart: number, crcLength: number, checksumOffset: number, crcExtra: number) {
  const expected = uint16(input, checksumOffset);
  const actual = x25Crc(input.slice(crcStart, crcStart + crcLength), crcExtra);
  return expected === actual;
}

export function x25Crc(bytes: Uint8Array, crcExtra?: number) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc = x25Accumulate(byte, crc);
  }
  if (typeof crcExtra === "number") crc = x25Accumulate(crcExtra, crc);
  return crc & 0xffff;
}

function x25Accumulate(byte: number, crc: number) {
  let tmp = byte ^ (crc & 0xff);
  tmp ^= (tmp << 4) & 0xff;
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
}

function uint8(payload: Uint8Array, offset: number) {
  return payload[offset] ?? 0;
}

function int8(payload: Uint8Array, offset: number) {
  const value = uint8(payload, offset);
  return value > 127 ? value - 256 : value;
}

function uint16(payload: Uint8Array, offset: number) {
  return uint8(payload, offset) | (uint8(payload, offset + 1) << 8);
}

function uint24(payload: Uint8Array, offset: number) {
  return uint8(payload, offset) | (uint8(payload, offset + 1) << 8) | (uint8(payload, offset + 2) << 16);
}

function uint32(payload: Uint8Array, offset: number) {
  return uint16(payload, offset) + uint16(payload, offset + 2) * 0x10000;
}

function float32(payload: Uint8Array, offset: number) {
  const bytes = new Uint8Array(4);
  bytes.set(payload.slice(offset, offset + 4));
  return new DataView(bytes.buffer).getFloat32(0, true);
}
