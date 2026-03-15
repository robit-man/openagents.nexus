/**
 * Tests for src/bootstrap/manager.ts
 *
 * Covers defaultBootstrapSources, resolveBootstrap with various source types,
 * deduplication, and fallback to public nodes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveBootstrap, defaultBootstrapSources, type BootstrapSource } from '../manager.js';
import { savePeerCache } from '../cache.js';
import {
  PUBLIC_BOOTSTRAP_WSS,
  PUBLIC_BOOTSTRAP_DNSADDR,
  PUBLIC_BOOTSTRAP_TCP,
} from '../../discovery.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-manager-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const ALL_PUBLIC = [...PUBLIC_BOOTSTRAP_WSS, ...PUBLIC_BOOTSTRAP_DNSADDR, ...PUBLIC_BOOTSTRAP_TCP];

// ---------------------------------------------------------------------------
// defaultBootstrapSources
// ---------------------------------------------------------------------------

describe('defaultBootstrapSources', () => {
  it('always includes the public source as the last entry', () => {
    const sources = defaultBootstrapSources({});
    const last = sources[sources.length - 1];
    expect(last).toEqual({ type: 'public' });
  });

  it('adds cache source first when cachePath is provided', () => {
    const sources = defaultBootstrapSources({ cachePath: '/tmp/cache' });
    expect(sources[0]).toEqual({ type: 'cache', path: '/tmp/cache' });
  });

  it('adds static source when customPeers are provided', () => {
    const customPeers = ['/ip4/1.2.3.4/tcp/4001/p2p/QmCustom'];
    const sources = defaultBootstrapSources({ customPeers });
    const staticSource = sources.find(s => s.type === 'static') as Extract<BootstrapSource, { type: 'static' }> | undefined;
    expect(staticSource).toBeDefined();
    expect(staticSource!.peers).toEqual(customPeers);
  });

  it('does not add static source when customPeers is empty', () => {
    const sources = defaultBootstrapSources({ customPeers: [] });
    expect(sources.some(s => s.type === 'static')).toBe(false);
  });

  it('adds manifest source when manifestUrls are provided', () => {
    const manifestUrls = ['https://example.com/bootstrap.json'];
    const sources = defaultBootstrapSources({ manifestUrls });
    const manifestSource = sources.find(s => s.type === 'manifest') as Extract<BootstrapSource, { type: 'manifest' }> | undefined;
    expect(manifestSource).toBeDefined();
    expect(manifestSource!.urls).toEqual(manifestUrls);
  });

  it('adds http source when signalingServer is provided', () => {
    const sources = defaultBootstrapSources({ signalingServer: 'https://nexus.example.com' });
    const httpSource = sources.find(s => s.type === 'http') as Extract<BootstrapSource, { type: 'http' }> | undefined;
    expect(httpSource).toBeDefined();
    expect(httpSource!.urls[0]).toBe('https://nexus.example.com/api/v1/bootstrap');
  });

  it('does not add http source when signalingServer is absent', () => {
    const sources = defaultBootstrapSources({});
    expect(sources.some(s => s.type === 'http')).toBe(false);
  });

  it('produces correct order: cache → static → manifest → http → public', () => {
    const sources = defaultBootstrapSources({
      cachePath: tmpDir,
      customPeers: ['/ip4/1.1.1.1/tcp/4001/p2p/QmCustom'],
      manifestUrls: ['https://example.com/m.json'],
      signalingServer: 'https://nexus.example.com',
    });
    const types = sources.map(s => s.type);
    expect(types).toEqual(['cache', 'static', 'manifest', 'http', 'public']);
  });

  it('produces only public source when no options provided', () => {
    const sources = defaultBootstrapSources({});
    expect(sources).toHaveLength(1);
    expect(sources[0]).toEqual({ type: 'public' });
  });
});

// ---------------------------------------------------------------------------
// resolveBootstrap — static source
// ---------------------------------------------------------------------------

describe('resolveBootstrap with static source', () => {
  it('returns the provided static peers', async () => {
    const peers = ['/ip4/1.2.3.4/tcp/4001/p2p/QmA', '/ip4/5.6.7.8/tcp/4001/p2p/QmB'];
    const result = await resolveBootstrap([{ type: 'static', peers }]);
    for (const p of peers) {
      expect(result.peers).toContain(p);
    }
  });

  it('records static as a contributing source', async () => {
    const result = await resolveBootstrap([{ type: 'static', peers: ['/ip4/1.2.3.4/tcp/4001/p2p/QmA'] }]);
    expect(result.sources).toContain('static');
  });

  it('does not add static to sources when peers array is empty', async () => {
    const result = await resolveBootstrap([{ type: 'static', peers: [] }]);
    expect(result.sources).not.toContain('static');
  });
});

// ---------------------------------------------------------------------------
// resolveBootstrap — cache source
// ---------------------------------------------------------------------------

describe('resolveBootstrap with cache source', () => {
  it('returns peers from the disk cache', async () => {
    const cachedPeers = ['/ip4/10.0.0.1/tcp/4001/p2p/QmCached'];
    savePeerCache(tmpDir, cachedPeers);

    const result = await resolveBootstrap([{ type: 'cache', path: tmpDir }]);
    expect(result.peers).toContain(cachedPeers[0]);
    expect(result.sources).toContain('cache');
  });

  it('does not add cache to sources when cache is empty', async () => {
    const result = await resolveBootstrap([{ type: 'cache', path: tmpDir }]);
    expect(result.sources).not.toContain('cache');
  });
});

// ---------------------------------------------------------------------------
// resolveBootstrap — public source
// ---------------------------------------------------------------------------

describe('resolveBootstrap with public source', () => {
  it('returns all public bootstrap nodes', async () => {
    const result = await resolveBootstrap([{ type: 'public' }]);
    for (const p of ALL_PUBLIC) {
      expect(result.peers).toContain(p);
    }
  });

  it('records public as a contributing source', async () => {
    const result = await resolveBootstrap([{ type: 'public' }]);
    expect(result.sources).toContain('public');
  });

  it('returns public peers even when no other sources are given', async () => {
    const result = await resolveBootstrap([{ type: 'public' }]);
    expect(result.peers.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// resolveBootstrap — deduplication
// ---------------------------------------------------------------------------

describe('resolveBootstrap deduplication', () => {
  it('deduplicates identical peers from multiple sources', async () => {
    const sharedPeer = '/ip4/1.2.3.4/tcp/4001/p2p/QmShared';
    const sources: BootstrapSource[] = [
      { type: 'static', peers: [sharedPeer] },
      { type: 'static', peers: [sharedPeer] },
    ];
    const result = await resolveBootstrap(sources);
    expect(result.peers.filter(p => p === sharedPeer)).toHaveLength(1);
  });

  it('deduplicates public peers that also appear as static peers', async () => {
    const publicPeer = PUBLIC_BOOTSTRAP_WSS[0];
    const sources: BootstrapSource[] = [
      { type: 'static', peers: [publicPeer] },
      { type: 'public' },
    ];
    const result = await resolveBootstrap(sources);
    expect(result.peers.filter(p => p === publicPeer)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// resolveBootstrap — empty sources still returns public peers via defaultBootstrapSources
// ---------------------------------------------------------------------------

describe('resolveBootstrap fallback behavior', () => {
  it('returns an empty peers array when passed an empty sources list', async () => {
    const result = await resolveBootstrap([]);
    expect(result.peers).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  it('defaultBootstrapSources always has public as last source ensuring non-empty result', async () => {
    const sources = defaultBootstrapSources({});
    const result = await resolveBootstrap(sources);
    expect(result.peers.length).toBeGreaterThan(0);
    expect(result.sources).toContain('public');
  });
});

// ---------------------------------------------------------------------------
// resolveBootstrap — manifest source (mocked fetch)
// ---------------------------------------------------------------------------

describe('resolveBootstrap with manifest source', () => {
  it('extracts peers from a valid non-expired manifest', async () => {
    const mockManifest = {
      schema: 'nexus:bootstrap-manifest:v1',
      version: 1,
      seq: 1,
      issuedAt: Date.now() - 1000,
      expiresAt: Date.now() + 3_600_000,
      networkId: 'nexus:mainnet',
      seeds: [
        { peerId: 'QmA', addrs: ['/ip4/10.0.0.1/tcp/4001/p2p/QmA'], roles: ['bootstrap'] },
      ],
      signers: [],
      signatures: [],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockManifest,
    }));

    const result = await resolveBootstrap([{
      type: 'manifest',
      urls: ['https://example.com/bootstrap.json'],
    }]);

    expect(result.peers).toContain('/ip4/10.0.0.1/tcp/4001/p2p/QmA');
    expect(result.sources.some(s => s.startsWith('manifest:'))).toBe(true);
  });

  it('ignores an expired manifest', async () => {
    const expiredManifest = {
      schema: 'nexus:bootstrap-manifest:v1',
      version: 1,
      seq: 1,
      issuedAt: Date.now() - 7_200_000,
      expiresAt: Date.now() - 3_600_000, // already expired
      networkId: 'nexus:mainnet',
      seeds: [
        { peerId: 'QmExpired', addrs: ['/ip4/1.2.3.4/tcp/4001/p2p/QmExpired'], roles: ['bootstrap'] },
      ],
      signers: [],
      signatures: [],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => expiredManifest,
    }));

    const result = await resolveBootstrap([{
      type: 'manifest',
      urls: ['https://example.com/bootstrap.json'],
    }]);

    expect(result.peers).not.toContain('/ip4/1.2.3.4/tcp/4001/p2p/QmExpired');
  });

  it('handles fetch errors gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const result = await resolveBootstrap([{
      type: 'manifest',
      urls: ['https://unreachable.example.com/bootstrap.json'],
    }]);

    expect(result.peers).toEqual([]);
  });

  it('handles non-ok HTTP responses gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));

    const result = await resolveBootstrap([{
      type: 'manifest',
      urls: ['https://example.com/missing.json'],
    }]);

    expect(result.peers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveBootstrap — http source (mocked fetch)
// ---------------------------------------------------------------------------

describe('resolveBootstrap with http source', () => {
  it('extracts peers from a successful HTTP bootstrap response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ peers: ['/ip4/5.6.7.8/tcp/4001/p2p/QmHttp'] }),
    }));

    const result = await resolveBootstrap([{
      type: 'http',
      urls: ['https://nexus.example.com/api/v1/bootstrap'],
    }]);

    expect(result.peers).toContain('/ip4/5.6.7.8/tcp/4001/p2p/QmHttp');
    expect(result.sources.some(s => s.startsWith('http:'))).toBe(true);
  });

  it('handles HTTP fetch errors gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

    const result = await resolveBootstrap([{
      type: 'http',
      urls: ['https://unreachable.example.com/api/v1/bootstrap'],
    }]);

    expect(result.peers).toEqual([]);
  });

  it('returns empty when response has no peers field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));

    const result = await resolveBootstrap([{
      type: 'http',
      urls: ['https://example.com/api/v1/bootstrap'],
    }]);

    expect(result.peers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveBootstrap — mdns source (noop)
// ---------------------------------------------------------------------------

describe('resolveBootstrap with mdns source', () => {
  it('does not throw and contributes no peers (mDNS handled by libp2p)', async () => {
    const result = await resolveBootstrap([{ type: 'mdns' }]);
    expect(result.peers).toEqual([]);
    expect(result.sources).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveBootstrap — combined sources
// ---------------------------------------------------------------------------

describe('resolveBootstrap with all sources combined', () => {
  it('merges peers from cache, static, and public', async () => {
    const cachedPeers = ['/ip4/10.0.0.99/tcp/4001/p2p/QmCachedCombined'];
    savePeerCache(tmpDir, cachedPeers);

    const staticPeers = ['/ip4/192.168.1.1/tcp/4001/p2p/QmStatic'];

    const result = await resolveBootstrap([
      { type: 'cache', path: tmpDir },
      { type: 'static', peers: staticPeers },
      { type: 'public' },
    ]);

    expect(result.peers).toContain(cachedPeers[0]);
    expect(result.peers).toContain(staticPeers[0]);
    for (const p of ALL_PUBLIC) {
      expect(result.peers).toContain(p);
    }
  });
});
