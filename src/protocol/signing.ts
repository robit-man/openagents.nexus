/**
 * Ed25519 signing and verification for pointer envelopes.
 *
 * Uses the libp2p crypto primitives already available in the dependency tree:
 *   - privateKey.sign(payload)  → Uint8Array signature
 *   - publicKey.verify(payload, sig) → boolean
 *
 * The canonical payload is a deterministic JSON string with a fixed key order
 * so that signer and verifier always hash the same bytes.
 */

import type { PrivateKey } from '@libp2p/interface';
import type { PointerEnvelope } from './pointer-envelope.js';

/**
 * Build the canonical JSON string for signing.
 *
 * Rules:
 *   - Fixed key order (matches the interface field order).
 *   - The `sig` field is excluded.
 *   - No trailing newlines or extra whitespace.
 */
export function canonicalPayload(envelope: Omit<PointerEnvelope, 'sig'>): string {
  const ordered = {
    schema: envelope.schema,
    kind: envelope.kind,
    issuer: envelope.issuer,
    cid: envelope.cid,
    seq: envelope.seq,
    issuedAt: envelope.issuedAt,
    expiresAt: envelope.expiresAt,
  };
  return JSON.stringify(ordered);
}

/**
 * Sign an envelope and return the complete envelope with the `sig` field set.
 *
 * The signature covers `canonicalPayload(envelope)` encoded as UTF-8 bytes.
 * The resulting sig is Base64-encoded for easy JSON transport.
 */
export async function signEnvelope(
  envelope: Omit<PointerEnvelope, 'sig'>,
  privateKey: PrivateKey,
): Promise<PointerEnvelope> {
  const payload = new TextEncoder().encode(canonicalPayload(envelope));
  const sigBytes = await privateKey.sign(payload);
  const sig = Buffer.from(sigBytes).toString('base64');
  return { ...envelope, sig };
}

/**
 * Verify an envelope's Ed25519 signature against the embedded issuer PeerId.
 *
 * For Ed25519 PeerIds the public key is embedded inline in the multihash,
 * so we can recover it from the PeerId string alone.
 *
 * Returns `false` on any error (invalid PeerId, RSA key without embedded pubkey, etc.).
 */
export async function verifyEnvelope(envelope: PointerEnvelope): Promise<boolean> {
  try {
    const { peerIdFromString } = await import('@libp2p/peer-id');
    const peerId = peerIdFromString(envelope.issuer);
    const publicKey = peerId.publicKey;
    if (!publicKey) return false;

    const payload = new TextEncoder().encode(canonicalPayload(envelope));
    const sigBytes = Buffer.from(envelope.sig, 'base64');

    return publicKey.verify(payload, sigBytes);
  } catch {
    return false;
  }
}

/**
 * Full envelope validation: structural checks, expiry, and signature.
 *
 * Returns `{ valid: true }` only when all checks pass.
 * On failure, `reason` names the first failing check.
 */
export async function validateEnvelope(
  envelope: PointerEnvelope,
): Promise<{ valid: boolean; reason?: string }> {
  // 1. Schema
  if (envelope.schema !== 'nexus:pointer-envelope:v1') {
    return { valid: false, reason: 'Invalid schema' };
  }

  // 2. Issuer
  if (!envelope.issuer || typeof envelope.issuer !== 'string') {
    return { valid: false, reason: 'Missing issuer' };
  }

  // 3. Sequence number
  if (typeof envelope.seq !== 'number' || envelope.seq < 0) {
    return { valid: false, reason: 'Invalid seq' };
  }

  // 4. issuedAt
  if (typeof envelope.issuedAt !== 'number') {
    return { valid: false, reason: 'Missing issuedAt' };
  }

  // 5. Expiry (checked before signature to short-circuit the crypto call)
  if (Date.now() > envelope.expiresAt) {
    return { valid: false, reason: 'Expired' };
  }

  // 6. Signature
  const sigValid = await verifyEnvelope(envelope);
  if (!sigValid) {
    return { valid: false, reason: 'Invalid signature' };
  }

  return { valid: true };
}

/**
 * Return `true` if `newer` should replace `older` in the DHT.
 *
 * Conditions (all must hold):
 *   - Same issuer (we never let one party overwrite another's record).
 *   - Same kind (different kinds are independent namespaces).
 *   - `newer.seq` strictly greater than `older.seq`.
 */
export function supersedes(newer: PointerEnvelope, older: PointerEnvelope): boolean {
  if (newer.issuer !== older.issuer) return false;
  if (newer.kind !== older.kind) return false;
  return newer.seq > older.seq;
}
