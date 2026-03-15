/**
 * Pointer envelopes — signed, versioned DHT records.
 *
 * Every mutable record published to the DHT is wrapped in a PointerEnvelope.
 * The envelope binds the record's content (by CID), the issuer (by PeerId),
 * a monotonically-increasing sequence number, and an expiry time, all protected
 * by an Ed25519 signature.
 */

export interface PointerEnvelope {
  schema: 'nexus:pointer-envelope:v1';
  kind: 'profile-pointer' | 'room-pointer' | 'capability-pointer' | 'checkpoint-pointer' | 'storage-offer' | 'relay-offer';
  issuer: string;   // PeerId string of the signer
  cid: string;      // CID of the actual data (or inline small summary)
  seq: number;      // Monotonically increasing sequence number
  issuedAt: number; // Unix ms
  expiresAt: number; // Unix ms
  sig: string;      // Base64 Ed25519 signature of the canonical JSON (excluding sig field)
}

/** Default TTLs per pointer kind (milliseconds). */
export const POINTER_TTLS: Record<PointerEnvelope['kind'], number> = {
  'profile-pointer':    24 * 60 * 60 * 1000, // 24h
  'room-pointer':        6 * 60 * 60 * 1000, // 6h
  'capability-pointer':      60 * 60 * 1000, // 1h
  'checkpoint-pointer':  30 * 60 * 1000,     // 30min
  'storage-offer':           60 * 60 * 1000, // 1h
  'relay-offer':         15 * 60 * 1000,     // 15min
};
