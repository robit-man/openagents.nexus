/**
 * Integration test: two real libp2p nodes
 *
 * Spins up two NexusClient instances on loopback TCP, connects them, joins
 * the same GossipSub room, and verifies the full API surface end-to-end,
 * including cross-node message delivery via GossipSub.
 *
 * Uses @libp2p/gossipsub@15 which targets @libp2p/interface@3.x (matching
 * libp2p@3.x), resolving the incompatibility that existed with
 * @chainsafe/libp2p-gossipsub@14.x.
 *
 * Timeout is long because libp2p node startup (DHT, mDNS, identify) takes
 * several seconds even on loopback.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { NexusClient } from '../index.js';

describe('Integration: two-node lifecycle', () => {
  let agentA: NexusClient;
  let agentB: NexusClient;

  afterAll(async () => {
    // Best-effort cleanup — run sequentially so the second stop sees a clean state.
    try { await agentA?.disconnect(); } catch { /* ignore */ }
    try { await agentB?.disconnect(); } catch { /* ignore */ }
  });

  it('two agents can connect, join a room, send a message, and clean up', async () => {
    // -----------------------------------------------------------------------
    // 1. Create two clients
    //    - loopback-only (no external traffic)
    //    - empty bootstrap list (rely on mDNS for LAN discovery if needed)
    //    - signaling server pointed at a deliberately unreachable address so
    //      the fetch fails fast and does not block the test
    // -----------------------------------------------------------------------
    agentA = new NexusClient({
      agentName: 'Integration-Alpha',
      agentType: 'test',
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      bootstrapPeers: [],
      signalingServer: 'http://127.0.0.1:1',
    });

    agentB = new NexusClient({
      agentName: 'Integration-Beta',
      agentType: 'test',
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      bootstrapPeers: [],
      signalingServer: 'http://127.0.0.1:1',
    });

    // -----------------------------------------------------------------------
    // 2. Pre-connect assertions
    // -----------------------------------------------------------------------
    expect(agentA.isConnected).toBe(false);
    expect(agentB.isConnected).toBe(false);
    expect(() => agentA.peerId).toThrow('Not connected');

    // -----------------------------------------------------------------------
    // 3. Connect both nodes (creates and starts real libp2p nodes)
    // -----------------------------------------------------------------------
    await agentA.connect();
    await agentB.connect();

    expect(agentA.isConnected).toBe(true);
    expect(agentB.isConnected).toBe(true);

    // PeerIds must be non-empty strings and distinct from each other
    const peerIdA = agentA.peerId;
    const peerIdB = agentB.peerId;
    expect(typeof peerIdA).toBe('string');
    expect(peerIdA.length).toBeGreaterThan(0);
    expect(peerIdB).not.toBe(peerIdA);

    // network accessor should expose the live libp2p node
    expect(agentA.network.node).not.toBeNull();
    expect(agentB.network.node).not.toBeNull();

    // -----------------------------------------------------------------------
    // 4. Join the same room on both sides
    // -----------------------------------------------------------------------
    const ROOM = 'integration-test-room';
    const roomA = await agentA.joinRoom(ROOM);
    const roomB = await agentB.joinRoom(ROOM);

    expect(roomA.roomId).toBe(ROOM);
    expect(roomB.roomId).toBe(ROOM);
    expect(typeof roomA.topic).toBe('string');
    expect(roomA.topic.length).toBeGreaterThan(0);

    // listRooms should reflect the joined room
    const roomsA = await agentA.listRooms();
    expect(roomsA.some(r => r.roomId === ROOM)).toBe(true);

    // -----------------------------------------------------------------------
    // 5. Send a message from Agent A
    //    The send() call publishes via GossipSub; allowPublishToZeroTopicPeers
    //    is enabled so it succeeds even when no mesh peers are reachable.
    // -----------------------------------------------------------------------
    const msgId = await roomA.send('Hello from Integration-Alpha!');

    // send() must return a non-empty UUIDv7 string
    expect(typeof msgId).toBe('string');
    expect(msgId.length).toBeGreaterThan(0);
    // UUIDv7 format: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
    expect(msgId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // -----------------------------------------------------------------------
    // 6. Attempt a second send to verify idempotency of the pubsub publish
    // -----------------------------------------------------------------------
    const msgId2 = await roomA.send('Second message from Alpha');
    expect(msgId2).not.toBe(msgId); // each message gets a unique ID

    // -----------------------------------------------------------------------
    // 7. Clean up explicitly (afterAll also guards this)
    // -----------------------------------------------------------------------
    await roomA.leave();
    await roomB.leave();
    await agentA.disconnect();
    await agentB.disconnect();

    expect(agentA.isConnected).toBe(false);
    expect(agentB.isConnected).toBe(false);

    // Double-disconnect must not throw
    await expect(agentA.disconnect()).resolves.toBeUndefined();
    await expect(agentB.disconnect()).resolves.toBeUndefined();
  }, 30_000);
});

describe('Integration: peer events', () => {
  it('peer:connected event fires when the second node dials the first', async () => {
    const agentA = new NexusClient({
      agentName: 'Event-Alpha',
      agentType: 'test',
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      bootstrapPeers: [],
      signalingServer: 'http://127.0.0.1:1',
    });

    const agentB = new NexusClient({
      agentName: 'Event-Beta',
      agentType: 'test',
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      bootstrapPeers: [],
      signalingServer: 'http://127.0.0.1:1',
    });

    try {
      await agentA.connect();

      // Collect peer:connected events on Agent A BEFORE B connects
      // (B may discover A via mDNS during connect, triggering peer:connected immediately)
      const connectedPeers: string[] = [];
      agentA.on('peer:connected', (id) => connectedPeers.push(id));

      await agentB.connect();

      // Dial A from B using the underlying libp2p node
      const nodeA = agentA.network.node;
      const nodeB = agentB.network.node;
      const addrA = nodeA
        .getMultiaddrs()
        .find((m: any) => m.toString().includes('127.0.0.1'));

      expect(addrA).toBeDefined();
      await nodeB.dial(addrA);

      // Give the identify protocol time to complete
      await new Promise(resolve => setTimeout(resolve, 2_000));

      // A should have seen B's peerId in peer:connected events
      expect(connectedPeers.length).toBeGreaterThan(0);
      expect(connectedPeers.some(id => id === agentB.peerId)).toBe(true);
    } finally {
      await agentA.disconnect();
      await agentB.disconnect();
    }
  }, 30_000);
});

describe('Integration: cross-node message delivery', () => {
  it('Agent B receives a chat message sent by Agent A through GossipSub', async () => {
    const agentA = new NexusClient({
      agentName: 'Msg-Alpha',
      agentType: 'test',
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      bootstrapPeers: [],
      signalingServer: 'http://127.0.0.1:1',
    });

    const agentB = new NexusClient({
      agentName: 'Msg-Beta',
      agentType: 'test',
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      bootstrapPeers: [],
      signalingServer: 'http://127.0.0.1:1',
    });

    try {
      await agentA.connect();
      await agentB.connect();

      // Manually dial so peers are connected (don't wait for mDNS)
      const addrA = agentA.network.node
        .getMultiaddrs()
        .find((m: any) => m.toString().includes('127.0.0.1'));
      await agentB.network.node.dial(addrA);

      // Both join the same room
      const ROOM = 'cross-node-test';
      const roomA = await agentA.joinRoom(ROOM);
      const roomB = await agentB.joinRoom(ROOM);

      // Wait for GossipSub mesh to form (heartbeat interval is 1s)
      await new Promise(resolve => setTimeout(resolve, 3_000));

      // Set up a promise that resolves when B receives A's message
      const received = new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Message not received within 10s')), 10_000);
        roomB.on('message', (msg) => {
          clearTimeout(timeout);
          resolve(msg);
        });
      });

      // Agent A sends a message
      const TEST_CONTENT = `Hello from Alpha at ${Date.now()}`;
      const sentId = await roomA.send(TEST_CONTENT);

      // Agent B should receive it
      const msg = await received;
      expect(msg.type).toBe('chat');
      expect(msg.sender).toBe(agentA.peerId);
      expect(msg.id).toBe(sentId);
      expect((msg.payload as any).content).toBe(TEST_CONTENT);

      await roomA.leave();
      await roomB.leave();
    } finally {
      await agentA.disconnect();
      await agentB.disconnect();
    }
  }, 30_000);
});
