/**
 * Tests for the protocols barrel index and STREAM_PROTOCOLS registry.
 */

import { describe, it, expect } from 'vitest';
import { STREAM_PROTOCOLS } from '../index.js';

describe('STREAM_PROTOCOLS registry', () => {
  it('contains the INVOKE protocol identifier', () => {
    expect(STREAM_PROTOCOLS.INVOKE).toBe('/nexus/invoke/1.1.0');
  });

  it('contains the HANDSHAKE protocol identifier', () => {
    expect(STREAM_PROTOCOLS.HANDSHAKE).toBe('/nexus/handshake/1.1.0');
  });

  it('contains the DM protocol identifier', () => {
    expect(STREAM_PROTOCOLS.DM).toBe('/nexus/dm/1.1.0');
  });

  it('contains the CHAT_SYNC protocol identifier', () => {
    expect(STREAM_PROTOCOLS.CHAT_SYNC).toBe('/nexus/chat-sync/1.1.0');
  });

  it('is an object with exactly four keys', () => {
    const keys = Object.keys(STREAM_PROTOCOLS);
    expect(keys).toHaveLength(4);
    expect(keys).toContain('INVOKE');
    expect(keys).toContain('HANDSHAKE');
    expect(keys).toContain('DM');
    expect(keys).toContain('CHAT_SYNC');
  });
});
