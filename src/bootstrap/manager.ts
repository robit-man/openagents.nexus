/**
 * Multi-source bootstrap manager.
 *
 * Resolves a prioritised list of BootstrapSources into a deduplicated set
 * of peer multiaddrs. Sources are processed in order; duplicates across
 * sources are collapsed automatically.
 *
 * Source types:
 *   cache    — disk-persisted peers from the previous session (fastest)
 *   static   — operator-supplied peer list (no network needed)
 *   manifest — signed JSON manifest fetched from one or more HTTP mirrors
 *   http     — plain JSON bootstrap endpoint (current signaling server format)
 *   public   — hardcoded Protocol Labs / IPFS bootstrap nodes (always available)
 *   mdns     — handled directly by libp2p, not by this manager
 */

import { loadPeerCache, savePeerCache } from './cache.js';
import {
  validateManifestStructure,
  isManifestExpired,
  extractPeersFromManifest,
  type BootstrapManifest,
} from './manifest.js';
import {
  PUBLIC_BOOTSTRAP_WSS,
  PUBLIC_BOOTSTRAP_DNSADDR,
  PUBLIC_BOOTSTRAP_TCP,
} from '../discovery.js';
import { createLogger } from '../logger.js';

const log = createLogger('bootstrap:manager');

// Re-export savePeerCache so callers can persist peers without importing cache directly
export { savePeerCache };

export type BootstrapSource =
  | { type: 'cache'; path: string }
  | { type: 'static'; peers: string[] }
  | { type: 'manifest'; urls: string[] }
  | { type: 'http'; urls: string[] }
  | { type: 'public' }
  | { type: 'mdns' };

export interface BootstrapResult {
  peers: string[];
  sources: string[]; // which sources contributed
}

/**
 * Fetch a signed manifest from a URL and extract its peer multiaddrs.
 * Returns an empty array on any failure or if the manifest is invalid/expired.
 */
async function fetchManifest(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return [];
    const manifest: unknown = await res.json();
    if (!validateManifestStructure(manifest)) return [];
    if (isManifestExpired(manifest as BootstrapManifest)) {
      log.debug(`Manifest from ${url} is expired`);
      return [];
    }
    return extractPeersFromManifest(manifest as BootstrapManifest);
  } catch (err) {
    log.debug(`Failed to fetch manifest from ${url}: ${err}`);
    return [];
  }
}

/**
 * Fetch peers from a plain HTTP bootstrap endpoint.
 * Expects a JSON object with a `peers` array of multiaddr strings.
 * Returns an empty array on any failure.
 */
async function fetchHttpBootstrap(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return [];
    const data = await res.json() as Record<string, unknown>;
    const peers = data['peers'];
    return Array.isArray(peers) ? peers as string[] : [];
  } catch {
    return [];
  }
}

/**
 * Resolve all bootstrap sources into a deduplicated peer list.
 *
 * Sources are processed in iteration order. Each source that contributes at
 * least one peer is recorded in BootstrapResult.sources.
 */
export async function resolveBootstrap(sources: BootstrapSource[]): Promise<BootstrapResult> {
  const allPeers = new Set<string>();
  const contributedSources: string[] = [];

  for (const source of sources) {
    let peers: string[] = [];

    switch (source.type) {
      case 'cache':
        peers = loadPeerCache(source.path);
        if (peers.length > 0) contributedSources.push('cache');
        break;

      case 'static':
        peers = source.peers;
        if (peers.length > 0) contributedSources.push('static');
        break;

      case 'manifest':
        for (const url of source.urls) {
          const mp = await fetchManifest(url);
          if (mp.length > 0) {
            peers.push(...mp);
            contributedSources.push(`manifest:${url}`);
          }
        }
        break;

      case 'http':
        for (const url of source.urls) {
          const hp = await fetchHttpBootstrap(url);
          if (hp.length > 0) {
            peers.push(...hp);
            contributedSources.push(`http:${url}`);
          }
        }
        break;

      case 'public':
        peers = [...PUBLIC_BOOTSTRAP_WSS, ...PUBLIC_BOOTSTRAP_DNSADDR, ...PUBLIC_BOOTSTRAP_TCP];
        contributedSources.push('public');
        break;

      case 'mdns':
        // mDNS is handled by libp2p directly, not here
        break;
    }

    for (const p of peers) allPeers.add(p);
  }

  log.info(
    `Bootstrap resolved ${allPeers.size} peers from [${contributedSources.join(', ')}]`,
  );
  return { peers: Array.from(allPeers), sources: contributedSources };
}

/**
 * Build the recommended ordered source list for a given configuration.
 *
 * Order (each entry is only added when its prerequisite is non-empty/set):
 *   1. cache    — fastest, no network
 *   2. static   — operator-supplied peers
 *   3. manifest — signed mirrors
 *   4. http     — signaling server
 *   5. public   — always present as final fallback
 */
export function defaultBootstrapSources(config: {
  cachePath?: string;
  signalingServer?: string;
  customPeers?: string[];
  manifestUrls?: string[];
}): BootstrapSource[] {
  const sources: BootstrapSource[] = [];

  // 1. Cache first (fastest, no network needed)
  if (config.cachePath) {
    sources.push({ type: 'cache', path: config.cachePath });
  }

  // 2. Custom static peers
  if (config.customPeers && config.customPeers.length > 0) {
    sources.push({ type: 'static', peers: config.customPeers });
  }

  // 3. Signed manifests from mirrors
  if (config.manifestUrls && config.manifestUrls.length > 0) {
    sources.push({ type: 'manifest', urls: config.manifestUrls });
  }

  // 4. HTTP bootstrap (signaling server)
  if (config.signalingServer) {
    sources.push({ type: 'http', urls: [`${config.signalingServer}/api/v1/bootstrap`] });
  }

  // 5. Public bootstrap nodes (always available as fallback)
  sources.push({ type: 'public' });

  return sources;
}
