/**
 * Unit tests for RoomCheckpoint creation, signing, and validation.
 *
 * Tests the checkpoint model that enables ordered, linked summaries
 * of multiple message batches. Checkpoints are immutable and can be
 * produced by any aggregator peer independently.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { PrivateKey } from '@libp2p/interface';
import {
  createCheckpoint,
  signCheckpoint,
  validateCheckpointStructure,
  type RoomCheckpoint,
} from '../checkpoint.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let privateKey: PrivateKey;
let aggregatorId: string;

const BATCH_CID_A = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const BATCH_CID_B = 'bafkreia2whgx6s37eelvekdkbwskyuqzlwtlnk5yjkk6na4is3i2kqzfei';
const PREV_CHECKPOINT_CID = 'bafkreibm6jg3ux5qumhcn2hiyvhmv3bs5se5j6ofer2dcqe4bpieyd3kxy';

beforeAll(async () => {
  privateKey = await generateKeyPair('Ed25519');
  aggregatorId = peerIdFromPrivateKey(privateKey).toString();
});

// ---------------------------------------------------------------------------
// createCheckpoint()
// ---------------------------------------------------------------------------

describe('createCheckpoint()', () => {
  it('produces a valid structure with correct schema', () => {
    const cp = createCheckpoint('room-1', 1, aggregatorId, [BATCH_CID_A]);

    expect(cp.schema).toBe('nexus:room-checkpoint:v1');
  });

  it('sets roomId correctly', () => {
    const cp = createCheckpoint('room-42', 1, aggregatorId, [BATCH_CID_A]);

    expect(cp.roomId).toBe('room-42');
  });

  it('sets epoch correctly', () => {
    const cp = createCheckpoint('room-1', 7, aggregatorId, [BATCH_CID_A]);

    expect(cp.epoch).toBe(7);
  });

  it('sets aggregator correctly', () => {
    const cp = createCheckpoint('room-1', 1, aggregatorId, [BATCH_CID_A]);

    expect(cp.aggregator).toBe(aggregatorId);
  });

  it('sets batchCids correctly', () => {
    const cp = createCheckpoint('room-1', 1, aggregatorId, [BATCH_CID_A, BATCH_CID_B]);

    expect(cp.batchCids).toEqual([BATCH_CID_A, BATCH_CID_B]);
  });

  it('defaults previousCheckpoint to null', () => {
    const cp = createCheckpoint('room-1', 1, aggregatorId, [BATCH_CID_A]);

    expect(cp.previousCheckpoint).toBeNull();
  });

  it('accepts an explicit previousCheckpoint CID', () => {
    const cp = createCheckpoint('room-1', 2, aggregatorId, [BATCH_CID_B], PREV_CHECKPOINT_CID);

    expect(cp.previousCheckpoint).toBe(PREV_CHECKPOINT_CID);
  });

  it('sets createdAt to a recent timestamp', () => {
    const before = Date.now();
    const cp = createCheckpoint('room-1', 1, aggregatorId, []);
    const after = Date.now();

    expect(cp.createdAt).toBeGreaterThanOrEqual(before);
    expect(cp.createdAt).toBeLessThanOrEqual(after);
  });

  it('accepts empty batchCids array', () => {
    const cp = createCheckpoint('room-1', 0, aggregatorId, []);

    expect(cp.batchCids).toEqual([]);
    expect(cp.schema).toBe('nexus:room-checkpoint:v1');
  });

  it('does not include a sig field (unsigned from createCheckpoint)', () => {
    const cp = createCheckpoint('room-1', 1, aggregatorId, [BATCH_CID_A]);

    expect('sig' in cp).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// signCheckpoint()
// ---------------------------------------------------------------------------

describe('signCheckpoint()', () => {
  it('returns a checkpoint with a non-empty sig field', async () => {
    const unsigned = createCheckpoint('room-1', 1, aggregatorId, [BATCH_CID_A]);
    const signed = await signCheckpoint(unsigned, privateKey);

    expect(typeof signed.sig).toBe('string');
    expect(signed.sig.length).toBeGreaterThan(0);
  });

  it('preserves all fields from the unsigned checkpoint', async () => {
    const unsigned = createCheckpoint('room-1', 1, aggregatorId, [BATCH_CID_A, BATCH_CID_B], PREV_CHECKPOINT_CID);
    const signed = await signCheckpoint(unsigned, privateKey);

    expect(signed.schema).toBe(unsigned.schema);
    expect(signed.roomId).toBe(unsigned.roomId);
    expect(signed.epoch).toBe(unsigned.epoch);
    expect(signed.createdAt).toBe(unsigned.createdAt);
    expect(signed.aggregator).toBe(unsigned.aggregator);
    expect(signed.batchCids).toEqual(unsigned.batchCids);
    expect(signed.previousCheckpoint).toBe(unsigned.previousCheckpoint);
  });

  it('produces a Base64-encoded signature', async () => {
    const unsigned = createCheckpoint('room-1', 1, aggregatorId, [BATCH_CID_A]);
    const signed = await signCheckpoint(unsigned, privateKey);

    // Base64 characters only
    expect(signed.sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('produces different sigs for different checkpoints', async () => {
    const unsigned1 = createCheckpoint('room-1', 1, aggregatorId, [BATCH_CID_A]);
    const unsigned2 = createCheckpoint('room-1', 2, aggregatorId, [BATCH_CID_B]);

    const signed1 = await signCheckpoint(unsigned1, privateKey);
    const signed2 = await signCheckpoint(unsigned2, privateKey);

    expect(signed1.sig).not.toBe(signed2.sig);
  });

  it('checkpoint with null previousCheckpoint signs successfully', async () => {
    const unsigned = createCheckpoint('room-1', 0, aggregatorId, [], null);
    const signed = await signCheckpoint(unsigned, privateKey);

    expect(signed.sig.length).toBeGreaterThan(0);
    expect(signed.previousCheckpoint).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateCheckpointStructure()
// ---------------------------------------------------------------------------

describe('validateCheckpointStructure()', () => {
  async function makeSignedCheckpoint(
    overrides: Partial<RoomCheckpoint> = {},
  ): Promise<RoomCheckpoint> {
    const unsigned = createCheckpoint('room-1', 1, aggregatorId, [BATCH_CID_A], PREV_CHECKPOINT_CID);
    const signed = await signCheckpoint(unsigned, privateKey);
    return { ...signed, ...overrides };
  }

  it('accepts a fully valid signed checkpoint', async () => {
    const cp = await makeSignedCheckpoint();
    expect(validateCheckpointStructure(cp)).toBe(true);
  });

  it('rejects null input', () => {
    expect(validateCheckpointStructure(null)).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(validateCheckpointStructure('string')).toBe(false);
    expect(validateCheckpointStructure(42)).toBe(false);
    expect(validateCheckpointStructure(undefined)).toBe(false);
  });

  it('rejects wrong schema', async () => {
    const cp = await makeSignedCheckpoint({ schema: 'nexus:room-checkpoint:v2' as any });
    expect(validateCheckpointStructure(cp)).toBe(false);
  });

  it('rejects missing roomId', async () => {
    const cp = await makeSignedCheckpoint();
    const { roomId: _removed, ...rest } = cp;
    expect(validateCheckpointStructure(rest)).toBe(false);
  });

  it('rejects non-string roomId', async () => {
    const cp = await makeSignedCheckpoint({ roomId: 123 as any });
    expect(validateCheckpointStructure(cp)).toBe(false);
  });

  it('rejects missing epoch', async () => {
    const cp = await makeSignedCheckpoint();
    const { epoch: _removed, ...rest } = cp;
    expect(validateCheckpointStructure(rest)).toBe(false);
  });

  it('rejects non-number epoch', async () => {
    const cp = await makeSignedCheckpoint({ epoch: 'one' as any });
    expect(validateCheckpointStructure(cp)).toBe(false);
  });

  it('rejects missing aggregator', async () => {
    const cp = await makeSignedCheckpoint();
    const { aggregator: _removed, ...rest } = cp;
    expect(validateCheckpointStructure(rest)).toBe(false);
  });

  it('rejects non-string aggregator', async () => {
    const cp = await makeSignedCheckpoint({ aggregator: {} as any });
    expect(validateCheckpointStructure(cp)).toBe(false);
  });

  it('rejects non-array batchCids', async () => {
    const cp = await makeSignedCheckpoint({ batchCids: 'not-an-array' as any });
    expect(validateCheckpointStructure(cp)).toBe(false);
  });

  it('rejects missing sig', async () => {
    const cp = await makeSignedCheckpoint();
    const { sig: _removed, ...rest } = cp;
    expect(validateCheckpointStructure(rest)).toBe(false);
  });

  it('rejects non-string sig', async () => {
    const cp = await makeSignedCheckpoint({ sig: 0 as any });
    expect(validateCheckpointStructure(cp)).toBe(false);
  });

  it('accepts checkpoint with empty batchCids', async () => {
    const unsigned = createCheckpoint('room-1', 0, aggregatorId, []);
    const signed = await signCheckpoint(unsigned, privateKey);
    expect(validateCheckpointStructure(signed)).toBe(true);
  });

  it('accepts checkpoint with null previousCheckpoint', async () => {
    const unsigned = createCheckpoint('room-1', 0, aggregatorId, [BATCH_CID_A], null);
    const signed = await signCheckpoint(unsigned, privateKey);
    expect(validateCheckpointStructure(signed)).toBe(true);
  });

  it('accepts checkpoint with a CID string as previousCheckpoint', async () => {
    const cp = await makeSignedCheckpoint({ previousCheckpoint: PREV_CHECKPOINT_CID });
    expect(validateCheckpointStructure(cp)).toBe(true);
  });
});
