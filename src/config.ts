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

  // NAT traversal (all true by default — resilient cross-network connectivity)
  /** AutoNAT: detect if behind NAT by asking peers to dial us */
  enableAutoNAT?: boolean;
  /** DCUtR: hole-punch through relay for direct connections */
  enableDcutr?: boolean;
  /** UPnP NAT: auto-open ports on UPnP-capable routers */
  enableUpnpNat?: boolean;
  /** Run relay server regardless of role (lets light nodes relay for peers) */
  enableRelayServer?: boolean;
  /** Filter private/loopback addresses from external announcements */
  filterPrivateAddresses?: boolean;

  // Storage
  datastorePath?: string;

  // Bootstrap (Phase 4: federated multi-source)
  bootstrapSources?: BootstrapSource[];
  manifestUrls?: string[];
  cachePath?: string;

  // NATS pubsub discovery
  enableNats?: boolean;
  natsServers?: string[];

  // NKN fallback addressing (opt-in)
  enableNkn?: boolean;
  nknIdentifier?: string;

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
