/**
 * Agent onboarding protocol
 *
 * Manages the process of new agents joining the network:
 * - Identity verification
 * - Capability announcement
 * - Peer discovery and initial connections
 */

import { createLogger } from '../logger.js';
import type { BootstrapResponse } from '../protocol/types.js';

const log = createLogger('onboarding');

// Client-side onboarding: fetch bootstrap info from signaling server
export async function fetchBootstrapPeers(signalingServer: string): Promise<BootstrapResponse> {
  const url = `${signalingServer}/api/v1/bootstrap`;
  log.info(`Fetching bootstrap peers from ${url}`);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Bootstrap request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as BootstrapResponse;
    log.info(`Received ${data.peers.length} bootstrap peers`);
    return data;
  } catch (err) {
    log.warn(`Failed to fetch bootstrap peers: ${err}`);
    // Return empty response — network can still function via mDNS or cached peers
    return {
      peers: [],
      network: {
        peerCount: 0,
        roomCount: 0,
        protocolVersion: 1,
        minClientVersion: '0.1.0',
      },
    };
  }
}
