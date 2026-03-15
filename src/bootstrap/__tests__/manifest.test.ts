/**
 * Tests for src/bootstrap/manifest.ts
 *
 * Covers validateManifestStructure, isManifestExpired, extractPeersFromManifest.
 */

import { describe, it, expect } from 'vitest';
import {
  validateManifestStructure,
  isManifestExpired,
  extractPeersFromManifest,
  type BootstrapManifest,
  type BootstrapSeed,
} from '../manifest.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<BootstrapManifest> = {}): BootstrapManifest {
  return {
    schema: 'nexus:bootstrap-manifest:v1',
    version: 1,
    seq: 1,
    issuedAt: Date.now() - 1_000,
    expiresAt: Date.now() + 3_600_000, // 1 hour from now
    networkId: 'nexus:mainnet',
    seeds: [
      {
        peerId: 'QmFakePeer1',
        addrs: ['/ip4/1.2.3.4/tcp/4001/p2p/QmFakePeer1'],
        roles: ['bootstrap'],
      },
    ],
    signers: ['pubkey1'],
    signatures: [{ publicKey: 'pubkey1', sig: 'sig1' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateManifestStructure
// ---------------------------------------------------------------------------

describe('validateManifestStructure', () => {
  it('returns true for a valid manifest', () => {
    expect(validateManifestStructure(makeManifest())).toBe(true);
  });

  it('returns false for null', () => {
    expect(validateManifestStructure(null)).toBe(false);
  });

  it('returns false for a plain string', () => {
    expect(validateManifestStructure('not an object')).toBe(false);
  });

  it('returns false for an empty object', () => {
    expect(validateManifestStructure({})).toBe(false);
  });

  it('returns false when schema is wrong', () => {
    expect(validateManifestStructure({ ...makeManifest(), schema: 'wrong:schema' })).toBe(false);
  });

  it('returns false when seq is missing', () => {
    const m = makeManifest();
    const { seq: _seq, ...rest } = m;
    expect(validateManifestStructure(rest)).toBe(false);
  });

  it('returns false when seq is a string', () => {
    expect(validateManifestStructure({ ...makeManifest(), seq: '1' })).toBe(false);
  });

  it('returns false when issuedAt is missing', () => {
    const m = makeManifest();
    const { issuedAt: _ia, ...rest } = m;
    expect(validateManifestStructure(rest)).toBe(false);
  });

  it('returns false when expiresAt is missing', () => {
    const m = makeManifest();
    const { expiresAt: _ea, ...rest } = m;
    expect(validateManifestStructure(rest)).toBe(false);
  });

  it('returns false when seeds is not an array', () => {
    expect(validateManifestStructure({ ...makeManifest(), seeds: 'not-array' })).toBe(false);
  });

  it('returns false when signatures is not an array', () => {
    expect(validateManifestStructure({ ...makeManifest(), signatures: 'not-array' })).toBe(false);
  });

  it('accepts a manifest with zero seeds', () => {
    expect(validateManifestStructure(makeManifest({ seeds: [] }))).toBe(true);
  });

  it('accepts a manifest with zero signatures', () => {
    expect(validateManifestStructure(makeManifest({ signatures: [] }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isManifestExpired
// ---------------------------------------------------------------------------

describe('isManifestExpired', () => {
  it('returns false for a manifest that expires in the future', () => {
    const m = makeManifest({ expiresAt: Date.now() + 60_000 });
    expect(isManifestExpired(m)).toBe(false);
  });

  it('returns true for a manifest whose expiresAt is in the past', () => {
    const m = makeManifest({ expiresAt: Date.now() - 1 });
    expect(isManifestExpired(m)).toBe(true);
  });

  it('returns true for a manifest that expired long ago', () => {
    const m = makeManifest({ expiresAt: 1_000_000 }); // epoch + 1000s
    expect(isManifestExpired(m)).toBe(true);
  });

  it('returns false for a manifest expiring very far in the future', () => {
    const m = makeManifest({ expiresAt: Date.now() + 365 * 24 * 3600 * 1000 });
    expect(isManifestExpired(m)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractPeersFromManifest
// ---------------------------------------------------------------------------

describe('extractPeersFromManifest', () => {
  it('returns an empty array for a manifest with no seeds', () => {
    const m = makeManifest({ seeds: [] });
    expect(extractPeersFromManifest(m)).toEqual([]);
  });

  it('returns all addrs from a single seed', () => {
    const m = makeManifest({
      seeds: [
        {
          peerId: 'QmA',
          addrs: ['/ip4/1.2.3.4/tcp/4001/p2p/QmA', '/ip4/1.2.3.4/tcp/4002/p2p/QmA'],
          roles: ['bootstrap'],
        },
      ],
    });
    expect(extractPeersFromManifest(m)).toEqual([
      '/ip4/1.2.3.4/tcp/4001/p2p/QmA',
      '/ip4/1.2.3.4/tcp/4002/p2p/QmA',
    ]);
  });

  it('flattens addrs from multiple seeds', () => {
    const seeds: BootstrapSeed[] = [
      { peerId: 'QmA', addrs: ['/ip4/1.1.1.1/tcp/4001/p2p/QmA'], roles: ['bootstrap'] },
      { peerId: 'QmB', addrs: ['/ip4/2.2.2.2/tcp/4001/p2p/QmB', '/ip4/2.2.2.2/tcp/4002/p2p/QmB'], roles: ['relay'] },
    ];
    const m = makeManifest({ seeds });
    expect(extractPeersFromManifest(m)).toEqual([
      '/ip4/1.1.1.1/tcp/4001/p2p/QmA',
      '/ip4/2.2.2.2/tcp/4001/p2p/QmB',
      '/ip4/2.2.2.2/tcp/4002/p2p/QmB',
    ]);
  });

  it('returns empty array when all seeds have empty addrs', () => {
    const m = makeManifest({
      seeds: [{ peerId: 'QmA', addrs: [], roles: ['bootstrap'] }],
    });
    expect(extractPeersFromManifest(m)).toEqual([]);
  });

  it('preserves the order of addrs across seeds', () => {
    const seeds: BootstrapSeed[] = [
      { peerId: 'QmFirst', addrs: ['/ip4/10.0.0.1/tcp/4001/p2p/QmFirst'], roles: ['bootstrap'] },
      { peerId: 'QmSecond', addrs: ['/ip4/10.0.0.2/tcp/4001/p2p/QmSecond'], roles: ['dht-server'] },
      { peerId: 'QmThird', addrs: ['/ip4/10.0.0.3/tcp/4001/p2p/QmThird'], roles: ['storage'] },
    ];
    const m = makeManifest({ seeds });
    const peers = extractPeersFromManifest(m);
    expect(peers[0]).toContain('QmFirst');
    expect(peers[1]).toContain('QmSecond');
    expect(peers[2]).toContain('QmThird');
  });
});
