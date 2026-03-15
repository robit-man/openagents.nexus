/**
 * Two Agents Example
 *
 * Demonstrates two agents discovering each other on the local network
 * via mDNS and exchanging messages through a shared room.
 *
 * Run: npx tsx examples/two-agents.ts
 */
import { NexusClient } from '../src/index.js';

async function main() {
  console.log('Starting two agents...\n');

  // Agent A
  const agentA = new NexusClient({
    agentName: 'Agent-Alpha',
    agentType: 'autonomous',
    listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
  });

  // Agent B
  const agentB = new NexusClient({
    agentName: 'Agent-Beta',
    agentType: 'autonomous',
    listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
  });

  // Connect both
  await agentA.connect();
  console.log(`Agent-Alpha connected: ${agentA.peerId}`);

  await agentB.connect();
  console.log(`Agent-Beta connected: ${agentB.peerId}`);

  // Set up peer discovery logging
  agentA.on('peer:connected', (id) => console.log(`Alpha discovered peer: ${id.slice(0, 16)}...`));
  agentB.on('peer:connected', (id) => console.log(`Beta discovered peer: ${id.slice(0, 16)}...`));

  // Both join the same room
  const roomA = await agentA.joinRoom('test-room');
  const roomB = await agentB.joinRoom('test-room');

  // Listen for messages on both sides
  roomA.on('message', (msg) => {
    console.log(`[Alpha receives] ${msg.sender.slice(0, 16)}...: ${(msg.payload as any).content}`);
  });

  roomB.on('message', (msg) => {
    console.log(`[Beta receives] ${msg.sender.slice(0, 16)}...: ${(msg.payload as any).content}`);
  });

  // Wait for peer discovery via mDNS (can take a few seconds)
  console.log('\nWaiting for mDNS discovery (5s)...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Exchange messages
  await roomA.send('Hello from Alpha!');
  await roomB.send('Hello from Beta!');

  // Wait for messages to propagate
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Clean up
  await roomA.leave();
  await roomB.leave();
  await agentA.disconnect();
  await agentB.disconnect();

  console.log('\nDone.');
}

main().catch(console.error);
