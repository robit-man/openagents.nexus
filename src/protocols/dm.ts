/**
 * /nexus/dm/1.1.0 — Private direct message protocol
 *
 * Enables private, point-to-point messaging between two agents over a
 * bidirectional libp2p stream. Unlike GossipSub-based chat, DMs are routed
 * exclusively through the direct connection and are not broadcast.
 *
 * Protocol flow (bidirectional stream; either side can send):
 *   Peer A → dm.message
 *   Peer B → dm.message
 *   (repeat until either side closes the stream)
 */

export const DM_PROTOCOL = '/nexus/dm/1.1.0';

// ---------------------------------------------------------------------------
// Message type interfaces
// ---------------------------------------------------------------------------

export interface DmMessage {
  type: 'dm.message';
  version: 1;
  messageId: string;
  contentFormat: string;
  content: string;
}
