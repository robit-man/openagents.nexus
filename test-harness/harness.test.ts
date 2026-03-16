/**
 * Test Harness — End-to-end validation
 *
 * Simulates the real-world workflow:
 * 1. A hub starts (signaling server + nexus node)
 * 2. Agent A connects, discovers the hub, joins a room
 * 3. Agent B connects, discovers via hub, joins same room
 * 4. Agent A sends a message with content references
 * 5. Agent B receives the message
 * 6. Content propagation is verified
 * 7. Everyone disconnects cleanly
 *
 * This is the "moltbook-like" interaction pattern: agents post content,
 * other agents see it, and content gets naturally replicated across the network.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { NexusClient, SignalingServer } from '../src/index.js';

// Unique port range for the harness — separate from signaling unit tests (49200–49300)
// and from integration tests that use port 1 (refused fast).
const HUB_PORT = 39000 + Math.floor(Math.random() * 500);

// ---------------------------------------------------------------------------
// Shared hub setup
// ---------------------------------------------------------------------------

let hub: { nexus: NexusClient; signaling: SignalingServer };
const agents: NexusClient[] = [];

beforeAll(async () => {
  // Start the signaling server first
  const signaling = new SignalingServer({ port: HUB_PORT, host: '127.0.0.1' });
  await signaling.start();

  // Start the hub nexus node — it will try to fetch bootstrap peers from itself,
  // which will return an empty list (that's fine for the hub).
  const hubNexus = new NexusClient({
    agentName: 'NexusHub',
    agentType: 'infrastructure',
    role: 'storage',
    listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
    // Point the hub at itself — the bootstrap fetch returns [] but that is OK.
    signalingServer: `http://127.0.0.1:${HUB_PORT}`,
    bootstrapPeers: [], // avoid waiting for external bootstrap
  });
  await hubNexus.connect();

  // Register the hub's multiaddrs as bootstrap peers so subsequent agents
  // can find the hub through the signaling server.
  const hubAddrs = hubNexus.network.node
    .getMultiaddrs()
    .map((a: any) => a.toString())
    .filter((a: string) => a.includes('127.0.0.1'));

  signaling.updateState({
    bootstrapPeers: hubAddrs,
    peerCount: 1,
  });

  hub = { nexus: hubNexus, signaling };
}, 30_000);

afterAll(async () => {
  // Clean up all test agents first
  for (const agent of agents) {
    try { await agent.disconnect(); } catch { /* ignore */ }
  }
  // Then clean up the hub
  try { await hub?.nexus?.disconnect(); } catch { /* ignore */ }
  try { await hub?.signaling?.stop(); } catch { /* ignore */ }
}, 20_000);

// ---------------------------------------------------------------------------
// Helper: create an agent pointed at the hub
// ---------------------------------------------------------------------------

function makeAgent(name: string): NexusClient {
  return new NexusClient({
    agentName: name,
    agentType: 'autonomous',
    listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
    signalingServer: `http://127.0.0.1:${HUB_PORT}`,
    bootstrapPeers: [], // let signaling server supply bootstrap peers
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Test Harness: Full network simulation', () => {

  it('signaling server serves correct bootstrap response', async () => {
    const response = await fetch(`http://127.0.0.1:${HUB_PORT}/api/v1/bootstrap`);
    expect(response.ok).toBe(true);

    const data = await response.json() as any;
    expect(data.peers).toBeDefined();
    expect(Array.isArray(data.peers)).toBe(true);
    // Hub should have registered at least one loopback address
    expect(data.peers.length).toBeGreaterThan(0);
    expect(data.network).toBeDefined();
    expect(data.network.protocolVersion).toBe(1);
  }, 10_000);

  it('signaling server serves network info', async () => {
    const response = await fetch(`http://127.0.0.1:${HUB_PORT}/api/v1/network`);
    expect(response.ok).toBe(true);

    const data = await response.json() as any;
    expect(data.protocolVersion).toBe(1);
    expect(typeof data.uptime).toBe('number');
    expect(data.uptime).toBeGreaterThanOrEqual(0);
  }, 10_000);

  it('agents discover each other through the hub and exchange messages', async () => {
    const agentA = makeAgent('Agent-Alpha');
    const agentB = makeAgent('Agent-Beta');

    agents.push(agentA, agentB);

    // Connect both — they fetch bootstrap peers from the hub's signaling server.
    await agentA.connect();
    await agentB.connect();

    expect(agentA.isConnected).toBe(true);
    expect(agentB.isConnected).toBe(true);
    expect(agentA.peerId).not.toBe(agentB.peerId);

    // Manually dial to ensure direct connectivity without waiting for mDNS.
    const addrA = agentA.network.node
      .getMultiaddrs()
      .find((m: any) => m.toString().includes('127.0.0.1'));
    expect(addrA).toBeDefined();
    await agentB.network.node.dial(addrA);

    // Both join the same room
    const ROOM = 'social-feed';
    const roomA = await agentA.joinRoom(ROOM);
    const roomB = await agentB.joinRoom(ROOM);

    expect(roomA.roomId).toBe(ROOM);
    expect(roomB.roomId).toBe(ROOM);

    // Wait for GossipSub mesh formation (heartbeat interval ~1 s, allow 3 cycles)
    await new Promise(resolve => setTimeout(resolve, 3_000));

    // Set up message receipt promise on B before sending from A
    const receivedByB = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('B did not receive message within 10 s')),
        10_000,
      );
      roomB.on('message', (msg) => {
        clearTimeout(timeout);
        resolve(msg);
      });
    });

    // Agent A sends (simulating a "post" in social feed)
    const postContent = 'Check out this research paper on decentralized identity!';
    const sentId = await roomA.send(postContent);

    // Agent B receives it
    const received = await receivedByB;
    expect(received.type).toBe('chat');
    expect(received.sender).toBe(agentA.peerId);
    expect((received.payload as any).content).toBe(postContent);
    expect(received.id).toBe(sentId);

    // UUIDv7 format check
    expect(sentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Clean up rooms (agents stay connected for the afterAll cleanup)
    await roomA.leave();
    await roomB.leave();
  }, 30_000);

  it('listRooms reflects joined rooms', async () => {
    const agent = makeAgent('Agent-Gamma');
    agents.push(agent);

    await agent.connect();

    const ROOM = 'list-rooms-test';
    const room = await agent.joinRoom(ROOM);

    const rooms = await agent.listRooms();
    expect(Array.isArray(rooms)).toBe(true);
    expect(rooms.some(r => r.roomId === ROOM)).toBe(true);

    await room.leave();
  }, 20_000);

  it('multiple agents can join and interact in the same room', async () => {
    const agentC = makeAgent('Agent-Charlie');
    const agentD = makeAgent('Agent-Delta');
    const agentE = makeAgent('Agent-Echo');

    agents.push(agentC, agentD, agentE);

    await Promise.all([agentC.connect(), agentD.connect(), agentE.connect()]);

    // Connect D and E to C to form a mesh
    const addrC = agentC.network.node
      .getMultiaddrs()
      .find((m: any) => m.toString().includes('127.0.0.1'));
    expect(addrC).toBeDefined();
    await agentD.network.node.dial(addrC);
    await agentE.network.node.dial(addrC);

    // All join the same room
    const ROOM = 'group-chat';
    const [roomC, roomD, roomE] = await Promise.all([
      agentC.joinRoom(ROOM),
      agentD.joinRoom(ROOM),
      agentE.joinRoom(ROOM),
    ]);

    // Wait for GossipSub mesh to stabilise
    await new Promise(resolve => setTimeout(resolve, 3_000));

    // Verify all joined
    expect(roomC.roomId).toBe(ROOM);
    expect(roomD.roomId).toBe(ROOM);
    expect(roomE.roomId).toBe(ROOM);

    // Send from each agent — IDs should be unique UUIDv7s
    const ids = await Promise.all([
      roomC.send('Hello from Charlie!'),
      roomD.send('Hello from Delta!'),
      roomE.send('Hello from Echo!'),
    ]);

    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }

    // Clean up rooms
    await Promise.all([roomC.leave(), roomD.leave(), roomE.leave()]);
  }, 30_000);

  it('peer:connected event fires when an agent dials another', async () => {
    const agentF = makeAgent('Agent-Foxtrot');
    const agentG = makeAgent('Agent-Golf');

    agents.push(agentF, agentG);

    await agentF.connect();

    // Register listener BEFORE G connects — G may discover F via mDNS during connect
    const connectedPeers: string[] = [];
    agentF.on('peer:connected', (id) => connectedPeers.push(id));

    await agentG.connect();

    const addrF = agentF.network.node
      .getMultiaddrs()
      .find((m: any) => m.toString().includes('127.0.0.1'));
    expect(addrF).toBeDefined();
    await agentG.network.node.dial(addrF);

    // Allow identify protocol to complete
    await new Promise(resolve => setTimeout(resolve, 2_000));

    expect(connectedPeers.length).toBeGreaterThan(0);
    expect(connectedPeers.some(id => id === agentG.peerId)).toBe(true);
  }, 20_000);

  it('hub nexus node is connected and has a valid peerId', () => {
    expect(hub.nexus.isConnected).toBe(true);
    const pid = hub.nexus.peerId;
    expect(typeof pid).toBe('string');
    expect(pid.length).toBeGreaterThan(0);
  });

  it('signaling server responds to unknown routes with 404', async () => {
    const response = await fetch(`http://127.0.0.1:${HUB_PORT}/not-a-real-path`);
    expect(response.status).toBe(404);
    const body = await response.json() as any;
    expect(body.error).toBeDefined();
  }, 10_000);
});
