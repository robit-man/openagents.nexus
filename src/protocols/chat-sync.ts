/**
 * /nexus/chat-sync/1.1.0 — Room history sync protocol
 *
 * Allows peers to synchronise room history by exchanging immutable
 * batch/checkpoint CID references. A peer that has been offline can request
 * batches it is missing from a peer that is online.
 *
 * Protocol flow (single request → single response over a direct stream):
 *   Requester → sync.request   (what room, since what checkpoint, max batches)
 *   Provider  → sync.response  (latest checkpoint CID + array of batch CIDs)
 */

export const CHAT_SYNC_PROTOCOL = '/nexus/chat-sync/1.1.0';

// ---------------------------------------------------------------------------
// Message type interfaces
// ---------------------------------------------------------------------------

export interface SyncRequest {
  type: 'sync.request';
  version: 1;
  roomId: string;
  sinceCheckpoint?: string; // CID — only return batches after this checkpoint
  maxBatches: number;
}

export interface SyncResponse {
  type: 'sync.response';
  version: 1;
  roomId: string;
  latestCheckpoint?: string; // CID of the newest checkpoint the provider has
  batches: string[]; // ordered list of batch CIDs (oldest → newest)
}
