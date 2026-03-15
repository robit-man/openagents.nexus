/**
 * Unit tests for MessageBatch creation, signing, and validation.
 *
 * Tests the immutable message batch model that replaces the single
 * historyRoot write-contention approach. Any peer can independently
 * produce a batch, enabling multi-writer room history.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { PrivateKey } from '@libp2p/interface';
import {
  createBatch,
  signBatch,
  validateBatchStructure,
  MAX_BATCH_SIZE,
  type BatchMessage,
  type MessageBatch,
} from '../message-batch.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let privateKey: PrivateKey;
let authorId: string;

beforeAll(async () => {
  privateKey = await generateKeyPair('Ed25519');
  authorId = peerIdFromPrivateKey(privateKey).toString();
});

function makeBatchMessage(overrides: Partial<BatchMessage> = {}): BatchMessage {
  return {
    id: '01900000-0000-7000-8000-000000000001',
    timestamp: 1_700_000_000_000,
    sender: 'QmSender',
    format: 'text/plain',
    content: 'Hello world',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createBatch()
// ---------------------------------------------------------------------------

describe('createBatch()', () => {
  it('produces a valid structure with correct schema', () => {
    const msgs = [makeBatchMessage()];
    const batch = createBatch('room-1', authorId, msgs);

    expect(batch.schema).toBe('nexus:message-batch:v1');
  });

  it('sets roomId correctly', () => {
    const msgs = [makeBatchMessage()];
    const batch = createBatch('room-42', authorId, msgs);

    expect(batch.roomId).toBe('room-42');
  });

  it('sets author correctly', () => {
    const msgs = [makeBatchMessage()];
    const batch = createBatch('room-1', authorId, msgs);

    expect(batch.author).toBe(authorId);
  });

  it('generates a unique batchId (UUIDv7 format)', () => {
    const msgs = [makeBatchMessage()];
    const batch1 = createBatch('room-1', authorId, msgs);
    const batch2 = createBatch('room-1', authorId, msgs);

    // IDs should be unique across calls
    expect(batch1.batchId).not.toBe(batch2.batchId);
    // Should look like a UUID
    expect(batch1.batchId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('sets createdAt to a recent timestamp', () => {
    const before = Date.now();
    const msgs = [makeBatchMessage()];
    const batch = createBatch('room-1', authorId, msgs);
    const after = Date.now();

    expect(batch.createdAt).toBeGreaterThanOrEqual(before);
    expect(batch.createdAt).toBeLessThanOrEqual(after);
  });

  it('copies messages into the batch', () => {
    const msgs = [makeBatchMessage({ content: 'msg-a' }), makeBatchMessage({ content: 'msg-b' })];
    const batch = createBatch('room-1', authorId, msgs);

    expect(batch.messages).toHaveLength(2);
    expect(batch.messages[0].content).toBe('msg-a');
    expect(batch.messages[1].content).toBe('msg-b');
  });

  it('caps messages at MAX_BATCH_SIZE when input exceeds limit', () => {
    const msgs = Array.from({ length: MAX_BATCH_SIZE + 10 }, (_, i) =>
      makeBatchMessage({ content: `msg-${i}` }),
    );
    const batch = createBatch('room-1', authorId, msgs);

    expect(batch.messages).toHaveLength(MAX_BATCH_SIZE);
  });

  it('handles an empty messages array without throwing', () => {
    const batch = createBatch('room-1', authorId, []);

    expect(batch.messages).toHaveLength(0);
    expect(batch.schema).toBe('nexus:message-batch:v1');
  });

  it('defaults retentionClass to "cache"', () => {
    const batch = createBatch('room-1', authorId, []);

    expect(batch.retentionClass).toBe('cache');
  });

  it('accepts custom retentionClass "ephemeral"', () => {
    const batch = createBatch('room-1', authorId, [], 'ephemeral');

    expect(batch.retentionClass).toBe('ephemeral');
  });

  it('accepts custom retentionClass "retained"', () => {
    const batch = createBatch('room-1', authorId, [], 'retained');

    expect(batch.retentionClass).toBe('retained');
  });

  it('accepts custom retentionClass "mirrored"', () => {
    const batch = createBatch('room-1', authorId, [], 'mirrored');

    expect(batch.retentionClass).toBe('mirrored');
  });

  it('accepts custom retentionClass "archival"', () => {
    const batch = createBatch('room-1', authorId, [], 'archival');

    expect(batch.retentionClass).toBe('archival');
  });

  it('does not include a sig field (unsigned batch from createBatch)', () => {
    const batch = createBatch('room-1', authorId, []);

    // The returned object should not have a `sig` property
    expect('sig' in batch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// signBatch()
// ---------------------------------------------------------------------------

describe('signBatch()', () => {
  it('returns a batch with a non-empty sig field', async () => {
    const unsigned = createBatch('room-1', authorId, [makeBatchMessage()]);
    const signed = await signBatch(unsigned, privateKey);

    expect(typeof signed.sig).toBe('string');
    expect(signed.sig.length).toBeGreaterThan(0);
  });

  it('preserves all fields from the unsigned batch', async () => {
    const unsigned = createBatch('room-1', authorId, [makeBatchMessage()]);
    const signed = await signBatch(unsigned, privateKey);

    expect(signed.schema).toBe(unsigned.schema);
    expect(signed.roomId).toBe(unsigned.roomId);
    expect(signed.batchId).toBe(unsigned.batchId);
    expect(signed.author).toBe(unsigned.author);
    expect(signed.createdAt).toBe(unsigned.createdAt);
    expect(signed.messages).toEqual(unsigned.messages);
    expect(signed.retentionClass).toBe(unsigned.retentionClass);
  });

  it('produces a Base64-encoded signature', async () => {
    const unsigned = createBatch('room-1', authorId, [makeBatchMessage()]);
    const signed = await signBatch(unsigned, privateKey);

    // Base64 characters only
    expect(signed.sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('produces different sigs for different batches', async () => {
    const unsigned1 = createBatch('room-1', authorId, [makeBatchMessage({ content: 'alpha' })]);
    const unsigned2 = createBatch('room-1', authorId, [makeBatchMessage({ content: 'beta' })]);

    const signed1 = await signBatch(unsigned1, privateKey);
    const signed2 = await signBatch(unsigned2, privateKey);

    expect(signed1.sig).not.toBe(signed2.sig);
  });
});

// ---------------------------------------------------------------------------
// validateBatchStructure()
// ---------------------------------------------------------------------------

describe('validateBatchStructure()', () => {
  async function makeSignedBatch(overrides: Partial<MessageBatch> = {}): Promise<MessageBatch> {
    const unsigned = createBatch('room-1', authorId, [makeBatchMessage()]);
    const signed = await signBatch(unsigned, privateKey);
    return { ...signed, ...overrides };
  }

  it('accepts a fully valid signed batch', async () => {
    const batch = await makeSignedBatch();
    expect(validateBatchStructure(batch)).toBe(true);
  });

  it('rejects null input', () => {
    expect(validateBatchStructure(null)).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(validateBatchStructure('string')).toBe(false);
    expect(validateBatchStructure(42)).toBe(false);
    expect(validateBatchStructure(undefined)).toBe(false);
  });

  it('rejects wrong schema', async () => {
    const batch = await makeSignedBatch({ schema: 'nexus:message-batch:v2' as any });
    expect(validateBatchStructure(batch)).toBe(false);
  });

  it('rejects missing roomId', async () => {
    const batch = await makeSignedBatch();
    const { roomId: _removed, ...rest } = batch;
    expect(validateBatchStructure(rest)).toBe(false);
  });

  it('rejects non-string roomId', async () => {
    const batch = await makeSignedBatch({ roomId: 123 as any });
    expect(validateBatchStructure(batch)).toBe(false);
  });

  it('rejects missing batchId', async () => {
    const batch = await makeSignedBatch();
    const { batchId: _removed, ...rest } = batch;
    expect(validateBatchStructure(rest)).toBe(false);
  });

  it('rejects non-string batchId', async () => {
    const batch = await makeSignedBatch({ batchId: 99 as any });
    expect(validateBatchStructure(batch)).toBe(false);
  });

  it('rejects missing author', async () => {
    const batch = await makeSignedBatch();
    const { author: _removed, ...rest } = batch;
    expect(validateBatchStructure(rest)).toBe(false);
  });

  it('rejects non-array messages', async () => {
    const batch = await makeSignedBatch({ messages: 'not-an-array' as any });
    expect(validateBatchStructure(batch)).toBe(false);
  });

  it('rejects messages exceeding MAX_BATCH_SIZE', async () => {
    const tooMany = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) =>
      makeBatchMessage({ content: `msg-${i}` }),
    );
    const batch = await makeSignedBatch({ messages: tooMany });
    expect(validateBatchStructure(batch)).toBe(false);
  });

  it('accepts messages array at exactly MAX_BATCH_SIZE', async () => {
    const exactly = Array.from({ length: MAX_BATCH_SIZE }, (_, i) =>
      makeBatchMessage({ content: `msg-${i}` }),
    );
    const batch = await makeSignedBatch({ messages: exactly });
    expect(validateBatchStructure(batch)).toBe(true);
  });

  it('rejects missing sig', async () => {
    const batch = await makeSignedBatch();
    const { sig: _removed, ...rest } = batch;
    expect(validateBatchStructure(rest)).toBe(false);
  });

  it('rejects non-string sig', async () => {
    const batch = await makeSignedBatch({ sig: 12345 as any });
    expect(validateBatchStructure(batch)).toBe(false);
  });

  it('accepts empty messages array', async () => {
    const unsigned = createBatch('room-1', authorId, []);
    const signed = await signBatch(unsigned, privateKey);
    expect(validateBatchStructure(signed)).toBe(true);
  });
});
