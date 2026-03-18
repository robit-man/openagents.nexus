/**
 * libp2p node creation and configuration
 *
 * Responsible for creating and configuring the libp2p node with:
 * - Transport: TCP, WebSockets, Circuit Relay v2
 * - Encryption: Noise
 * - Muxer: Yamux
 * - Discovery: mDNS, Bootstrap (when peers provided), Pubsub Peer Discovery
 * - Services: Identify, KadDHT (/nexus/kad/1.1.0), GossipSub, Circuit Relay Server
 *
 * Discovery cascade (in priority order):
 *   1. Signaling Server peers — callers must pass these in via signalingPeers
 *   2. Public bootstrap WSS nodes — enabled by discoveryConfig.usePublicBootstrap
 *   3. Pubsub peer discovery — all agents subscribe to NEXUS_DISCOVERY_TOPIC
 *   4. mDNS — local-network zero-config discovery
 *   5. Circuit Relay v2 — NAT traversal (enabled for non-light roles)
 */

import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { kadDHT } from '@libp2p/kad-dht';
import { gossipsub } from '@libp2p/gossipsub';
import { identify } from '@libp2p/identify';
import { bootstrap } from '@libp2p/bootstrap';
import { mdns } from '@libp2p/mdns';
import { ping } from '@libp2p/ping';
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { peerIdFromString } from '@libp2p/peer-id';
import type { PrivateKey } from '@libp2p/interface';
import type { Message } from '@libp2p/gossipsub';
import { msgIdFn as nexusMsgIdFn, PROTOCOLS } from './protocol/index.js';
import type { NexusConfig } from './config.js';
import {
  resolveDiscovery,
  buildBootstrapList,
  getDiscoveryTopics,
  type DiscoveryConfig,
} from './discovery.js';
import { createLogger } from './logger.js';

const log = createLogger('node');

/**
 * Create and start a fully-configured libp2p nexus node.
 *
 * The node uses:
 *   - TCP + WebSockets + Circuit Relay v2 transports
 *   - Noise connection encryption
 *   - Yamux stream multiplexing
 *   - Identify service for protocol/address exchange
 *   - KadDHT on the /nexus/kad/1.1.0 protocol (client mode for 'light' role)
 *   - GossipSub for pub/sub messaging
 *   - Pubsub peer discovery on the global nexus discovery topic
 *   - mDNS for local-network peer discovery (controllable via discoveryConfig)
 *   - Bootstrap peer discovery (when the resolved bootstrap list is non-empty)
 *   - Circuit relay server for non-light roles (helps NAT'd peers connect)
 *
 * @param config         - Nexus node configuration
 * @param privateKey     - Ed25519 private key for this node's identity
 * @param discoveryConfig - Optional discovery cascade settings (defaults applied)
 * @param signalingPeers - Bootstrap peers fetched from the signaling server (Level 1)
 */
export async function createNexusNode(
  config: NexusConfig,
  privateKey: PrivateKey,
  discoveryConfig?: Partial<DiscoveryConfig>,
  signalingPeers: string[] = [],
) {
  // Resolve discovery settings, merging config-level fields and explicit param
  const discovery = resolveDiscovery({
    usePublicBootstrap: config.usePublicBootstrap,
    enableCircuitRelay: config.enableCircuitRelay,
    enablePubsubDiscovery: config.enablePubsubDiscovery,
    enableMdns: config.enableMdns,
    useDnsaddr: config.useDnsaddr,
    useTcpBootstrap: config.useTcpBootstrap,
    ...discoveryConfig,
  });

  // Build the combined bootstrap peer list from all sources
  // Merge config.bootstrapPeers (operator-supplied) into signalingPeers position
  const allSignalingPeers = [...signalingPeers, ...config.bootstrapPeers];
  const rawBootstrapList = buildBootstrapList(discovery, allSignalingPeers);

  // Validate bootstrap peers — filter out any with malformed peer IDs that
  // would cause @libp2p/bootstrap to throw "Incorrect length" and kill the node
  const bootstrapList: string[] = [];
  for (const addr of rawBootstrapList) {
    const parts = addr.split('/p2p/');
    if (parts.length < 2) {
      // No peer ID in multiaddr — skip
      continue;
    }
    try {
      peerIdFromString(parts[parts.length - 1]);
      bootstrapList.push(addr);
    } catch {
      log.debug(`Skipping invalid bootstrap peer: ${addr.slice(0, 80)}...`);
    }
  }
  if (rawBootstrapList.length !== bootstrapList.length) {
    log.info(`Bootstrap: filtered ${rawBootstrapList.length - bootstrapList.length} invalid peers (${bootstrapList.length} valid)`);
  }

  // Build peer discovery modules
  const peerDiscovery: ReturnType<
    typeof bootstrap | typeof mdns | typeof pubsubPeerDiscovery
  >[] = [];

  if (bootstrapList.length > 0) {
    peerDiscovery.push(bootstrap({ list: bootstrapList }));
  }

  if (discovery.enableMdns) {
    peerDiscovery.push(mdns());
  }

  if (discovery.enablePubsubDiscovery) {
    // Subscribe to ALL discovery topics for maximum redundancy.
    // If one mesh is fragmented, agents still find each other via the others.
    const topics = getDiscoveryTopics();
    peerDiscovery.push(
      pubsubPeerDiscovery({
        interval: discovery.pubsubDiscoveryIntervalMs ?? 10_000,
        topics,
        listenOnly: false,
      }),
    );
    log.info(`Pubsub discovery on ${topics.length} topics: ${topics.join(', ')}`);
  }

  // Build transport list — always include circuit relay transport so we can
  // both dial and receive relay-mediated connections.
  const transports = [
    tcp(),
    webSockets(),
    ...(discovery.enableCircuitRelay ? [circuitRelayTransport()] : []),
  ];

  // Listen addresses — add /p2p-circuit so relay-connected peers can reach us
  const listenAddresses = [
    ...config.listenAddresses,
    ...(discovery.enableCircuitRelay ? ['/p2p-circuit'] : []),
  ];

  // Adapt our protocol-level msgIdFn to the gossipsub MsgIdFn signature.
  // Gossipsub guarantees msg.data is always a Uint8Array for received messages.
  function gossipMsgIdFn(msg: Message): Uint8Array {
    return nexusMsgIdFn({ data: msg.data });
  }

  // Build services — full/storage nodes act as circuit relay servers, helping
  // NAT'd light nodes connect to the rest of the network.
  const isRelayServer = discovery.enableCircuitRelay && config.role !== 'light';

  const node = await createLibp2p({
    privateKey,
    addresses: {
      listen: listenAddresses,
    },
    transports,
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery,
    connectionManager: {
      dialTimeout: 10_000, // 10s — fail fast, don't hang
    },
    services: {
      identify: identify(),
      ping: ping(),
      dht: kadDHT({
        protocol: PROTOCOLS.DHT,
        clientMode: config.role === 'light',
      }),
      pubsub: gossipsub({
        emitSelf: false,
        allowPublishToZeroTopicPeers: true,
        msgIdFn: gossipMsgIdFn,
      }),
      ...(isRelayServer ? { relay: circuitRelayServer() } : {}),
    },
  });

  log.info(`Node created with PeerId: ${node.peerId.toString()}`);
  log.info(`Role: ${config.role}`);
  log.info(
    `Discovery: bootstrap=${bootstrapList.length} peers, ` +
    `mdns=${discovery.enableMdns}, ` +
    `pubsub=${discovery.enablePubsubDiscovery}, ` +
    `relay=${discovery.enableCircuitRelay}`,
  );
  log.info(`Listening on: ${node.getMultiaddrs().map((a) => a.toString()).join(', ')}`);

  return node;
}
