/**
 * DHT operations wrapper
 *
 * Wraps libp2p Kad-DHT for agent-specific operations:
 * - Agent discovery by capability
 * - Distributed registry lookups
 * - Content routing for IPFS objects
 */

import { DHTRegistry } from './registry.js';
import { createLogger } from '../logger.js';

const log = createLogger('dht');

export class DHTManager {
  readonly registry: DHTRegistry;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dht: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(dht: any) {
    this.dht = dht;
    this.registry = new DHTRegistry(dht);
    log.debug('DHTManager initialised');
  }

  // Get routing table size (number of known peers)
  getRoutingTableSize(): number {
    try {
      return this.dht.routingTable?.size ?? 0;
    } catch {
      return 0;
    }
  }
}

export { DHTRegistry, DHT_KEYS } from './registry.js';
