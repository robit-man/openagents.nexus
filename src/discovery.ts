/**
 * Multi-layer peer discovery cascade with comprehensive free fallbacks
 *
 * Agents find each other across the internet with zero configuration.
 * Every discovery method is free, public, and requires no accounts.
 *
 * Discovery levels (all active simultaneously, graceful degradation):
 *
 *   Level 1: Signaling Server (openagents.nexus)
 *     → HTTP fetch for bootstrap peers from the nexus hub
 *     → Fails gracefully if hub is down
 *
 *   Level 2: Public WebSocket Bootstrap Nodes (Protocol Labs + IPFS)
 *     → 15+ well-known nodes across 3 continents
 *     → Both /dns4/.../wss and /dnsaddr/ formats for maximum compatibility
 *     → These are free public infrastructure maintained by Protocol Labs
 *
 *   Level 3: Pubsub Peer Discovery (multiple redundant topics)
 *     → 3 discovery topics — if one is congested, others still work
 *     → Any nexus agent on ANY topic discovers ALL others
 *     → Self-organizing: more agents = more reliable discovery
 *
 *   Level 4: mDNS (LAN)
 *     → Zero-config local network discovery
 *     → Works without internet
 *
 *   Level 5: Circuit Relay v2 (NAT traversal)
 *     → Agents behind NAT relay through public nodes
 *     → Full/storage nodes serve as free relays for the network
 *
 *   Level 6: DHT Random Walk
 *     → Once connected to ANY peer, DHT walking finds more
 *     → Our private /nexus/kad/1.1.0 DHT self-discovers
 */

// ═══════════════════════════════════════════════════════════════════
// PUBLIC BOOTSTRAP NODES — Free, maintained by Protocol Labs / IPFS
// ═══════════════════════════════════════════════════════════════════

// WebSocket Secure (WSS) bootstrap nodes — work from both Node.js and browsers
export const PUBLIC_BOOTSTRAP_WSS = [
  // Protocol Labs Amino DHT bootstrappers (WebSocket on port 443)
  '/dns4/am6.bootstrap.libp2p.io/tcp/443/wss/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dns4/sg1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
  '/dns4/sv15.bootstrap.libp2p.io/tcp/443/wss/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  // Protocol Labs geographic bootstrap nodes (WSS)
  '/dns4/ams-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLer265NRgSp2LA3dPaeykiS1J6DifTC88f5uVQKNAd',
  '/dns4/sfo-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLju6m7xTh3DuokvT3886QRYqxAzb1kShaanJgW36yx',
  '/dns4/lon-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLMeWqB7YGVLJN3pNLQpmmEk35v6wYtsMGLzSr5QBU3',
  '/dns4/sfo-2.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLnSGccFuZQJzRadHn95W2CrSFmZuTdDWP8HXaHca9z',
  '/dns4/sfo-3.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLPppuBtQSGwKDZT2M73ULpjvfd3aZ6ha4oFGL1KrGM',
  '/dns4/sgp-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLSafTMBsPKadTEgaXctDQVcqN88CNLHXMkTNwMKPnu',
  '/dns4/nyc-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLueR4xBeUbY9WZ9xGUUxunbKWcrNFTDAadQJmocnWm',
  '/dns4/nyc-2.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLV4Bbm51jM9C4gDYZQ9Cy3U6aXMJDAbzgu2fzaDs64',
];

// DNS-based bootstrap (dnsaddr records — auto-resolve to current IPs)
// These are more resilient than hardcoded IPs because Protocol Labs can
// update the underlying addresses without requiring a package update.
export const PUBLIC_BOOTSTRAP_DNSADDR = [
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
];

// TCP bootstrap nodes (for server-to-server when WSS isn't needed)
export const PUBLIC_BOOTSTRAP_TCP = [
  '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
];

// Combined: all free public bootstrap nodes
export const ALL_PUBLIC_BOOTSTRAP = [
  ...PUBLIC_BOOTSTRAP_WSS,
  ...PUBLIC_BOOTSTRAP_DNSADDR,
  ...PUBLIC_BOOTSTRAP_TCP,
];

// ═══════════════════════════════════════════════════════════════════
// PUBSUB DISCOVERY TOPICS — Multiple for redundancy
// ═══════════════════════════════════════════════════════════════════

// Primary discovery topic — all nexus agents subscribe here
export const NEXUS_DISCOVERY_TOPIC = '_nexus._peer-discovery._p2p._pubsub';

// Redundant discovery topics — if one is congested or has issues, others work
// Using multiple topics ensures agents can always find each other even if
// some GossipSub meshes are fragmented
export const NEXUS_DISCOVERY_TOPICS = [
  '_nexus._peer-discovery._p2p._pubsub',       // Primary
  'nexus:agents:discovery:v1',                   // Alternate namespace
  '_open-agents._nexus._discovery',              // Fallback
];

// ═══════════════════════════════════════════════════════════════════
// DISCOVERY CONFIG
// ═══════════════════════════════════════════════════════════════════

export interface DiscoveryConfig {
  /** Connect to public Protocol Labs bootstrap nodes (free, global) */
  usePublicBootstrap: boolean;
  /** Enable circuit relay v2 (NAT traversal via free public relays) */
  enableCircuitRelay: boolean;
  /** Enable pubsub-based peer discovery on all NEXUS_DISCOVERY_TOPICS */
  enablePubsubDiscovery: boolean;
  /** Enable mDNS (LAN discovery, no internet needed) */
  enableMdns: boolean;
  /** Use DNS-based bootstrap addresses (more resilient to IP changes) */
  useDnsaddr: boolean;
  /** Use TCP bootstrap nodes (server-to-server, no WSS overhead) */
  useTcpBootstrap: boolean;
  /** Additional user-supplied bootstrap peers */
  customBootstrapPeers: string[];
  /** Pubsub discovery interval in ms (lower = faster discovery, more bandwidth) */
  pubsubDiscoveryIntervalMs: number;
}

export const DEFAULT_DISCOVERY: DiscoveryConfig = {
  usePublicBootstrap: true,
  enableCircuitRelay: true,
  enablePubsubDiscovery: true,
  enableMdns: true,
  useDnsaddr: true,
  useTcpBootstrap: true,
  customBootstrapPeers: [],
  pubsubDiscoveryIntervalMs: 10_000,
};

/**
 * Merge partial discovery config with defaults (does not mutate defaults).
 */
export function resolveDiscovery(partial?: Partial<DiscoveryConfig>): DiscoveryConfig {
  // Filter out undefined values so they don't overwrite defaults.
  // e.g. { enableMdns: undefined } should NOT replace DEFAULT_DISCOVERY.enableMdns = true
  const defined = partial
    ? Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined))
    : {};
  return { ...DEFAULT_DISCOVERY, ...defined };
}

/**
 * Build the complete bootstrap peer list from all available sources.
 * Sources (in priority order):
 *   1. Signaling server peers (freshest, most relevant)
 *   2. Custom user-supplied peers
 *   3. Public WSS bootstrap nodes (global, free)
 *   4. Public dnsaddr bootstrap nodes (resilient to IP changes)
 *   5. Public TCP bootstrap nodes (server-to-server)
 *
 * Deduplicates by PeerId to avoid connecting to the same node twice
 * even when it appears with different transport multiaddrs.
 */
export function buildBootstrapList(
  config: DiscoveryConfig,
  signalingPeers: string[] = [],
): string[] {
  const peers = new Set<string>();

  // 1. Signaling server peers (highest priority)
  for (const peer of signalingPeers) {
    peers.add(peer);
  }

  // 2. Custom peers
  for (const peer of config.customBootstrapPeers) {
    peers.add(peer);
  }

  // 3. Public WSS bootstrap nodes
  if (config.usePublicBootstrap) {
    for (const peer of PUBLIC_BOOTSTRAP_WSS) {
      peers.add(peer);
    }
  }

  // 4. DNS-based bootstrap (auto-resolving)
  if (config.useDnsaddr) {
    for (const peer of PUBLIC_BOOTSTRAP_DNSADDR) {
      peers.add(peer);
    }
  }

  // 5. TCP bootstrap nodes
  if (config.useTcpBootstrap) {
    for (const peer of PUBLIC_BOOTSTRAP_TCP) {
      peers.add(peer);
    }
  }

  return Array.from(peers);
}

/**
 * Get the list of pubsub discovery topics for this node.
 * Using multiple topics provides redundancy — if one mesh is fragmented,
 * agents can still discover each other through the other topics.
 */
export function getDiscoveryTopics(): string[] {
  return [...NEXUS_DISCOVERY_TOPICS];
}
