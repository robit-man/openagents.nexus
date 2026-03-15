import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DHTRegistry, DHT_KEYS } from '../registry.js';
import type { AgentProfile, RoomManifest } from '../../protocol/types.js';

// ---- Mock KadDHT factory ----
function makeMockDHT() {
  const store = new Map<string, Uint8Array>();

  async function* put(key: Uint8Array, value: Uint8Array): AsyncIterable<never> {
    store.set(new TextDecoder().decode(key), value);
    // yields nothing — caller just drains
  }

  async function* get(key: Uint8Array): AsyncIterable<{ name: string; value: Uint8Array }> {
    const k = new TextDecoder().decode(key);
    if (store.has(k)) {
      yield { name: 'VALUE', value: store.get(k)! };
    }
    // if not found, yields nothing
  }

  return {
    put,
    get,
    // Test helper: peek at what was stored
    _store: store,
  };
}

const SAMPLE_PROFILE: AgentProfile = {
  schema: 'nexus:agent-profile:v1',
  peerId: 'QmTestPeer1',
  name: 'TestAgent',
  description: 'A test agent',
  type: 'autonomous',
  capabilities: [],
  role: 'full',
  transports: ['tcp'],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  previousVersion: null,
};

const SAMPLE_ROOM: RoomManifest = {
  schema: 'nexus:room-manifest:v1',
  roomId: 'room-42',
  topic: '/nexus/room/room-42',
  name: 'Test Room',
  description: 'A test room',
  createdBy: 'QmTestPeer1',
  createdAt: 1_700_000_000_000,
  type: 'persistent',
  access: 'public',
  retentionDefaults: {
    recommendedClass: 'cache',
    defaultBatchSize: 50,
  },
  memberCount: 0,
  previousVersion: null,
};

describe('DHTRegistry', () => {
  let dht: ReturnType<typeof makeMockDHT>;
  let registry: DHTRegistry;

  beforeEach(() => {
    dht = makeMockDHT();
    registry = new DHTRegistry(dht);
  });

  describe('publishProfile()', () => {
    it('stores the profile in the DHT under the correct key', async () => {
      await registry.publishProfile(SAMPLE_PROFILE);
      const key = `/nexus/agent/${SAMPLE_PROFILE.peerId}`;
      expect(dht._store.has(key)).toBe(true);
    });

    it('stores JSON-serialised profile data', async () => {
      await registry.publishProfile(SAMPLE_PROFILE);
      const key = `/nexus/agent/${SAMPLE_PROFILE.peerId}`;
      const stored = JSON.parse(new TextDecoder().decode(dht._store.get(key)!)) as AgentProfile;
      expect(stored).toEqual(SAMPLE_PROFILE);
    });

    it('throws when DHT put throws', async () => {
      const errorDHT = {
        async *put(): AsyncIterable<never> {
          throw new Error('DHT unavailable');
        },
        async *get(): AsyncIterable<never> { /* empty */ },
        _store: new Map(),
      };
      const reg = new DHTRegistry(errorDHT);
      await expect(reg.publishProfile(SAMPLE_PROFILE)).rejects.toThrow('DHT unavailable');
    });
  });

  describe('findProfile()', () => {
    it('returns the stored profile when found', async () => {
      await registry.publishProfile(SAMPLE_PROFILE);
      const found = await registry.findProfile(SAMPLE_PROFILE.peerId);
      expect(found).toEqual(SAMPLE_PROFILE);
    });

    it('returns null when the profile is not in the DHT', async () => {
      const found = await registry.findProfile('QmUnknownPeer');
      expect(found).toBeNull();
    });
  });

  describe('publishRoom()', () => {
    it('stores the room manifest under the correct key', async () => {
      await registry.publishRoom(SAMPLE_ROOM);
      const key = `/nexus/room/${SAMPLE_ROOM.roomId}`;
      expect(dht._store.has(key)).toBe(true);
    });

    it('stores JSON-serialised manifest data', async () => {
      await registry.publishRoom(SAMPLE_ROOM);
      const key = `/nexus/room/${SAMPLE_ROOM.roomId}`;
      const stored = JSON.parse(new TextDecoder().decode(dht._store.get(key)!)) as RoomManifest;
      expect(stored).toEqual(SAMPLE_ROOM);
    });

    it('throws when DHT put throws', async () => {
      const errorDHT = {
        async *put(): AsyncIterable<never> {
          throw new Error('DHT put failed');
        },
        async *get(): AsyncIterable<never> { /* empty */ },
        _store: new Map(),
      };
      const reg = new DHTRegistry(errorDHT);
      await expect(reg.publishRoom(SAMPLE_ROOM)).rejects.toThrow('DHT put failed');
    });
  });

  describe('findRoom()', () => {
    it('returns the stored room manifest when found', async () => {
      await registry.publishRoom(SAMPLE_ROOM);
      const found = await registry.findRoom(SAMPLE_ROOM.roomId);
      expect(found).toEqual(SAMPLE_ROOM);
    });

    it('returns null when the room is not in the DHT', async () => {
      const found = await registry.findRoom('nonexistent-room');
      expect(found).toBeNull();
    });
  });

  describe('advertiseCapability()', () => {
    it('stores a capability record under the correct key', async () => {
      await registry.advertiseCapability('code-review', 'QmTestPeer1');
      const key = `/nexus/capability/code-review`;
      expect(dht._store.has(key)).toBe(true);
    });

    it('stored capability record includes the provider peerId', async () => {
      await registry.advertiseCapability('translation', 'QmProviderPeer');
      const key = `/nexus/capability/translation`;
      const stored = JSON.parse(new TextDecoder().decode(dht._store.get(key)!));
      expect(stored.provider).toBe('QmProviderPeer');
    });

    it('stored capability record includes a timestamp', async () => {
      const before = Date.now();
      await registry.advertiseCapability('translation', 'QmProviderPeer');
      const after = Date.now();
      const key = `/nexus/capability/translation`;
      const stored = JSON.parse(new TextDecoder().decode(dht._store.get(key)!));
      expect(stored.timestamp).toBeGreaterThanOrEqual(before);
      expect(stored.timestamp).toBeLessThanOrEqual(after);
    });

    it('does not throw when DHT put fails (best-effort)', async () => {
      const errorDHT = {
        async *put(): AsyncIterable<never> {
          throw new Error('network error');
        },
        async *get(): AsyncIterable<never> { /* empty */ },
        _store: new Map(),
      };
      const reg = new DHTRegistry(errorDHT);
      // advertiseCapability should not throw — it logs and swallows the error
      await expect(reg.advertiseCapability('cap', 'peer')).resolves.toBeUndefined();
    });
  });
});

describe('DHT_KEYS', () => {
  it('agent key pattern is /nexus/agent/<peerId>', () => {
    expect(DHT_KEYS.agent('QmAbc')).toBe('/nexus/agent/QmAbc');
  });

  it('room key pattern is /nexus/room/<roomId>', () => {
    expect(DHT_KEYS.room('my-room')).toBe('/nexus/room/my-room');
  });

  it('capability key pattern is /nexus/capability/<name>', () => {
    expect(DHT_KEYS.capability('code-review')).toBe('/nexus/capability/code-review');
  });

  it('pin key pattern is /nexus/pin/<cid>', () => {
    expect(DHT_KEYS.pin('bafybei123')).toBe('/nexus/pin/bafybei123');
  });
});
