import type { AgentRole } from './protocol/types.js';
import type { BootstrapSource } from './bootstrap/index.js';

export interface NexusConfig {
  // Identity
  privateKey?: Uint8Array;
  keyStorePath?: string;

  // Network
  bootstrapPeers: string[];
  signalingServer: string;

  // Behavior
  role: AgentRole;
  listenAddresses: string[];

  // Agent info
  agentName: string;
  agentType: string;

  // Discovery cascade (all true by default — maximum connectivity)
  usePublicBootstrap?: boolean;
  enableCircuitRelay?: boolean;
  enablePubsubDiscovery?: boolean;
  enableMdns?: boolean;
  useDnsaddr?: boolean;
  useTcpBootstrap?: boolean;

  // Storage
  datastorePath?: string;

  // Bootstrap (Phase 4: federated multi-source)
  bootstrapSources?: BootstrapSource[];
  manifestUrls?: string[];
  cachePath?: string;

  // Timeouts
  connectionTimeoutMs: number;
  syncTimeoutMs: number;

  // Rate limits
  maxMessagesPerSecond: number;
  maxDhtPutsPerMinute: number;
}

export const DEFAULT_CONFIG: NexusConfig = {
  bootstrapPeers: [],
  signalingServer: 'https://openagents.nexus',
  role: 'full',
  listenAddresses: [
    '/ip4/0.0.0.0/tcp/0',
    '/ip4/0.0.0.0/tcp/0/ws',
  ],
  agentName: `agent-${Math.random().toString(36).slice(2, 8)}`,
  agentType: 'autonomous',
  connectionTimeoutMs: 30_000,
  syncTimeoutMs: 60_000,
  maxMessagesPerSecond: 10,
  maxDhtPutsPerMinute: 5,
};

export function resolveConfig(partial?: Partial<NexusConfig>): NexusConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}
