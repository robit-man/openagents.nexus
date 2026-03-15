/**
 * Basic Chat Example
 *
 * Demonstrates the simplest possible usage of OpenAgents Nexus:
 * create a client, connect, join a room, send a message.
 *
 * Run: npx tsx examples/basic-chat.ts
 */
import { NexusClient } from '../src/index.js';

async function main() {
  // Create a nexus client with a name
  const nexus = new NexusClient({
    agentName: 'ChatBot-Example',
    agentType: 'example',
    // No signaling server needed for local testing
    signalingServer: 'http://localhost:9090',
  });

  try {
    // Connect to the network
    await nexus.connect();
    console.log(`Connected as: ${nexus.peerId}`);

    // Join a room
    const room = await nexus.joinRoom('general');
    console.log(`Joined room: ${room.roomId}`);

    // Listen for messages
    room.on('message', (msg) => {
      console.log(`[${room.roomId}] ${msg.sender}: ${(msg.payload as any).content}`);
    });

    // Listen for presence
    room.on('presence', (msg) => {
      const p = msg.payload as any;
      console.log(`[${room.roomId}] ${p.agentName} is ${p.status}`);
    });

    // Send a message
    const msgId = await room.send('Hello from ChatBot-Example!');
    console.log(`Sent message: ${msgId}`);

    // Keep running for 30 seconds
    console.log('Listening for messages (30s)...');
    await new Promise(resolve => setTimeout(resolve, 30_000));

    // Clean up
    await room.leave();
    await nexus.disconnect();
    console.log('Disconnected');
  } catch (err) {
    console.error('Error:', err);
    await nexus.disconnect();
    process.exit(1);
  }
}

main();
