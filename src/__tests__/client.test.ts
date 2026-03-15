/**
 * NexusClient unit tests
 *
 * These tests cover the public API surface of NexusClient without spinning up
 * a real libp2p node. They verify construction, pre-connection guards, event
 * emitter behaviour, and safe disconnect semantics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NexusClient } from '../index.js';

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('NexusClient — construction', () => {
  it('creates an instance with no options', () => {
    const client = new NexusClient();
    expect(client).toBeInstanceOf(NexusClient);
  });

  it('creates an instance with partial options', () => {
    const client = new NexusClient({
      agentName: 'test-agent',
      role: 'light',
    });
    expect(client).toBeInstanceOf(NexusClient);
  });

  it('creates an instance with custom signaling server', () => {
    const client = new NexusClient({
      signalingServer: 'https://my-custom-server.example.com',
    });
    expect(client).toBeInstanceOf(NexusClient);
  });

  it('creates an instance with explicit bootstrap peers', () => {
    const client = new NexusClient({
      bootstrapPeers: ['/ip4/1.2.3.4/tcp/4001/p2p/QmTest'],
    });
    expect(client).toBeInstanceOf(NexusClient);
  });

  it('creates an instance with all options', () => {
    const client = new NexusClient({
      agentName: 'full-agent',
      agentType: 'specialist',
      role: 'storage',
      bootstrapPeers: [],
      signalingServer: 'https://openagents.nexus',
      listenAddresses: ['/ip4/0.0.0.0/tcp/0'],
      datastorePath: '/tmp/nexus-test',
    });
    expect(client).toBeInstanceOf(NexusClient);
  });
});

// ---------------------------------------------------------------------------
// isConnected
// ---------------------------------------------------------------------------

describe('NexusClient — isConnected', () => {
  it('returns false before connect() is called', () => {
    const client = new NexusClient();
    expect(client.isConnected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// peerId — throws when not connected
// ---------------------------------------------------------------------------

describe('NexusClient — peerId', () => {
  it('throws "Not connected" when accessed before connect()', () => {
    const client = new NexusClient();
    expect(() => client.peerId).toThrow('Not connected');
  });
});

// ---------------------------------------------------------------------------
// joinRoom — throws when not connected
// ---------------------------------------------------------------------------

describe('NexusClient — joinRoom', () => {
  it('throws "Not connected" when called before connect()', async () => {
    const client = new NexusClient();
    await expect(client.joinRoom('general')).rejects.toThrow('Not connected');
  });
});

// ---------------------------------------------------------------------------
// createRoom — throws when not connected
// ---------------------------------------------------------------------------

describe('NexusClient — createRoom', () => {
  it('throws "Not connected" when called before connect()', async () => {
    const client = new NexusClient();
    await expect(
      client.createRoom({ roomId: 'test-room', name: 'Test Room' }),
    ).rejects.toThrow('Not connected');
  });
});

// ---------------------------------------------------------------------------
// findAgent — throws when not connected
// ---------------------------------------------------------------------------

describe('NexusClient — findAgent', () => {
  it('throws "Not connected" when called before connect()', async () => {
    const client = new NexusClient();
    await expect(client.findAgent('12D3KooWTest')).rejects.toThrow('Not connected');
  });
});

// ---------------------------------------------------------------------------
// store — throws when not connected
// ---------------------------------------------------------------------------

describe('NexusClient — store', () => {
  it('throws "Not connected" when called with a string before connect()', async () => {
    const client = new NexusClient();
    await expect(client.store('hello')).rejects.toThrow('Not connected');
  });

  it('throws "Not connected" when called with a Uint8Array before connect()', async () => {
    const client = new NexusClient();
    await expect(client.store(new Uint8Array([1, 2, 3]))).rejects.toThrow('Not connected');
  });

  it('throws "Not connected" when called with an object before connect()', async () => {
    const client = new NexusClient();
    await expect(client.store({ key: 'value' })).rejects.toThrow('Not connected');
  });
});

// ---------------------------------------------------------------------------
// retrieve — throws when not connected
// ---------------------------------------------------------------------------

describe('NexusClient — retrieve', () => {
  it('throws "Not connected" when called before connect()', async () => {
    const client = new NexusClient();
    await expect(client.retrieve('bafkreitest')).rejects.toThrow('Not connected');
  });
});

// ---------------------------------------------------------------------------
// contribute — throws when not connected
// ---------------------------------------------------------------------------

describe('NexusClient — contribute', () => {
  it('throws "Not connected" when called before connect()', () => {
    const client = new NexusClient();
    expect(() => client.contribute({ storage: true })).toThrow('Not connected');
  });
});

// ---------------------------------------------------------------------------
// listRooms — safe before connect (returns empty array)
// ---------------------------------------------------------------------------

describe('NexusClient — listRooms', () => {
  it('returns an empty array when not connected', async () => {
    const client = new NexusClient();
    const rooms = await client.listRooms();
    expect(Array.isArray(rooms)).toBe(true);
    expect(rooms).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// disconnect — safe when not connected
// ---------------------------------------------------------------------------

describe('NexusClient — disconnect', () => {
  it('resolves without throwing when called before connect()', async () => {
    const client = new NexusClient();
    await expect(client.disconnect()).resolves.toBeUndefined();
  });

  it('is idempotent — calling disconnect() twice does not throw', async () => {
    const client = new NexusClient();
    await client.disconnect();
    await expect(client.disconnect()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Event emitter
// ---------------------------------------------------------------------------

describe('NexusClient — event emitter', () => {
  let client: NexusClient;

  beforeEach(() => {
    client = new NexusClient();
  });

  it('on() returns `this` for chaining', () => {
    const listener = vi.fn();
    const result = client.on('peer:connected', listener);
    expect(result).toBe(client);
  });

  it('off() returns `this` for chaining', () => {
    const listener = vi.fn();
    client.on('peer:connected', listener);
    const result = client.off('peer:connected', listener);
    expect(result).toBe(client);
  });

  it('registered listener is called when event fires', () => {
    const listener = vi.fn();
    client.on('peer:connected', listener);
    // Trigger the private emit method via white-box access
    (client as any).emit('peer:connected', '12D3KooWTestPeer');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith('12D3KooWTestPeer');
  });

  it('listener is NOT called after off()', () => {
    const listener = vi.fn();
    client.on('peer:connected', listener);
    client.off('peer:connected', listener);
    (client as any).emit('peer:connected', '12D3KooWTestPeer');
    expect(listener).not.toHaveBeenCalled();
  });

  it('multiple listeners on the same event all fire', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    client.on('peer:connected', listenerA);
    client.on('peer:connected', listenerB);
    (client as any).emit('peer:connected', '12D3KooWTestPeer');
    expect(listenerA).toHaveBeenCalledOnce();
    expect(listenerB).toHaveBeenCalledOnce();
  });

  it('removing one listener does not affect another', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    client.on('peer:connected', listenerA);
    client.on('peer:connected', listenerB);
    client.off('peer:connected', listenerA);
    (client as any).emit('peer:connected', '12D3KooWTestPeer');
    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledOnce();
  });

  it('off() on a never-registered listener does not throw', () => {
    const listener = vi.fn();
    expect(() => client.off('peer:connected', listener)).not.toThrow();
  });

  it('emit() on an event with no listeners does not throw', () => {
    expect(() =>
      (client as any).emit('peer:connected', '12D3KooWTestPeer'),
    ).not.toThrow();
  });

  it('peer:disconnected event fires with the peer ID', () => {
    const listener = vi.fn();
    client.on('peer:disconnected', listener);
    (client as any).emit('peer:disconnected', '12D3KooWDisconnected');
    expect(listener).toHaveBeenCalledWith('12D3KooWDisconnected');
  });

  it('error event fires with an Error object', () => {
    const listener = vi.fn();
    client.on('error', listener);
    const err = new Error('test error');
    (client as any).emit('error', err);
    expect(listener).toHaveBeenCalledWith(err);
  });

  it('supports chained on() calls', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    client
      .on('peer:connected', listenerA)
      .on('peer:disconnected', listenerB);
    (client as any).emit('peer:connected', 'peer-a');
    (client as any).emit('peer:disconnected', 'peer-b');
    expect(listenerA).toHaveBeenCalledWith('peer-a');
    expect(listenerB).toHaveBeenCalledWith('peer-b');
  });

  it('same listener registered twice only fires once per emit', () => {
    // Set semantics: the same function reference is deduplicated
    const listener = vi.fn();
    client.on('peer:connected', listener);
    client.on('peer:connected', listener); // duplicate
    (client as any).emit('peer:connected', 'peer-x');
    expect(listener).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// network accessor
// ---------------------------------------------------------------------------

describe('NexusClient — network accessor', () => {
  it('exposes a network object with node, dht, and storage keys', () => {
    const client = new NexusClient();
    const net = client.network;
    expect(net).toHaveProperty('node');
    expect(net).toHaveProperty('dht');
    expect(net).toHaveProperty('storage');
  });

  it('node is null before connect()', () => {
    const client = new NexusClient();
    expect(client.network.node).toBeNull();
  });

  it('dht is null before connect()', () => {
    const client = new NexusClient();
    expect(client.network.dht).toBeNull();
  });

  it('storage is a StorageManager instance before connect()', () => {
    const client = new NexusClient();
    // StorageManager is always created in the constructor
    expect(client.network.storage).toBeTruthy();
  });
});
