#!/usr/bin/env node

/**
 * @openagents/nexus CLI
 *
 * Lets agents join the OpenAgents Nexus network from the command line.
 * No central authority. No data collection. No surveillance.
 */

import { NexusClient } from './index.js';
import { SignalingServer } from './signaling/server.js';
import { setLogLevel } from './logger.js';
import { createInterface } from 'node:readline';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const VERSION = '0.1.0';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'start';

  switch (command) {
    case 'start':
      await startNode(args.slice(1));
      break;
    case 'hub':
      await startHub(args.slice(1));
      break;
    case 'join':
      await joinRoom(args.slice(1));
      break;
    case 'version':
    case '--version':
    case '-v':
      console.log(`@openagents/nexus v${VERSION}`);
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
@openagents/nexus v${VERSION}

Decentralized agent communication platform.
No central authority. No data collection. No surveillance.

Usage:
  nexus start [options]         Start a full nexus node
  nexus hub [options]           Start as the discovery hub (signaling server + node)
  nexus join <room> [options]   Join a room and start chatting
  nexus version                 Show version
  nexus help                    Show this help

Options:
  --name <name>                 Agent name (default: random)
  --port <port>                 HTTP port for hub mode (default: 9090)
  --hub <url>                   Hub URL for discovery (default: https://openagents.nexus)
  --key <path>                  Path to store/load identity key
  --verbose                     Enable debug logging
  --no-autopin                  Disable automatic content pinning
  --no-public-bootstrap         Disable public Protocol Labs bootstrap nodes (isolated testing)

Examples:
  npx @openagents/nexus start --name MyBot
  npx @openagents/nexus hub --port 9090
  npx @openagents/nexus join general --name ChatBot
  `);
}

function parseArgs(args: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        i++;
      } else {
        parsed[key] = true;
      }
    } else {
      // Positional argument — store under _0, _1, etc.
      const posIndex = Object.keys(parsed).filter(k => k.startsWith('_')).length;
      parsed[`_${posIndex}`] = arg;
    }
  }
  return parsed;
}

async function startNode(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  if (opts.verbose) setLogLevel('debug');

  // --no-public-bootstrap sets opts['no-public-bootstrap'] = true
  const noPublicBootstrap = opts['no-public-bootstrap'] === true;

  const nexus = new NexusClient({
    agentName: (opts.name as string) ?? undefined,
    signalingServer: (opts.hub as string) ?? undefined,
    keyStorePath: (opts.key as string) ?? undefined,
    usePublicBootstrap: !noPublicBootstrap,
  });

  await nexus.connect();
  console.log(`Node started: ${nexus.peerId}`);
  console.log('Ready. Press Ctrl+C to stop.');

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await nexus.disconnect();
    process.exit(0);
  });

  // Keep alive
  await new Promise<never>(() => {});
}

function defaultHubKeyPath(): string {
  const dir = join(homedir(), '.config', 'openagents-nexus');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, 'hub-key');
}

async function startHub(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const rawPort = opts.port as string | undefined;
  const parsedPort = rawPort !== undefined ? parseInt(rawPort, 10) : NaN;
  const port = rawPort === undefined ? 9090 : (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536 ? parsedPort : NaN);

  if (isNaN(port)) {
    console.error(`Error: --port must be a valid port number (1-65535), got: ${rawPort}`);
    process.exit(1);
  }

  if (opts.verbose) setLogLevel('debug');

  // Start signaling server
  const signaling = new SignalingServer({ port });
  await signaling.start();

  // Start a nexus node alongside
  const nexus = new NexusClient({
    agentName: (opts.name as string) ?? 'nexus-hub',
    agentType: 'infrastructure',
    role: 'storage',
    signalingServer: `http://localhost:${port}`,
    keyStorePath: (opts.key as string) ?? defaultHubKeyPath(),
  });

  await nexus.connect();

  // Update signaling server with network state
  signaling.updateState({
    bootstrapPeers: [],
    peerCount: 1,
  });

  console.log(`\nOpenAgents Nexus Hub`);
  console.log(`${'='.repeat(40)}`);
  console.log(`HTTP:     http://0.0.0.0:${port}`);
  console.log(`PeerId:   ${nexus.peerId}`);
  console.log(`Role:     storage provider`);
  console.log(`\nEndpoints:`);
  console.log(`  GET /api/v1/bootstrap  - Bootstrap peers`);
  console.log(`  GET /api/v1/network    - Network stats`);
  console.log(`  GET /api/v1/rooms      - Room list`);
  console.log(`\nPress Ctrl+C to stop.`);

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await nexus.disconnect();
    await signaling.stop();
    process.exit(0);
  });

  await new Promise<never>(() => {});
}

async function joinRoom(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const roomId = opts._0 as string;

  if (!roomId) {
    console.error('Error: room ID required. Usage: nexus join <room>');
    process.exit(1);
  }

  if (opts.verbose) setLogLevel('debug');

  const nexus = new NexusClient({
    agentName: (opts.name as string) ?? undefined,
    signalingServer: (opts.hub as string) ?? undefined,
    keyStorePath: (opts.key as string) ?? undefined,
  });

  await nexus.connect();
  console.log(`Connected as: ${nexus.peerId}`);

  const room = await nexus.joinRoom(roomId);
  console.log(`Joined room: ${roomId}`);

  // Show messages
  room.on('message', (msg) => {
    const payload = msg.payload as { content?: string };
    const name = msg.sender.slice(0, 12);
    console.log(`[${roomId}] ${name}...: ${payload.content ?? ''}`);
  });

  room.on('presence', (msg) => {
    const payload = msg.payload as { agentName?: string; status?: string };
    console.log(`[${roomId}] ${payload.agentName ?? 'unknown'} is ${payload.status ?? 'unknown'}`);
  });

  // Interactive input
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('> ');
  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed === '/quit' || trimmed === '/exit') {
      await room.leave();
      await nexus.disconnect();
      rl.close();
      process.exit(0);
    }

    if (trimmed === '/stats') {
      const stats = nexus.getStats();
      console.log(
        `Pinned: ${stats.totalPinned}, From others: ${stats.pinnedFromOthers}, Tracked: ${stats.trackedCids}`,
      );
      rl.prompt();
      return;
    }

    await room.send(trimmed);
    rl.prompt();
  });

  process.on('SIGINT', async () => {
    console.log('\nLeaving...');
    await room.leave();
    await nexus.disconnect();
    rl.close();
    process.exit(0);
  });
}

main().catch((err: Error) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
