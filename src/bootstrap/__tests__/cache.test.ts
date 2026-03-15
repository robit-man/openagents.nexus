/**
 * Tests for src/bootstrap/cache.ts
 *
 * Covers savePeerCache, loadPeerCache round-trip, expiry, missing file,
 * and MAX_CACHED_PEERS cap.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { savePeerCache, loadPeerCache } from '../cache.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cache-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const SAMPLE_PEERS = [
  '/ip4/1.2.3.4/tcp/4001/p2p/QmPeer1',
  '/ip4/5.6.7.8/tcp/4001/p2p/QmPeer2',
  '/ip4/9.10.11.12/tcp/4001/p2p/QmPeer3',
];

// ---------------------------------------------------------------------------
// savePeerCache / loadPeerCache round-trip
// ---------------------------------------------------------------------------

describe('savePeerCache and loadPeerCache', () => {
  it('saves and loads the same peers', () => {
    savePeerCache(tmpDir, SAMPLE_PEERS);
    const loaded = loadPeerCache(tmpDir);
    expect(loaded).toEqual(SAMPLE_PEERS);
  });

  it('returns an empty array when the cache file does not exist', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-empty-'));
    try {
      const loaded = loadPeerCache(emptyDir);
      expect(loaded).toEqual([]);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('overwrites a previous cache with a new save', () => {
    savePeerCache(tmpDir, SAMPLE_PEERS);
    const newPeers = ['/ip4/99.99.99.99/tcp/4001/p2p/QmNew'];
    savePeerCache(tmpDir, newPeers);
    const loaded = loadPeerCache(tmpDir);
    expect(loaded).toEqual(newPeers);
  });

  it('creates the directory if it does not exist', () => {
    const subDir = path.join(tmpDir, 'nested', 'cache');
    savePeerCache(subDir, SAMPLE_PEERS);
    const loaded = loadPeerCache(subDir);
    expect(loaded).toEqual(SAMPLE_PEERS);
  });

  it('saves an empty peer list', () => {
    savePeerCache(tmpDir, []);
    const loaded = loadPeerCache(tmpDir);
    expect(loaded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MAX_CACHED_PEERS cap (50)
// ---------------------------------------------------------------------------

describe('MAX_CACHED_PEERS cap', () => {
  it('caps stored peers at 50', () => {
    const many = Array.from({ length: 100 }, (_, i) => `/ip4/1.1.1.${i}/tcp/4001/p2p/QmPeer${i}`);
    savePeerCache(tmpDir, many);
    const loaded = loadPeerCache(tmpDir);
    expect(loaded.length).toBeLessThanOrEqual(50);
  });

  it('keeps the first 50 peers when more are supplied', () => {
    const many = Array.from({ length: 60 }, (_, i) => `/ip4/1.1.1.${i}/tcp/4001/p2p/QmPeer${i}`);
    savePeerCache(tmpDir, many);
    const loaded = loadPeerCache(tmpDir);
    expect(loaded).toEqual(many.slice(0, 50));
  });
});

// ---------------------------------------------------------------------------
// Expired cache (>7 days)
// ---------------------------------------------------------------------------

describe('cache expiry', () => {
  it('returns empty array for a cache older than 7 days', () => {
    savePeerCache(tmpDir, SAMPLE_PEERS);
    // Tamper the updatedAt to be 8 days ago
    const cacheFile = path.join(tmpDir, 'nexus-peer-cache.json');
    const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    raw.updatedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    fs.writeFileSync(cacheFile, JSON.stringify(raw));

    const loaded = loadPeerCache(tmpDir);
    expect(loaded).toEqual([]);
  });

  it('returns peers for a cache exactly 6 days old', () => {
    savePeerCache(tmpDir, SAMPLE_PEERS);
    const cacheFile = path.join(tmpDir, 'nexus-peer-cache.json');
    const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    raw.updatedAt = Date.now() - 6 * 24 * 60 * 60 * 1000;
    fs.writeFileSync(cacheFile, JSON.stringify(raw));

    const loaded = loadPeerCache(tmpDir);
    expect(loaded).toEqual(SAMPLE_PEERS);
  });
});

// ---------------------------------------------------------------------------
// Corrupted cache file
// ---------------------------------------------------------------------------

describe('corrupted cache file', () => {
  it('returns empty array when the cache file contains invalid JSON', () => {
    const cacheFile = path.join(tmpDir, 'nexus-peer-cache.json');
    fs.writeFileSync(cacheFile, 'not valid json }{');
    expect(loadPeerCache(tmpDir)).toEqual([]);
  });

  it('does not throw when save fails on a read-only directory', () => {
    // Skip on environments where chmod doesn't restrict root
    const roDir = path.join(tmpDir, 'readonly');
    fs.mkdirSync(roDir);
    fs.chmodSync(roDir, 0o444);
    // savePeerCache should swallow the error gracefully
    expect(() => savePeerCache(roDir, SAMPLE_PEERS)).not.toThrow();
    fs.chmodSync(roDir, 0o755); // restore for cleanup
  });
});
