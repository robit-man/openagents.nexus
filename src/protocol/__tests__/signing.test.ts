import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { PrivateKey } from '@libp2p/interface';
import type { PointerEnvelope } from '../pointer-envelope.js';
import {
  canonicalPayload,
  signEnvelope,
  verifyEnvelope,
  validateEnvelope,
  supersedes,
} from '../signing.js';

// ---- Test fixtures ----
let privateKey: PrivateKey;
let peerId: string;

beforeAll(async () => {
  privateKey = await generateKeyPair('Ed25519');
  peerId = peerIdFromPrivateKey(privateKey).toString();
});

function makeEnvelopeBase(overrides: Partial<Omit<PointerEnvelope, 'sig'>> = {}): Omit<PointerEnvelope, 'sig'> {
  const now = Date.now();
  return {
    schema: 'nexus:pointer-envelope:v1',
    kind: 'profile-pointer',
    issuer: peerId,
    cid: 'bafybeiabc123',
    seq: 1,
    issuedAt: now,
    expiresAt: now + 60_000,
    ...overrides,
  };
}

// ---- canonicalPayload ----
describe('canonicalPayload()', () => {
  it('produces deterministic output for the same input', () => {
    const base = makeEnvelopeBase();
    const a = canonicalPayload(base);
    const b = canonicalPayload(base);
    expect(a).toBe(b);
  });

  it('produces the same JSON regardless of input object property order', () => {
    const base = makeEnvelopeBase();
    // Build the same envelope with reversed property insertion order
    const reordered: Omit<PointerEnvelope, 'sig'> = {
      expiresAt: base.expiresAt,
      issuedAt: base.issuedAt,
      seq: base.seq,
      cid: base.cid,
      issuer: base.issuer,
      kind: base.kind,
      schema: base.schema,
    };
    expect(canonicalPayload(base)).toBe(canonicalPayload(reordered));
  });

  it('excludes the sig field from the canonical payload', () => {
    const base = makeEnvelopeBase();
    const json = canonicalPayload(base);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect('sig' in parsed).toBe(false);
  });

  it('includes all required fields in canonical order', () => {
    const base = makeEnvelopeBase();
    const json = canonicalPayload(base);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.schema).toBe(base.schema);
    expect(parsed.kind).toBe(base.kind);
    expect(parsed.issuer).toBe(base.issuer);
    expect(parsed.cid).toBe(base.cid);
    expect(parsed.seq).toBe(base.seq);
    expect(parsed.issuedAt).toBe(base.issuedAt);
    expect(parsed.expiresAt).toBe(base.expiresAt);
  });
});

// ---- signEnvelope ----
describe('signEnvelope()', () => {
  it('returns an envelope with a non-empty sig field', async () => {
    const base = makeEnvelopeBase();
    const signed = await signEnvelope(base, privateKey);
    expect(typeof signed.sig).toBe('string');
    expect(signed.sig.length).toBeGreaterThan(0);
  });

  it('preserves all original fields on the signed envelope', async () => {
    const base = makeEnvelopeBase();
    const signed = await signEnvelope(base, privateKey);
    expect(signed.schema).toBe(base.schema);
    expect(signed.kind).toBe(base.kind);
    expect(signed.issuer).toBe(base.issuer);
    expect(signed.cid).toBe(base.cid);
    expect(signed.seq).toBe(base.seq);
    expect(signed.issuedAt).toBe(base.issuedAt);
    expect(signed.expiresAt).toBe(base.expiresAt);
  });

  it('produces a base64 encoded sig', async () => {
    const base = makeEnvelopeBase();
    const signed = await signEnvelope(base, privateKey);
    // Valid base64 only contains these chars
    expect(/^[A-Za-z0-9+/]+=*$/.test(signed.sig)).toBe(true);
  });
});

// ---- verifyEnvelope ----
describe('verifyEnvelope()', () => {
  it('returns true for a correctly signed envelope', async () => {
    const base = makeEnvelopeBase();
    const signed = await signEnvelope(base, privateKey);
    const result = await verifyEnvelope(signed);
    expect(result).toBe(true);
  });

  it('returns false when the sig is tampered with', async () => {
    const base = makeEnvelopeBase();
    const signed = await signEnvelope(base, privateKey);
    const tampered: PointerEnvelope = { ...signed, sig: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
    const result = await verifyEnvelope(tampered);
    expect(result).toBe(false);
  });

  it('returns false when the cid field is tampered with', async () => {
    const base = makeEnvelopeBase();
    const signed = await signEnvelope(base, privateKey);
    const tampered: PointerEnvelope = { ...signed, cid: 'bafybeihacked' };
    const result = await verifyEnvelope(tampered);
    expect(result).toBe(false);
  });

  it('returns false when the seq field is tampered with', async () => {
    const base = makeEnvelopeBase();
    const signed = await signEnvelope(base, privateKey);
    const tampered: PointerEnvelope = { ...signed, seq: signed.seq + 999 };
    const result = await verifyEnvelope(tampered);
    expect(result).toBe(false);
  });

  it('returns false for an invalid issuer string', async () => {
    const base = makeEnvelopeBase();
    const signed = await signEnvelope(base, privateKey);
    const tampered: PointerEnvelope = { ...signed, issuer: 'not-a-valid-peer-id' };
    const result = await verifyEnvelope(tampered);
    expect(result).toBe(false);
  });
});

// ---- validateEnvelope ----
describe('validateEnvelope()', () => {
  it('returns valid=true for a correctly signed, unexpired envelope', async () => {
    const base = makeEnvelopeBase();
    const signed = await signEnvelope(base, privateKey);
    const result = await validateEnvelope(signed);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns valid=false with reason "Expired" for an expired envelope', async () => {
    const base = makeEnvelopeBase({ expiresAt: Date.now() - 1 });
    const signed = await signEnvelope(base, privateKey);
    const result = await validateEnvelope(signed);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Expired');
  });

  it('returns valid=false with reason "Invalid schema" for wrong schema', async () => {
    const base = makeEnvelopeBase();
    const signed = await signEnvelope(base, privateKey);
    // Force wrong schema past TypeScript
    const bad = { ...signed, schema: 'nexus:pointer-envelope:v99' } as unknown as PointerEnvelope;
    const result = await validateEnvelope(bad);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Invalid schema');
  });

  it('returns valid=false with reason "Missing issuer" when issuer is empty', async () => {
    const base = makeEnvelopeBase();
    const signed = await signEnvelope(base, privateKey);
    const bad = { ...signed, issuer: '' } as PointerEnvelope;
    const result = await validateEnvelope(bad);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Missing issuer');
  });

  it('returns valid=false with reason "Invalid seq" for negative seq', async () => {
    const base = makeEnvelopeBase({ seq: -1 });
    const signed = await signEnvelope(base, privateKey);
    const result = await validateEnvelope(signed);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Invalid seq');
  });

  it('returns valid=false with reason "Missing issuedAt" when issuedAt is missing', async () => {
    const base = makeEnvelopeBase();
    const signed = await signEnvelope(base, privateKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...signed } as any;
    delete bad.issuedAt;
    const result = await validateEnvelope(bad as PointerEnvelope);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Missing issuedAt');
  });

  it('returns valid=false with reason "Invalid signature" for a tampered envelope', async () => {
    const base = makeEnvelopeBase();
    const signed = await signEnvelope(base, privateKey);
    const tampered: PointerEnvelope = { ...signed, cid: 'bafybeihacked' };
    const result = await validateEnvelope(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Invalid signature');
  });
});

// ---- supersedes ----
describe('supersedes()', () => {
  it('returns true when newer has higher seq than older', async () => {
    const base = makeEnvelopeBase({ seq: 1 });
    const older = await signEnvelope(base, privateKey);
    const newer = await signEnvelope({ ...base, seq: 2 }, privateKey);
    expect(supersedes(newer, older)).toBe(true);
  });

  it('returns false when newer has lower seq than older', async () => {
    const base = makeEnvelopeBase({ seq: 5 });
    const older = await signEnvelope(base, privateKey);
    const newer = await signEnvelope({ ...base, seq: 3 }, privateKey);
    expect(supersedes(newer, older)).toBe(false);
  });

  it('returns false when newer has same seq as older', async () => {
    const base = makeEnvelopeBase({ seq: 3 });
    const older = await signEnvelope(base, privateKey);
    const newer = await signEnvelope({ ...base, seq: 3 }, privateKey);
    expect(supersedes(newer, older)).toBe(false);
  });

  it('returns false when issuers differ', async () => {
    const otherKey = await generateKeyPair('Ed25519');
    const otherPeerId = peerIdFromPrivateKey(otherKey).toString();
    const olderBase = makeEnvelopeBase({ seq: 1 });
    const newerBase: Omit<PointerEnvelope, 'sig'> = { ...olderBase, issuer: otherPeerId, seq: 2 };
    const older = await signEnvelope(olderBase, privateKey);
    const newer = await signEnvelope(newerBase, otherKey);
    expect(supersedes(newer, older)).toBe(false);
  });

  it('returns false when kinds differ', async () => {
    const olderBase = makeEnvelopeBase({ kind: 'profile-pointer', seq: 1 });
    const newerBase = makeEnvelopeBase({ kind: 'room-pointer', seq: 2 });
    const older = await signEnvelope(olderBase, privateKey);
    const newer = await signEnvelope(newerBase, privateKey);
    expect(supersedes(newer, older)).toBe(false);
  });
});
