import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  PROTOCOLS,
  TOPICS,
} from '../types.js';

describe('Protocol constants', () => {
  it('PROTOCOL_VERSION is 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('PROTOCOLS contains all expected protocol identifiers', () => {
    expect(PROTOCOLS.DHT).toBe('/nexus/kad/1.1.0');
    expect(PROTOCOLS.SYNC).toBe('/nexus/sync/1.0.0');
    expect(PROTOCOLS.HANDSHAKE).toBe('/nexus/handshake/1.1.0');
    expect(PROTOCOLS.DM).toBe('/nexus/dm/1.1.0');
    expect(PROTOCOLS.CAPABILITY_INVOKE).toBe('/nexus/invoke/1.1.0');
    expect(PROTOCOLS.CHAT_SYNC).toBe('/nexus/chat-sync/1.1.0');
  });

  it('TOPICS contains all expected topic prefixes', () => {
    expect(TOPICS.META).toBe('/nexus/meta');
    expect(TOPICS.ROOM_PREFIX).toBe('/nexus/room/');
    expect(TOPICS.EPHEMERAL_PREFIX).toBe('/nexus/ephemeral/');
    expect(TOPICS.CAPABILITY_PREFIX).toBe('/nexus/capability/');
  });
});
