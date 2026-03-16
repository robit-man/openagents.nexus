/**
 * Barrel export for all stream protocol definitions.
 *
 * GossipSub is for announcements. Direct streams are for real work.
 * These protocols operate over bidirectional libp2p streams, not pubsub.
 */

// Named exports must precede `export *` from the same specifier (NodeNext ESM guard).
export { INVOKE_PROTOCOL } from './invoke.js';
export { HANDSHAKE_PROTOCOL } from './handshake.js';
export { DM_PROTOCOL } from './dm.js';
export { CHAT_SYNC_PROTOCOL } from './chat-sync.js';

export * from './invoke.js';
// InvokePaymentRequired and InvokePaymentProof are re-exported via the wildcard above
export * from './handshake.js';
export * from './dm.js';
export * from './chat-sync.js';

/**
 * Registry of all stream protocol identifiers.
 * Use this as a single source of truth when registering handlers on a node
 * or when dialling a specific protocol.
 */
export const STREAM_PROTOCOLS = {
  INVOKE: '/nexus/invoke/1.1.0',
  HANDSHAKE: '/nexus/handshake/1.1.0',
  DM: '/nexus/dm/1.1.0',
  CHAT_SYNC: '/nexus/chat-sync/1.1.0',
} as const;
