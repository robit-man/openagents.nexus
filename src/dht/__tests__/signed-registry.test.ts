import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { PrivateKey } from '@libp2p/interface';
import { DHTRegistry } from '../registry.js';
import type { AgentProfile, RoomManifest } from '../../protocol/types.js';
import type { PointerEnvelope } from '../../protocol/pointer-envelope.js';

// ---- Mock KadDHT factory (same as existing registry test) ----
function makeMockDHT() {
  const store = new Map<string, Uint8Array>();

  async function* put(key: Uint8Array, value: Uint8Array): AsyncIterable<never> {
    store.set(new TextDecoder().decode(key), value);
  }

  async function* get(key: Uint8Array): AsyncIterable<{ name: string; value: Uint8Array }> {
    const k = new TextDecoder().decode(key);
    if (store.has(k)) {
      yield { name: 'VALUE', value: store.get(k)! };
    }
  }

  return { put, get, _store: store };
}

// ---- Fixtures ----
let privateKey: PrivateKey;
let peerId: string;

beforeAll(async () => {
  privateKey = await generateKeyPair('Ed25519');
  peerId = peerIdFromPrivateKey(privateKey).toString();
});

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    schema: 'nexus:agent-profile:v1',
    peerId,
    name: 'TestAgent',
    description: 'A test agent',
    type: 'autonomous',
    capabilities: [],
    role: 'full',
    transports: ['tcp'],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    previousVersion: null,
    ...overrides,
  };
}

function makeRoom(overrides: Partial<RoomManifest> = {}): RoomManifest {
  return {
    schema: 'nexus:room-manifest:v1',
    roomId: 'room-signed-42',
    topic: '/nexus/room/room-signed-42',
    name: 'Signed Room',
    description: 'A signed test room',
    createdBy: peerId,
    createdAt: 1_700_000_000_000,
    type: 'persistent',
    access: 'public',
    retentionDefaults: {
      recommendedClass: 'cache',
      defaultBatchSize: 50,
    },
    memberCount: 0,
    previousVersion: null,
    ...overrides,
  };
}

// ---- publishProfile with signing ----
describe('DHTRegistry with signing — publishProfile()', () => {
  let dht: ReturnType<typeof makeMockDHT>;
  let registry: DHTRegistry;

  beforeEach(() => {
    dht = makeMockDHT();
    registry = new DHTRegistry(dht, privateKey);
  });

  it('stores a signed envelope in the DHT (not raw profile JSON)', async () => {
    const profile = makeProfile();
    await registry.publishProfile(profile);
    const key = `/nexus/agent/${profile.peerId}`;
    expect(dht._store.has(key)).toBe(true);
    const stored = JSON.parse(new TextDecoder().decode(dht._store.get(key)!)) as unknown;
    // Should be a PointerEnvelope, not a raw AgentProfile
    expect((stored as Record<string, unknown>).schema).toBe('nexus:pointer-envelope:v1');
    expect((stored as Record<string, unknown>).kind).toBe('profile-pointer');
  });

  it('stored envelope has a non-empty sig field', async () => {
    const profile = makeProfile();
    await registry.publishProfile(profile);
    const key = `/nexus/agent/${profile.peerId}`;
    const stored = JSON.parse(new TextDecoder().decode(dht._store.get(key)!)) as PointerEnvelope;
    expect(typeof stored.sig).toBe('string');
    expect(stored.sig.length).toBeGreaterThan(0);
  });

  it('stored envelope has issuer equal to the profile peerId', async () => {
    const profile = makeProfile();
    await registry.publishProfile(profile);
    const key = `/nexus/agent/${profile.peerId}`;
    const stored = JSON.parse(new TextDecoder().decode(dht._store.get(key)!)) as PointerEnvelope;
    expect(stored.issuer).toBe(peerId);
  });

  it('stored envelope has an expiresAt in the future', async () => {
    const before = Date.now();
    const profile = makeProfile();
    await registry.publishProfile(profile);
    const key = `/nexus/agent/${profile.peerId}`;
    const stored = JSON.parse(new TextDecoder().decode(dht._store.get(key)!)) as PointerEnvelope;
    expect(stored.expiresAt).toBeGreaterThan(before);
  });

  it('second publish increments seq number', async () => {
    const profile = makeProfile();
    await registry.publishProfile(profile);
    const key = `/nexus/agent/${profile.peerId}`;
    const first = JSON.parse(new TextDecoder().decode(dht._store.get(key)!)) as PointerEnvelope;

    await registry.publishProfile({ ...profile, name: 'Updated' });
    const second = JSON.parse(new TextDecoder().decode(dht._store.get(key)!)) as PointerEnvelope;

    expect(second.seq).toBeGreaterThan(first.seq);
  });
});

// ---- findProfile with validation ----
describe('DHTRegistry with signing — findProfile()', () => {
  let dht: ReturnType<typeof makeMockDHT>;
  let registry: DHTRegistry;

  beforeEach(() => {
    dht = makeMockDHT();
    registry = new DHTRegistry(dht, privateKey);
  });

  it('returns the profile when the envelope is valid and signed correctly', async () => {
    const profile = makeProfile();
    await registry.publishProfile(profile);
    const found = await registry.findProfile(peerId);
    expect(found).not.toBeNull();
    expect(found?.peerId).toBe(peerId);
  });

  it('returns null when no record exists', async () => {
    const found = await registry.findProfile('12D3KooWUnknown');
    expect(found).toBeNull();
  });

  it('returns null when the envelope has an invalid signature', async () => {
    const profile = makeProfile();
    await registry.publishProfile(profile);
    const key = `/nexus/agent/${profile.peerId}`;

    // Tamper with the stored envelope
    const raw = JSON.parse(new TextDecoder().decode(dht._store.get(key)!)) as PointerEnvelope;
    const tampered: PointerEnvelope = { ...raw, cid: 'bafybeihacked' };
    dht._store.set(key, new TextEncoder().encode(JSON.stringify(tampered)));

    const found = await registry.findProfile(peerId);
    expect(found).toBeNull();
  });

  it('returns null when the envelope is expired', async () => {
    const profile = makeProfile();
    await registry.publishProfile(profile);
    const key = `/nexus/agent/${profile.peerId}`;

    // Overwrite with an expired envelope (reuse same sig — sig will be invalid, but expiry check fires first)
    const raw = JSON.parse(new TextDecoder().decode(dht._store.get(key)!)) as PointerEnvelope;
    const expired: PointerEnvelope = { ...raw, expiresAt: Date.now() - 1_000 };
    dht._store.set(key, new TextEncoder().encode(JSON.stringify(expired)));

    const found = await registry.findProfile(peerId);
    expect(found).toBeNull();
  });
});

// ---- publishRoom with signing ----
describe('DHTRegistry with signing — publishRoom()', () => {
  let dht: ReturnType<typeof makeMockDHT>;
  let registry: DHTRegistry;

  beforeEach(() => {
    dht = makeMockDHT();
    registry = new DHTRegistry(dht, privateKey);
  });

  it('stores a signed envelope for the room', async () => {
    const room = makeRoom();
    await registry.publishRoom(room);
    const key = `/nexus/room/${room.roomId}`;
    expect(dht._store.has(key)).toBe(true);
    const stored = JSON.parse(new TextDecoder().decode(dht._store.get(key)!)) as PointerEnvelope;
    expect(stored.schema).toBe('nexus:pointer-envelope:v1');
    expect(stored.kind).toBe('room-pointer');
  });

  it('stored room envelope has a non-empty sig field', async () => {
    const room = makeRoom();
    await registry.publishRoom(room);
    const key = `/nexus/room/${room.roomId}`;
    const stored = JSON.parse(new TextDecoder().decode(dht._store.get(key)!)) as PointerEnvelope;
    expect(typeof stored.sig).toBe('string');
    expect(stored.sig.length).toBeGreaterThan(0);
  });
});

// ---- findRoom with validation ----
describe('DHTRegistry with signing — findRoom()', () => {
  let dht: ReturnType<typeof makeMockDHT>;
  let registry: DHTRegistry;

  beforeEach(() => {
    dht = makeMockDHT();
    registry = new DHTRegistry(dht, privateKey);
  });

  it('returns the room manifest when the envelope is valid', async () => {
    const room = makeRoom();
    await registry.publishRoom(room);
    const found = await registry.findRoom(room.roomId);
    expect(found).not.toBeNull();
    expect(found?.roomId).toBe(room.roomId);
  });

  it('returns null when no room record exists', async () => {
    const found = await registry.findRoom('nonexistent-room');
    expect(found).toBeNull();
  });

  it('returns null when the room envelope has a tampered signature', async () => {
    const room = makeRoom();
    await registry.publishRoom(room);
    const key = `/nexus/room/${room.roomId}`;

    const raw = JSON.parse(new TextDecoder().decode(dht._store.get(key)!)) as PointerEnvelope;
    const tampered: PointerEnvelope = { ...raw, cid: 'bafybeihacked' };
    dht._store.set(key, new TextEncoder().encode(JSON.stringify(tampered)));

    const found = await registry.findRoom(room.roomId);
    expect(found).toBeNull();
  });

  it('returns null when the room envelope is expired', async () => {
    const room = makeRoom();
    await registry.publishRoom(room);
    const key = `/nexus/room/${room.roomId}`;

    const raw = JSON.parse(new TextDecoder().decode(dht._store.get(key)!)) as PointerEnvelope;
    const expired: PointerEnvelope = { ...raw, expiresAt: Date.now() - 1_000 };
    dht._store.set(key, new TextEncoder().encode(JSON.stringify(expired)));

    const found = await registry.findRoom(room.roomId);
    expect(found).toBeNull();
  });
});

// ---- Backward compat: unsigned DHTRegistry (no privateKey) ----
describe('DHTRegistry without signing (backward compat)', () => {
  it('can be instantiated without a private key', () => {
    const dht = makeMockDHT();
    expect(() => new DHTRegistry(dht)).not.toThrow();
  });

  it('publishProfile still stores data when no key is provided', async () => {
    const dht = makeMockDHT();
    const registry = new DHTRegistry(dht);
    const profile = makeProfile();
    await registry.publishProfile(profile);
    const key = `/nexus/agent/${profile.peerId}`;
    expect(dht._store.has(key)).toBe(true);
  });
});
