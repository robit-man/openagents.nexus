/**
 * /nexus/handshake/1.1.0 — Live suitability query protocol
 *
 * Replaces trusting stale DHT data by performing a live capability/relay query
 * before opening an invoke stream. The requester asks what capabilities and
 * relay options the provider currently has available.
 *
 * Protocol flow (single-shot request/response over a direct stream):
 *   Requester → handshake.init
 *   Provider  → handshake.ack
 */

export const HANDSHAKE_PROTOCOL = '/nexus/handshake/1.1.0';

// ---------------------------------------------------------------------------
// Message type interfaces
// ---------------------------------------------------------------------------

export interface HandshakeInit {
  type: 'handshake.init';
  version: 1;
  requestId: string;
  peerId: string;
  agentName: string;
  agentType: string;
  roles: string[];
  wanted: {
    capabilityStatus?: boolean;
    relayOptions?: boolean;
    roomSummaries?: boolean;
  };
}

export interface HandshakeAck {
  type: 'handshake.ack';
  version: 1;
  requestId: string;
  peerId: string;
  agentName: string;
  agentType: string;
  roles: string[];
  capabilityStatus?: Array<{
    name: string;
    available: boolean;
    maxInputBytes?: number;
    streaming?: boolean;
    estimatedQueueMs?: number;
  }>;
  relay?: { available: boolean };
}
