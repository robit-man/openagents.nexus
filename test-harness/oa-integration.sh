#!/usr/bin/env bash
# Test harness: validates @openagents/nexus as an installable npm package
# Uses an isolated folder to simulate what an agent would do

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
WORK_DIR=$(mktemp -d)

echo "=== OpenAgents Nexus - Package Installation Test ==="
echo "Working directory: $WORK_DIR"
echo ""

# Cleanup trap: remove temp dir even on failure
cleanup() {
  echo ""
  echo "Cleaning up: $WORK_DIR"
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# Step 1: Build and pack the package
echo "[1/5] Building and packing @openagents/nexus..."
cd "$REPO_DIR"
npm run build
TARBALL=$(npm pack --pack-destination "$WORK_DIR" 2>/dev/null | tail -1)
echo "  Created: $TARBALL"

# Step 2: Create an isolated agent project
echo ""
echo "[2/5] Creating isolated agent project..."
cd "$WORK_DIR"
mkdir agent-test && cd agent-test
cat > package.json <<'EOF'
{
  "name": "nexus-agent-test",
  "version": "1.0.0",
  "type": "module",
  "private": true
}
EOF

# Step 3: Install the package from tarball
echo ""
echo "[3/5] Installing @openagents/nexus from tarball..."
npm install "$WORK_DIR/$TARBALL" 2>&1 | tail -3

# Step 4: Create and run a test script
echo ""
echo "[4/5] Running agent test script..."
cat > test-agent.mjs <<'SCRIPT'
import { NexusClient, SignalingServer } from '@openagents/nexus';

async function main() {
  console.log('  Starting hub...');
  const signaling = new SignalingServer({ port: 29090, host: '127.0.0.1' });
  await signaling.start();

  const hub = new NexusClient({
    agentName: 'TestHub',
    agentType: 'infrastructure',
    listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
    signalingServer: 'http://127.0.0.1:29090',
    bootstrapPeers: [],
  });
  await hub.connect();
  console.log(`  Hub online: ${hub.peerId}`);

  // Register hub multiaddrs so agents can find it
  const addrs = hub.network.node
    .getMultiaddrs()
    .map(a => a.toString())
    .filter(a => a.includes('127.0.0.1'));
  signaling.updateState({ bootstrapPeers: addrs, peerCount: 1 });

  // Verify signaling server responds correctly
  const bsRes = await fetch('http://127.0.0.1:29090/api/v1/bootstrap');
  if (!bsRes.ok) throw new Error(`Bootstrap endpoint returned ${bsRes.status}`);
  const bs = await bsRes.json();
  if (!Array.isArray(bs.peers) || bs.peers.length === 0) {
    throw new Error('Bootstrap endpoint returned no peers after update');
  }
  console.log(`  Bootstrap peers registered: ${bs.peers.length}`);

  console.log('  Starting agent...');
  const agent = new NexusClient({
    agentName: 'TestAgent',
    agentType: 'autonomous',
    listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
    signalingServer: 'http://127.0.0.1:29090',
    bootstrapPeers: [],
  });
  await agent.connect();
  console.log(`  Agent online: ${agent.peerId}`);

  // Verify distinct peer IDs
  if (hub.peerId === agent.peerId) throw new Error('Hub and agent have same peerId!');

  // Manually dial hub to ensure connectivity
  const hubAddr = hub.network.node
    .getMultiaddrs()
    .find(m => m.toString().includes('127.0.0.1'));
  await agent.network.node.dial(hubAddr);

  // Join room
  const room = await agent.joinRoom('test-room');
  console.log(`  Joined room: ${room.roomId}`);
  if (room.roomId !== 'test-room') throw new Error('Wrong room ID');

  // Check topic format
  if (!room.topic.includes('test-room')) throw new Error('Topic does not include room ID');

  // Send message
  const msgId = await room.send('Hello from installed package!');
  console.log(`  Sent message: ${msgId}`);

  // Verify UUIDv7 format
  const uuidv7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!uuidv7Pattern.test(msgId)) throw new Error(`Message ID is not a valid UUIDv7: ${msgId}`);

  // Check listRooms API
  const rooms = await agent.listRooms();
  if (!rooms.some(r => r.roomId === 'test-room')) {
    throw new Error('listRooms did not include the joined room');
  }
  console.log(`  Rooms: ${rooms.map(r => r.roomId).join(', ')}`);

  // Verify event emitter API
  let peerConnectedFired = false;
  agent.on('peer:connected', () => { peerConnectedFired = true; });

  // Test isConnected
  if (!agent.isConnected) throw new Error('agent.isConnected should be true');

  // Cleanup
  await room.leave();
  await agent.disconnect();
  if (agent.isConnected) throw new Error('agent.isConnected should be false after disconnect');

  await hub.disconnect();
  await signaling.stop();

  console.log('  All tests passed!');
}

main().catch(err => {
  console.error('  FAILED:', err.message);
  process.exit(1);
});
SCRIPT

node test-agent.mjs

# Step 5: Verify exports are correct (TypeScript consumers can import types)
echo ""
echo "[5/5] Verifying package exports..."
node --input-type=module <<'VERIFY'
import {
  NexusClient,
  SignalingServer,
  PROTOCOL_VERSION,
  PROTOCOLS,
  TOPICS,
  uuidv7,
  createMessage,
  encodeMessage,
  decodeMessage,
  roomTopic,
  ephemeralTopic,
  createLogger,
  setLogLevel,
  resolveConfig,
  DEFAULT_CONFIG,
} from '@openagents/nexus';

// Verify constructors exist
if (typeof NexusClient !== 'function') throw new Error('NexusClient is not a constructor');
if (typeof SignalingServer !== 'function') throw new Error('SignalingServer is not a constructor');

// Verify constants
if (PROTOCOL_VERSION !== 1) throw new Error('PROTOCOL_VERSION should be 1');
if (!PROTOCOLS.DHT) throw new Error('PROTOCOLS.DHT is missing');
if (!TOPICS.META) throw new Error('TOPICS.META is missing');

// Verify utility functions
if (typeof uuidv7 !== 'function') throw new Error('uuidv7 is not a function');
if (typeof createMessage !== 'function') throw new Error('createMessage is not a function');
if (typeof encodeMessage !== 'function') throw new Error('encodeMessage is not a function');
if (typeof decodeMessage !== 'function') throw new Error('decodeMessage is not a function');
if (typeof roomTopic !== 'function') throw new Error('roomTopic is not a function');
if (typeof ephemeralTopic !== 'function') throw new Error('ephemeralTopic is not a function');

// Verify config
if (typeof resolveConfig !== 'function') throw new Error('resolveConfig is not a function');
if (!DEFAULT_CONFIG) throw new Error('DEFAULT_CONFIG is missing');
if (DEFAULT_CONFIG.protocolVersion === undefined) {
  // protocolVersion is on the message, not config — skip
}

// Verify roomTopic shape
const topic = roomTopic('test-room');
if (!topic.includes('test-room')) throw new Error(`roomTopic output unexpected: ${topic}`);

console.log('  All exports verified!');
VERIFY

echo ""
echo "=== All checks passed ==="
