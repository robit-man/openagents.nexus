/**
 * libp2p node creation and configuration
 *
 * Responsible for creating and configuring the libp2p node with:
 * - Transport: TCP, WebSockets
 * - Encryption: Noise
 * - Muxer: Yamux
 * - Discovery: mDNS, Bootstrap (when peers provided)
 * - Services: Identify, KadDHT (/nexus/kad/1.0.0), GossipSub
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
import type { PrivateKey } from '@libp2p/interface';
import type { Message } from '@libp2p/gossipsub';
import { msgIdFn as nexusMsgIdFn, PROTOCOLS } from './protocol/index.js';
import type { NexusConfig } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('node');

/**
 * Create and start a fully-configured libp2p nexus node.
 *
 * The node uses:
 *   - TCP + WebSockets transports
 *   - Noise connection encryption
 *   - Yamux stream multiplexing
 *   - Identify service for protocol/address exchange
 *   - KadDHT on the /nexus/kad/1.0.0 protocol (client mode for 'light' role)
 *   - GossipSub for pub/sub messaging
 *   - mDNS for local-network peer discovery (always enabled)
 *   - Bootstrap peer discovery (only when config.bootstrapPeers is non-empty)
 */
export async function createNexusNode(config: NexusConfig, privateKey: PrivateKey) {
  // Build optional peer discovery list
  const peerDiscovery: ReturnType<typeof bootstrap | typeof mdns>[] = [];

  if (config.bootstrapPeers.length > 0) {
    peerDiscovery.push(bootstrap({ list: config.bootstrapPeers }));
  }

  // mDNS enables zero-config LAN discovery
  peerDiscovery.push(mdns());

  // Adapt our protocol-level msgIdFn to the gossipsub MsgIdFn signature.
  // Gossipsub guarantees msg.data is always a Uint8Array for received messages.
  function gossipMsgIdFn(msg: Message): Uint8Array {
    return nexusMsgIdFn({ data: msg.data });
  }

  const node = await createLibp2p({
    privateKey,
    addresses: {
      listen: config.listenAddresses,
    },
    transports: [
      tcp(),
      webSockets(),
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery,
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
    },
  });

  log.info(`Node created with PeerId: ${node.peerId.toString()}`);
  log.info(`Listening on: ${node.getMultiaddrs().map((a) => a.toString()).join(', ')}`);

  return node;
}
