/**
 * Tests for the /nexus/chat-sync/1.1.0 room history sync protocol.
 */

import { describe, it, expect } from 'vitest';
import {
  CHAT_SYNC_PROTOCOL,
  type SyncRequest,
  type SyncResponse,
} from '../chat-sync.js';

describe('CHAT_SYNC_PROTOCOL', () => {
  it('has the correct protocol identifier', () => {
    expect(CHAT_SYNC_PROTOCOL).toBe('/nexus/chat-sync/1.1.0');
  });
});

describe('SyncRequest', () => {
  it('constructs without a sinceCheckpoint', () => {
    const req: SyncRequest = {
      type: 'sync.request',
      version: 1,
      roomId: 'general',
      maxBatches: 10,
    };

    expect(req.type).toBe('sync.request');
    expect(req.version).toBe(1);
    expect(req.roomId).toBe('general');
    expect(req.maxBatches).toBe(10);
    expect(req.sinceCheckpoint).toBeUndefined();
  });

  it('constructs with a sinceCheckpoint CID', () => {
    const req: SyncRequest = {
      type: 'sync.request',
      version: 1,
      roomId: 'general',
      sinceCheckpoint: 'bafkreihdwdcefgh',
      maxBatches: 5,
    };

    expect(req.sinceCheckpoint).toBe('bafkreihdwdcefgh');
  });
});

describe('SyncResponse', () => {
  it('constructs with an empty batches array', () => {
    const resp: SyncResponse = {
      type: 'sync.response',
      version: 1,
      roomId: 'general',
      batches: [],
    };

    expect(resp.type).toBe('sync.response');
    expect(resp.version).toBe(1);
    expect(resp.roomId).toBe('general');
    expect(resp.batches).toEqual([]);
    expect(resp.latestCheckpoint).toBeUndefined();
  });

  it('constructs with CID batches and a latestCheckpoint', () => {
    const resp: SyncResponse = {
      type: 'sync.response',
      version: 1,
      roomId: 'general',
      latestCheckpoint: 'bafkrei999',
      batches: ['bafkrei001', 'bafkrei002', 'bafkrei003'],
    };

    expect(resp.latestCheckpoint).toBe('bafkrei999');
    expect(resp.batches).toHaveLength(3);
    expect(resp.batches[0]).toBe('bafkrei001');
  });
});
