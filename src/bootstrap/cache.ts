/**
 * Disk-backed peer cache.
 *
 * Persists bootstrap peer multiaddrs so returning agents can bootstrap
 * without network contact on the first attempt.
 *
 * Cache lifetime: 7 days — older entries are silently discarded.
 * Cap: MAX_CACHED_PEERS entries per file (oldest are dropped by slice).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('bootstrap:cache');

const CACHE_FILE = 'nexus-peer-cache.json';
const MAX_CACHED_PEERS = 50;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface PeerCache {
  updatedAt: number;
  peers: string[]; // multiaddrs
}

/**
 * Persist a list of peer multiaddrs to disk.
 * Silently swallows any I/O error so bootstrap failures are non-fatal.
 */
export function savePeerCache(cachePath: string, peers: string[]): void {
  const filePath = path.join(cachePath, CACHE_FILE);
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const cache: PeerCache = {
      updatedAt: Date.now(),
      peers: peers.slice(0, MAX_CACHED_PEERS),
    };
    fs.writeFileSync(filePath, JSON.stringify(cache), 'utf-8');
    log.debug(`Cached ${cache.peers.length} peers to ${filePath}`);
  } catch (err) {
    log.debug(`Failed to save peer cache: ${err}`);
  }
}

/**
 * Load cached peer multiaddrs from disk.
 * Returns an empty array on any error or when the cache is absent or expired.
 */
export function loadPeerCache(cachePath: string): string[] {
  const filePath = path.join(cachePath, CACHE_FILE);
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const cache: PeerCache = JSON.parse(raw);
    if (Date.now() - cache.updatedAt > CACHE_TTL_MS) {
      log.debug('Peer cache expired (>7 days old)');
      return [];
    }
    log.debug(`Loaded ${cache.peers.length} cached peers`);
    return cache.peers;
  } catch (err) {
    log.debug(`Failed to load peer cache: ${err}`);
    return [];
  }
}
