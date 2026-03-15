/**
 * Multi-layer peer discovery cascade
 *
 * Provides zero-config connectivity: agents find each other across the
 * internet without any manual configuration.
 *
 * Discovery levels (tried in order with graceful degradation):
 *   1. Signaling Server (openagents.nexus) — HTTP bootstrap peer fetch
 *   2. Public WebSocket Bootstrap Nodes — well-known Protocol Labs nodes
 *   3. Pubsub Peer Discovery — self-organizing topic-based discovery
 *   4. mDNS — local-area-network discovery (already implemented)
 *   5. Circuit Relay v2 — NAT traversal via relay nodes
 */

// Well-known public WebSocket bootstrap nodes from Protocol Labs / IPFS network.
// Used for initial connectivity and circuit relay, NOT for our private DHT.
export const PUBLIC_BOOTSTRAP_WSS = [
  '/dns4/am6.bootstrap.libp2p.io/tcp/443/wss/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dns4/sg1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
  '/dns4/sv15.bootstrap.libp2p.io/tcp/443/wss/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dns4/ams-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLer265NRgSp2LA3dPaeykiS1J6DifTC88f5uVQKNAd',
  '/dns4/sfo-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLju6m7xTh3DuokvT3886QRYqxAzb1kShaanJgW36yx',
  '/dns4/lon-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLMeWqB7YGVLJN3pNLQpmmEk35v6wYtsMGLzSr5QBU3',
  '/dns4/nyc-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLueR4xBeUbY9WZ9xGUUxunbKWcrNFTDAadQJmocnWm',
];

// Pubsub peer discovery topic — ALL nexus agents subscribe to this.
// Any agent on this topic discovers all other agents automatically,
// creating a self-organizing global peer mesh.
export const NEXUS_DISCOVERY_TOPIC = '_nexus._peer-discovery._p2p._pubsub';

// ---------------------------------------------------------------------------
// DiscoveryConfig
// ---------------------------------------------------------------------------

export interface DiscoveryConfig {
  /** Whether to connect to public Protocol Labs bootstrap nodes for initial network entry */
  usePublicBootstrap: boolean;
  /** Whether to enable circuit relay transport (enables NAT traversal for agents behind routers) */
  enableCircuitRelay: boolean;
  /** Whether to enable pubsub-based peer discovery on NEXUS_DISCOVERY_TOPIC */
  enablePubsubDiscovery: boolean;
  /** Whether to enable mDNS discovery (local network, always fast when available) */
  enableMdns: boolean;
  /** Additional user-supplied bootstrap peer multiaddrs (appended after signaling peers) */
  customBootstrapPeers: string[];
}

export const DEFAULT_DISCOVERY: DiscoveryConfig = {
  usePublicBootstrap: true,
  enableCircuitRelay: true,
  enablePubsubDiscovery: true,
  enableMdns: true,
  customBootstrapPeers: [],
};

/**
 * Merge a partial user-supplied discovery config with the defaults.
 * Does not mutate the defaults.
 */
export function resolveDiscovery(partial?: Partial<DiscoveryConfig>): DiscoveryConfig {
  return { ...DEFAULT_DISCOVERY, ...partial };
}

/**
 * Build the complete bootstrap peer list from all three sources:
 *   1. Signaling server peers (highest priority — freshest data)
 *   2. Custom user-supplied peers
 *   3. Well-known public WebSocket bootstrap nodes (fallback)
 *
 * Deduplicates across all sources using a Set so that the same multiaddr
 * never appears twice regardless of how many sources supply it.
 */
export function buildBootstrapList(
  config: DiscoveryConfig,
  signalingPeers: string[] = [],
): string[] {
  const peers = new Set<string>();

  // Signaling server peers first — most authoritative / freshest
  for (const peer of signalingPeers) {
    peers.add(peer);
  }

  // Custom bootstrap peers provided by the operator
  for (const peer of config.customBootstrapPeers) {
    peers.add(peer);
  }

  // Public bootstrap nodes as the global fallback
  if (config.usePublicBootstrap) {
    for (const peer of PUBLIC_BOOTSTRAP_WSS) {
      peers.add(peer);
    }
  }

  return Array.from(peers);
}
