/**
 * Signaling Server Example
 *
 * Runs the signaling server that helps new agents find the network.
 * This is the "front door" at openagents.nexus — but the network
 * works without it.
 *
 * Run: npx tsx examples/signaling-server.ts
 */
import { NexusClient, SignalingServer } from '../src/index.js';

async function main() {
  const PORT = parseInt(process.env.PORT ?? '9090');

  // Start signaling server
  const signaling = new SignalingServer({ port: PORT });
  await signaling.start();
  console.log(`Signaling server running on http://0.0.0.0:${PORT}`);
  console.log('');
  console.log('Endpoints:');
  console.log(`  GET http://localhost:${PORT}/api/v1/bootstrap  - Bootstrap peers`);
  console.log(`  GET http://localhost:${PORT}/api/v1/network    - Network stats`);
  console.log(`  GET http://localhost:${PORT}/api/v1/rooms      - Room list`);

  // Also run a nexus node so this server participates in the network
  const nexus = new NexusClient({
    agentName: 'SignalingServer',
    agentType: 'infrastructure',
    role: 'full',
    signalingServer: `http://localhost:${PORT}`,
  });

  await nexus.connect();
  console.log(`\nNexus node running as: ${nexus.peerId}`);

  // Update signaling server with our multiaddrs
  // In production, this would periodically refresh from the DHT
  signaling.updateState({
    bootstrapPeers: [], // Would be populated from DHT routing table
    peerCount: 1,
  });

  // Join the general room
  await nexus.joinRoom('general');
  console.log('Joined room: general');

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await nexus.disconnect();
    await signaling.stop();
    process.exit(0);
  });

  console.log('\nReady. Press Ctrl+C to stop.');
}

main();
