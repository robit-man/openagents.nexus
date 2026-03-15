/**
 * Unit tests for DHT schema validators and helpers
 *
 * Tests validateAgentProfile, validateRoomManifest, validateNexusMessage,
 * isValidCid, and sanitizeName.
 */

import { describe, it, expect } from 'vitest';
import {
  validateAgentProfile,
  validateRoomManifest,
  validateNexusMessage,
  isValidCid,
  sanitizeName,
} from '../validators.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function validProfile(): Record<string, unknown> {
  return {
    schema: 'nexus:agent-profile:v1',
    peerId: 'QmTestPeerIdABCDE',
    name: 'TestAgent',
    role: 'full',
    capabilities: [],
    transports: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

function validRoom(): Record<string, unknown> {
  return {
    schema: 'nexus:room-manifest:v1',
    roomId: 'general',
    name: 'General',
    topic: '/nexus/room/general',
    type: 'persistent',
    createdAt: 1_700_000_000_000,
  };
}

function validMessage(): Record<string, unknown> {
  return {
    version: 1,
    type: 'chat',
    id: 'some-uuid-1234567890',
    timestamp: 1_700_000_000_000,
    sender: 'QmSenderPeerId',
    topic: '/nexus/room/general',
    payload: { content: 'hello', format: 'text/plain', replyTo: null, threadId: null },
    references: [],
  };
}

// ---------------------------------------------------------------------------
// validateAgentProfile
// ---------------------------------------------------------------------------

describe('validateAgentProfile', () => {
  it('accepts a valid agent profile', () => {
    const result = validateAgentProfile(validProfile());
    expect(result).not.toBeNull();
    expect(result?.peerId).toBe('QmTestPeerIdABCDE');
  });

  it('returns null for null input', () => {
    expect(validateAgentProfile(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(validateAgentProfile('string')).toBeNull();
    expect(validateAgentProfile(42)).toBeNull();
    expect(validateAgentProfile([])).toBeNull();
  });

  it('returns null when schema is wrong', () => {
    const obj = { ...validProfile(), schema: 'nexus:agent-profile:v2' };
    expect(validateAgentProfile(obj)).toBeNull();
  });

  it('returns null when peerId is empty', () => {
    const obj = { ...validProfile(), peerId: '' };
    expect(validateAgentProfile(obj)).toBeNull();
  });

  it('returns null when peerId exceeds 128 chars', () => {
    const obj = { ...validProfile(), peerId: 'Q'.repeat(129) };
    expect(validateAgentProfile(obj)).toBeNull();
  });

  it('returns null when name exceeds 64 chars', () => {
    const obj = { ...validProfile(), name: 'a'.repeat(65) };
    expect(validateAgentProfile(obj)).toBeNull();
  });

  it('accepts name of exactly 64 chars', () => {
    const obj = { ...validProfile(), name: 'a'.repeat(64) };
    expect(validateAgentProfile(obj)).not.toBeNull();
  });

  it('returns null for invalid role', () => {
    const obj = { ...validProfile(), role: 'supernode' };
    expect(validateAgentProfile(obj)).toBeNull();
  });

  it('accepts all valid roles', () => {
    for (const role of ['light', 'full', 'storage']) {
      const obj = { ...validProfile(), role };
      expect(validateAgentProfile(obj)).not.toBeNull();
    }
  });

  it('returns null when capabilities is not an array', () => {
    const obj = { ...validProfile(), capabilities: 'all' };
    expect(validateAgentProfile(obj)).toBeNull();
  });

  it('returns null when capabilities exceed MAX_CAPABILITY_COUNT (32)', () => {
    const obj = { ...validProfile(), capabilities: new Array(33).fill('x') };
    expect(validateAgentProfile(obj)).toBeNull();
  });

  it('returns null when transports exceed MAX_TRANSPORT_COUNT (16)', () => {
    const obj = { ...validProfile(), transports: new Array(17).fill('/ip4/1.2.3.4') };
    expect(validateAgentProfile(obj)).toBeNull();
  });

  it('returns null when createdAt is not a number', () => {
    const obj = { ...validProfile(), createdAt: '2024-01-01' };
    expect(validateAgentProfile(obj)).toBeNull();
  });

  it('returns null when updatedAt is not a number', () => {
    const obj = { ...validProfile(), updatedAt: null };
    expect(validateAgentProfile(obj)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateRoomManifest
// ---------------------------------------------------------------------------

describe('validateRoomManifest', () => {
  it('accepts a valid room manifest', () => {
    const result = validateRoomManifest(validRoom());
    expect(result).not.toBeNull();
    expect(result?.roomId).toBe('general');
  });

  it('returns null for null input', () => {
    expect(validateRoomManifest(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(validateRoomManifest(42)).toBeNull();
  });

  it('returns null when schema is wrong', () => {
    const obj = { ...validRoom(), schema: 'nexus:room-manifest:v2' };
    expect(validateRoomManifest(obj)).toBeNull();
  });

  it('returns null when roomId is empty', () => {
    const obj = { ...validRoom(), roomId: '' };
    expect(validateRoomManifest(obj)).toBeNull();
  });

  it('returns null when roomId exceeds 64 chars', () => {
    const obj = { ...validRoom(), roomId: 'r'.repeat(65) };
    expect(validateRoomManifest(obj)).toBeNull();
  });

  it('returns null when name exceeds 64 chars', () => {
    const obj = { ...validRoom(), name: 'n'.repeat(65) };
    expect(validateRoomManifest(obj)).toBeNull();
  });

  it('returns null when type is invalid', () => {
    const obj = { ...validRoom(), type: 'private' };
    expect(validateRoomManifest(obj)).toBeNull();
  });

  it('accepts both valid room types', () => {
    for (const type of ['persistent', 'ephemeral']) {
      expect(validateRoomManifest({ ...validRoom(), type })).not.toBeNull();
    }
  });

  it('returns null when createdAt is not a number', () => {
    const obj = { ...validRoom(), createdAt: 'yesterday' };
    expect(validateRoomManifest(obj)).toBeNull();
  });

  it('returns null when topic is not a string', () => {
    const obj = { ...validRoom(), topic: 42 };
    expect(validateRoomManifest(obj)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateNexusMessage
// ---------------------------------------------------------------------------

describe('validateNexusMessage', () => {
  it('accepts a valid chat message', () => {
    const result = validateNexusMessage(validMessage());
    expect(result).not.toBeNull();
    expect(result?.type).toBe('chat');
  });

  it('returns null for null input', () => {
    expect(validateNexusMessage(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(validateNexusMessage('string')).toBeNull();
  });

  it('returns null when version is not 1', () => {
    const obj = { ...validMessage(), version: 2 };
    expect(validateNexusMessage(obj)).toBeNull();
  });

  it('returns null when type is unknown', () => {
    const obj = { ...validMessage(), type: 'broadcast' };
    expect(validateNexusMessage(obj)).toBeNull();
  });

  it('accepts all valid message types', () => {
    for (const type of ['chat', 'presence', 'meta', 'capability', 'sync']) {
      expect(validateNexusMessage({ ...validMessage(), type })).not.toBeNull();
    }
  });

  it('returns null when id is empty', () => {
    const obj = { ...validMessage(), id: '' };
    expect(validateNexusMessage(obj)).toBeNull();
  });

  it('returns null when id exceeds 64 chars', () => {
    const obj = { ...validMessage(), id: 'x'.repeat(65) };
    expect(validateNexusMessage(obj)).toBeNull();
  });

  it('returns null when timestamp is not a number', () => {
    const obj = { ...validMessage(), timestamp: 'now' };
    expect(validateNexusMessage(obj)).toBeNull();
  });

  it('returns null when sender is empty', () => {
    const obj = { ...validMessage(), sender: '' };
    expect(validateNexusMessage(obj)).toBeNull();
  });

  it('returns null when sender exceeds 128 chars', () => {
    const obj = { ...validMessage(), sender: 'Q'.repeat(129) };
    expect(validateNexusMessage(obj)).toBeNull();
  });

  it('returns null when payload is missing', () => {
    const obj = { ...validMessage(), payload: undefined };
    expect(validateNexusMessage(obj)).toBeNull();
  });

  it('returns null when payload is a primitive', () => {
    const obj = { ...validMessage(), payload: 'content' };
    expect(validateNexusMessage(obj)).toBeNull();
  });

  it('accepts message with no references field', () => {
    const obj = { ...validMessage() };
    delete (obj as any).references;
    expect(validateNexusMessage(obj)).not.toBeNull();
  });

  it('returns null when references is not an array', () => {
    const obj = { ...validMessage(), references: 'cid1,cid2' };
    expect(validateNexusMessage(obj)).toBeNull();
  });

  it('returns null when references exceed 8 items', () => {
    const obj = { ...validMessage(), references: new Array(9).fill('bafybeicid') };
    expect(validateNexusMessage(obj)).toBeNull();
  });

  it('accepts references array with exactly 8 items', () => {
    const obj = { ...validMessage(), references: new Array(8).fill('bafybeicid') };
    expect(validateNexusMessage(obj)).not.toBeNull();
  });

  it('returns null when a reference entry is empty string', () => {
    const obj = { ...validMessage(), references: [''] };
    expect(validateNexusMessage(obj)).toBeNull();
  });

  it('returns null when a reference entry exceeds 128 chars', () => {
    const obj = { ...validMessage(), references: ['b'.repeat(129)] };
    expect(validateNexusMessage(obj)).toBeNull();
  });

  it('returns null when a reference entry is not a string', () => {
    const obj = { ...validMessage(), references: [42] };
    expect(validateNexusMessage(obj)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isValidCid
// ---------------------------------------------------------------------------

describe('isValidCid', () => {
  it('accepts CIDv0 (starts with Qm)', () => {
    expect(isValidCid('QmPeerAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
  });

  it('accepts CIDv1 starting with baf', () => {
    expect(isValidCid('bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku')).toBe(true);
  });

  it('accepts CIDv1 starting with b', () => {
    expect(isValidCid('bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354')).toBe(true);
  });

  it('accepts CIDv1 starting with z', () => {
    expect(isValidCid('zQmWvQxTqbG2Z8UYpio7mHdVFdGQqNSM2NqPMrRzfMx4uh7')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidCid('')).toBe(false);
  });

  it('rejects string exceeding 128 chars', () => {
    expect(isValidCid('b' + 'a'.repeat(128))).toBe(false);
  });

  it('rejects string that does not start with Qm, baf, b, or z', () => {
    expect(isValidCid('invalid-cid-format')).toBe(false);
  });

  it('rejects non-string input (guard check)', () => {
    expect(isValidCid(null as unknown as string)).toBe(false);
    expect(isValidCid(42 as unknown as string)).toBe(false);
  });

  it('accepts exactly 128-char CID starting with baf', () => {
    const cid = 'baf' + 'a'.repeat(125); // 128 chars total
    expect(isValidCid(cid)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sanitizeName
// ---------------------------------------------------------------------------

describe('sanitizeName', () => {
  it('returns name unchanged when valid', () => {
    expect(sanitizeName('MyAgent')).toBe('MyAgent');
  });

  it('removes characters that are not word, space, hyphen, dot, or underscore', () => {
    expect(sanitizeName('My<Agent>')).toBe('MyAgent');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeName('  Agent  ')).toBe('Agent');
  });

  it('truncates to default maxLength of 64', () => {
    const long = 'a'.repeat(100);
    expect(sanitizeName(long).length).toBe(64);
  });

  it('truncates to custom maxLength', () => {
    expect(sanitizeName('hello world', 5).length).toBeLessThanOrEqual(5);
  });

  it('returns "unnamed" when sanitized result is empty', () => {
    expect(sanitizeName('!!!###')).toBe('unnamed');
  });

  it('allows hyphens, underscores, and dots', () => {
    const name = 'my-agent_v1.0';
    expect(sanitizeName(name)).toBe(name);
  });

  it('allows spaces within name', () => {
    expect(sanitizeName('My Agent')).toBe('My Agent');
  });
});
