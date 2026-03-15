import {
  PROTOCOL_VERSION,
  TOPICS,
  type MessageType,
  type NexusMessage,
} from './types.js';

export * from './types.js';

// UUIDv7 generation (no external dependency)
// UUIDv7 = unix_ms (48 bits) + version (4 bits) + rand_a (12 bits) + variant (2 bits) + rand_b (62 bits)
export function uuidv7(): string {
  const now = Date.now();
  const bytes = new Uint8Array(16);

  // timestamp (48 bits, big-endian)
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // random (80 bits)
  crypto.getRandomValues(bytes.subarray(6));

  // version 7
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // variant 10
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Create a NexusMessage
export function createMessage(
  type: MessageType,
  topic: string,
  sender: string,
  payload: NexusMessage['payload'],
  references: string[] = [],
): NexusMessage {
  return {
    version: PROTOCOL_VERSION,
    type,
    id: uuidv7(),
    timestamp: Date.now(),
    sender,
    topic,
    payload,
    references,
  };
}

// Serialize/deserialize messages
export function encodeMessage(msg: NexusMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg));
}

export function decodeMessage(data: Uint8Array): NexusMessage {
  return JSON.parse(new TextDecoder().decode(data));
}

// Simple non-cryptographic hash of a Uint8Array — djb2 variant over all bytes.
// Returns a 32-byte hex string encoded as UTF-8 bytes.
function hashBytes(data: Uint8Array): Uint8Array {
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0xdeadbeef >>> 0;
  for (let i = 0; i < data.length; i++) {
    h1 = Math.imul(h1 ^ data[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ data[i], 0x811c9dc5) >>> 0;
  }
  // Mix in index to make h1 and h2 diverge
  h1 ^= h2;
  h2 ^= h1;
  const hex = (h1 >>> 0).toString(16).padStart(8, '0')
    + (h2 >>> 0).toString(16).padStart(8, '0')
    + data.length.toString(16).padStart(8, '0')
    + (h1 ^ data.length >>> 0).toString(16).padStart(8, '0');
  return new TextEncoder().encode(hex);
}

// Message ID function for GossipSub deduplication
export function msgIdFn(msg: { data: Uint8Array | null }): Uint8Array {
  // For null data return a random 32-byte ID to avoid collisions between null-data messages
  if (!msg.data) {
    const rand = new Uint8Array(16);
    crypto.getRandomValues(rand);
    return rand;
  }
  try {
    const envelope = JSON.parse(new TextDecoder().decode(msg.data));
    return new TextEncoder().encode(envelope.id);
  } catch {
    // fallback: hash the full data so different payloads get different IDs
    return hashBytes(msg.data);
  }
}

// Topic helpers
export function roomTopic(roomId: string): string {
  return `${TOPICS.ROOM_PREFIX}${roomId}`;
}

export function ephemeralTopic(sessionId: string): string {
  return `${TOPICS.EPHEMERAL_PREFIX}${sessionId}`;
}
