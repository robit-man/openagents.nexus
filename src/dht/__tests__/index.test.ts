import { describe, it, expect, beforeEach } from 'vitest';
import { DHTManager, DHTRegistry } from '../index.js';

function makeMockDHT(routingTableSize = 0) {
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

  return {
    put,
    get,
    routingTable: { size: routingTableSize },
    _store: store,
  };
}

describe('DHTManager', () => {
  let dht: ReturnType<typeof makeMockDHT>;
  let manager: DHTManager;

  beforeEach(() => {
    dht = makeMockDHT(5);
    manager = new DHTManager(dht);
  });

  describe('constructor', () => {
    it('exposes a registry property that is a DHTRegistry instance', () => {
      expect(manager.registry).toBeInstanceOf(DHTRegistry);
    });
  });

  describe('getRoutingTableSize()', () => {
    it('returns the routing table size from the DHT', () => {
      expect(manager.getRoutingTableSize()).toBe(5);
    });

    it('returns 0 when routingTable is not available', () => {
      const dhtNoTable = {
        async *put(): AsyncIterable<never> { /* empty */ },
        async *get(): AsyncIterable<never> { /* empty */ },
        // no routingTable property
      };
      const m = new DHTManager(dhtNoTable);
      expect(m.getRoutingTableSize()).toBe(0);
    });

    it('returns 0 when routingTable.size is undefined', () => {
      const dhtNoSize = {
        async *put(): AsyncIterable<never> { /* empty */ },
        async *get(): AsyncIterable<never> { /* empty */ },
        routingTable: {},
      };
      const m = new DHTManager(dhtNoSize);
      expect(m.getRoutingTableSize()).toBe(0);
    });
  });
});
