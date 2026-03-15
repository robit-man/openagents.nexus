import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  uuidv7,
  createMessage,
  encodeMessage,
  decodeMessage,
  msgIdFn,
  roomTopic,
  ephemeralTopic,
  TOPICS,
  PROTOCOL_VERSION,
} from '../index.js';
import type { NexusMessage, ChatPayload } from '../index.js';

describe('uuidv7', () => {
  it('returns a string matching UUID v4 format pattern', () => {
    const id = uuidv7();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('encodes the current timestamp in the first 48 bits', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();

    // Extract timestamp from UUIDv7: first 12 hex chars = 48 bits
    const hexTs = id.replace(/-/g, '').slice(0, 12);
    const ts = parseInt(hexTs, 16);

    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('generates unique IDs on successive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuidv7()));
    expect(ids.size).toBe(100);
  });

  it('version nibble is 7', () => {
    const id = uuidv7();
    // position 14: after "xxxxxxxx-xxxx-" (14 chars incl dashes)
    expect(id[14]).toBe('7');
  });

  it('variant bits are 10xx (chars 8, 9 or a or b)', () => {
    for (let i = 0; i < 20; i++) {
      const id = uuidv7();
      // variant byte is the first byte of the 4th group (index 19 in the UUID string)
      const variantChar = id[19];
      expect(['8', '9', 'a', 'b']).toContain(variantChar);
    }
  });
});

describe('createMessage', () => {
  const chatPayload: ChatPayload = {
    content: 'hello',
    format: 'text/plain',
    replyTo: null,
    threadId: null,
  };

  it('creates a NexusMessage with correct structure', () => {
    const msg = createMessage('chat', '/nexus/room/test', 'peer123', chatPayload);
    expect(msg.version).toBe(PROTOCOL_VERSION);
    expect(msg.type).toBe('chat');
    expect(msg.topic).toBe('/nexus/room/test');
    expect(msg.sender).toBe('peer123');
    expect(msg.payload).toEqual(chatPayload);
    expect(msg.references).toEqual([]);
  });

  it('assigns a valid UUIDv7 id', () => {
    const msg = createMessage('chat', '/nexus/room/test', 'peer123', chatPayload);
    expect(msg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('sets timestamp to approximately now', () => {
    const before = Date.now();
    const msg = createMessage('chat', '/nexus/room/test', 'peer123', chatPayload);
    const after = Date.now();
    expect(msg.timestamp).toBeGreaterThanOrEqual(before);
    expect(msg.timestamp).toBeLessThanOrEqual(after);
  });

  it('accepts custom references array', () => {
    const refs = ['bafybeicid1', 'bafybeicid2'];
    const msg = createMessage('chat', '/nexus/room/test', 'peer123', chatPayload, refs);
    expect(msg.references).toEqual(refs);
  });
});

describe('encodeMessage / decodeMessage', () => {
  const chatPayload: ChatPayload = {
    content: 'round-trip test',
    format: 'text/markdown',
    replyTo: null,
    threadId: 'thread-1',
  };

  it('encodes to Uint8Array', () => {
    const msg = createMessage('chat', '/nexus/room/test', 'peer123', chatPayload);
    const encoded = encodeMessage(msg);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('decodes back to original message', () => {
    const msg = createMessage('chat', '/nexus/room/test', 'peer123', chatPayload);
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(msg);
  });

  it('round-trips a presence message', () => {
    const presencePayload = {
      status: 'online' as const,
      capabilities: ['chat', 'storage'],
      agentName: 'TestAgent',
      agentType: 'autonomous',
      version: '0.1.0',
    };
    const msg = createMessage('presence', TOPICS.META, 'peer456', presencePayload);
    const decoded = decodeMessage(encodeMessage(msg));
    expect(decoded).toEqual(msg);
  });
});

describe('msgIdFn', () => {
  it('returns the message id bytes when data is valid', () => {
    const msg = createMessage('chat', '/nexus/room/test', 'peer', {
      content: 'x',
      format: 'text/plain',
      replyTo: null,
      threadId: null,
    });
    const encoded = encodeMessage(msg);
    const idBytes = msgIdFn({ data: encoded });
    const idStr = new TextDecoder().decode(idBytes);
    expect(idStr).toBe(msg.id);
  });

  it('returns empty Uint8Array when data is null', () => {
    const result = msgIdFn({ data: null });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  it('returns first 32 bytes as fallback for invalid JSON', () => {
    const garbage = new Uint8Array(64).fill(42);
    const result = msgIdFn({ data: garbage });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeLessThanOrEqual(32);
  });
});

describe('roomTopic', () => {
  it('prepends room prefix to roomId', () => {
    expect(roomTopic('my-room')).toBe('/nexus/room/my-room');
    expect(roomTopic('abc123')).toBe('/nexus/room/abc123');
  });
});

describe('ephemeralTopic', () => {
  it('prepends ephemeral prefix to sessionId', () => {
    expect(ephemeralTopic('session-1')).toBe('/nexus/ephemeral/session-1');
    expect(ephemeralTopic('xyz')).toBe('/nexus/ephemeral/xyz');
  });
});
