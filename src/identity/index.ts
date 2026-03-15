/**
 * Agent identity (keypair) management
 *
 * Manages agent identities based on cryptographic keypairs.
 * Each agent has a unique PeerId derived from their public key,
 * providing verifiable identity without a central authority.
 */

import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { PrivateKey } from '@libp2p/interface';
import { generateIdentity, saveKey, loadKey } from './keys.js';
import { createLogger } from '../logger.js';

const log = createLogger('identity');

export interface IdentityInfo {
  privateKey: PrivateKey;
  peerId: string;
}

export interface ResolveIdentityOptions {
  /**
   * Explicit private key bytes (protobuf-encoded).
   * Takes priority over keyStorePath when provided.
   */
  privateKey?: Uint8Array;
  /**
   * Filesystem path to load/save the private key.
   * If the file does not exist a new identity is generated and saved.
   * Ignored when privateKey is provided.
   */
  keyStorePath?: string;
}

/**
 * Resolve an identity using the following priority order:
 *
 * 1. Explicit `privateKey` bytes (protobuf-encoded) — highest priority
 * 2. Load from `keyStorePath` (generate and save if missing)
 * 3. Generate ephemeral identity — lowest priority (not persisted)
 */
export async function resolveIdentity(options: ResolveIdentityOptions): Promise<IdentityInfo> {
  // Priority 1: Explicit private key provided as protobuf-encoded bytes
  if (options.privateKey) {
    const key = privateKeyFromProtobuf(options.privateKey);
    const peerId = peerIdFromPrivateKey(key).toString();
    log.info(`Using provided key, PeerId: ${peerId}`);
    return { privateKey: key, peerId };
  }

  // Priority 2: Load from keystore path (generate + persist if missing)
  if (options.keyStorePath) {
    const existing = await loadKey(options.keyStorePath);
    if (existing) {
      const peerId = peerIdFromPrivateKey(existing).toString();
      log.info(`Loaded existing identity: ${peerId}`);
      return { privateKey: existing, peerId };
    }
    // Generate fresh identity and persist it
    const { privateKey, peerId } = await generateIdentity();
    await saveKey(privateKey, options.keyStorePath);
    return { privateKey, peerId };
  }

  // Priority 3: Ephemeral identity — not written to disk
  log.info('Generating ephemeral identity (not persisted)');
  return generateIdentity();
}

export { generateIdentity, saveKey, loadKey } from './keys.js';
