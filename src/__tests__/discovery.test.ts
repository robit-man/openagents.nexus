/**
 * Discovery cascade tests
 *
 * Covers all bootstrap arrays, discovery topics, config defaults,
 * resolveDiscovery, buildBootstrapList, and getDiscoveryTopics.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DISCOVERY,
  NEXUS_DISCOVERY_TOPIC,
  NEXUS_DISCOVERY_TOPICS,
  PUBLIC_BOOTSTRAP_WSS,
  PUBLIC_BOOTSTRAP_DNSADDR,
  PUBLIC_BOOTSTRAP_TCP,
  ALL_PUBLIC_BOOTSTRAP,
  resolveDiscovery,
  buildBootstrapList,
  getDiscoveryTopics,
  type DiscoveryConfig,
} from '../discovery.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('NEXUS_DISCOVERY_TOPIC', () => {
  it('is the expected primary discovery topic', () => {
    expect(NEXUS_DISCOVERY_TOPIC).toBe('_nexus._peer-discovery._p2p._pubsub');
  });
});

describe('NEXUS_DISCOVERY_TOPICS', () => {
  it('contains at least 3 redundant topics', () => {
    expect(NEXUS_DISCOVERY_TOPICS.length).toBeGreaterThanOrEqual(3);
  });

  it('includes the primary discovery topic', () => {
    expect(NEXUS_DISCOVERY_TOPICS).toContain(NEXUS_DISCOVERY_TOPIC);
  });

  it('all topics are non-empty strings', () => {
    for (const topic of NEXUS_DISCOVERY_TOPICS) {
      expect(typeof topic).toBe('string');
      expect(topic.length).toBeGreaterThan(0);
    }
  });

  it('all topics are unique', () => {
    expect(new Set(NEXUS_DISCOVERY_TOPICS).size).toBe(NEXUS_DISCOVERY_TOPICS.length);
  });
});

describe('PUBLIC_BOOTSTRAP_WSS', () => {
  it('has at least 8 nodes for geographic redundancy', () => {
    expect(PUBLIC_BOOTSTRAP_WSS.length).toBeGreaterThanOrEqual(8);
  });

  it('every entry starts with /dns4/', () => {
    for (const addr of PUBLIC_BOOTSTRAP_WSS) {
      expect(addr).toMatch(/^\/dns4\//);
    }
  });

  it('every entry contains /wss/', () => {
    for (const addr of PUBLIC_BOOTSTRAP_WSS) {
      expect(addr).toContain('/wss/');
    }
  });

  it('every entry contains a peer ID', () => {
    for (const addr of PUBLIC_BOOTSTRAP_WSS) {
      expect(addr).toMatch(/\/p2p\/Qm[a-zA-Z0-9]+/);
    }
  });
});

describe('PUBLIC_BOOTSTRAP_DNSADDR', () => {
  it('has at least 3 dnsaddr entries', () => {
    expect(PUBLIC_BOOTSTRAP_DNSADDR.length).toBeGreaterThanOrEqual(3);
  });

  it('every entry starts with /dnsaddr/', () => {
    for (const addr of PUBLIC_BOOTSTRAP_DNSADDR) {
      expect(addr).toMatch(/^\/dnsaddr\//);
    }
  });

  it('every entry uses bootstrap.libp2p.io', () => {
    for (const addr of PUBLIC_BOOTSTRAP_DNSADDR) {
      expect(addr).toContain('bootstrap.libp2p.io');
    }
  });
});

describe('PUBLIC_BOOTSTRAP_TCP', () => {
  it('has at least 1 TCP entry', () => {
    expect(PUBLIC_BOOTSTRAP_TCP.length).toBeGreaterThanOrEqual(1);
  });

  it('entries contain /tcp/ and /p2p/', () => {
    for (const addr of PUBLIC_BOOTSTRAP_TCP) {
      expect(addr).toContain('/tcp/');
      expect(addr).toContain('/p2p/');
    }
  });
});

describe('ALL_PUBLIC_BOOTSTRAP', () => {
  it('combines all bootstrap arrays', () => {
    const expected = PUBLIC_BOOTSTRAP_WSS.length + PUBLIC_BOOTSTRAP_DNSADDR.length + PUBLIC_BOOTSTRAP_TCP.length;
    expect(ALL_PUBLIC_BOOTSTRAP.length).toBe(expected);
  });

  it('includes entries from all three sources', () => {
    expect(ALL_PUBLIC_BOOTSTRAP).toContain(PUBLIC_BOOTSTRAP_WSS[0]);
    expect(ALL_PUBLIC_BOOTSTRAP).toContain(PUBLIC_BOOTSTRAP_DNSADDR[0]);
    expect(ALL_PUBLIC_BOOTSTRAP).toContain(PUBLIC_BOOTSTRAP_TCP[0]);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_DISCOVERY
// ---------------------------------------------------------------------------

describe('DEFAULT_DISCOVERY', () => {
  it('enables all discovery methods by default', () => {
    expect(DEFAULT_DISCOVERY.usePublicBootstrap).toBe(true);
    expect(DEFAULT_DISCOVERY.enableCircuitRelay).toBe(true);
    expect(DEFAULT_DISCOVERY.enablePubsubDiscovery).toBe(true);
    expect(DEFAULT_DISCOVERY.enableMdns).toBe(true);
    expect(DEFAULT_DISCOVERY.useDnsaddr).toBe(true);
    expect(DEFAULT_DISCOVERY.useTcpBootstrap).toBe(true);
  });

  it('has empty custom bootstrap peers', () => {
    expect(DEFAULT_DISCOVERY.customBootstrapPeers).toEqual([]);
  });

  it('has a reasonable pubsub discovery interval', () => {
    expect(DEFAULT_DISCOVERY.pubsubDiscoveryIntervalMs).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// resolveDiscovery
// ---------------------------------------------------------------------------

describe('resolveDiscovery', () => {
  it('returns defaults with no arguments', () => {
    expect(resolveDiscovery()).toEqual(DEFAULT_DISCOVERY);
  });

  it('overrides individual fields', () => {
    const config = resolveDiscovery({ usePublicBootstrap: false, useDnsaddr: false });
    expect(config.usePublicBootstrap).toBe(false);
    expect(config.useDnsaddr).toBe(false);
    expect(config.enableCircuitRelay).toBe(true);
  });

  it('does not mutate DEFAULT_DISCOVERY', () => {
    resolveDiscovery({ usePublicBootstrap: false });
    expect(DEFAULT_DISCOVERY.usePublicBootstrap).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildBootstrapList
// ---------------------------------------------------------------------------

describe('buildBootstrapList', () => {
  const fullConfig = resolveDiscovery();

  it('includes WSS, dnsaddr, and TCP bootstrap nodes by default', () => {
    const list = buildBootstrapList(fullConfig);
    expect(list.length).toBeGreaterThanOrEqual(
      PUBLIC_BOOTSTRAP_WSS.length + PUBLIC_BOOTSTRAP_DNSADDR.length + PUBLIC_BOOTSTRAP_TCP.length
    );
  });

  it('excludes dnsaddr when useDnsaddr is false', () => {
    const config = resolveDiscovery({ useDnsaddr: false });
    const list = buildBootstrapList(config);
    for (const addr of PUBLIC_BOOTSTRAP_DNSADDR) {
      expect(list).not.toContain(addr);
    }
  });

  it('excludes TCP when useTcpBootstrap is false', () => {
    const config = resolveDiscovery({ useTcpBootstrap: false });
    const list = buildBootstrapList(config);
    for (const addr of PUBLIC_BOOTSTRAP_TCP) {
      expect(list).not.toContain(addr);
    }
  });

  it('includes signaling peers first', () => {
    const sigPeers = ['/ip4/1.2.3.4/tcp/4001/p2p/QmSig'];
    const list = buildBootstrapList(fullConfig, sigPeers);
    expect(list).toContain(sigPeers[0]);
  });

  it('deduplicates across all sources', () => {
    const dup = PUBLIC_BOOTSTRAP_WSS[0];
    const config = resolveDiscovery({ customBootstrapPeers: [dup] });
    const list = buildBootstrapList(config, [dup]);
    expect(list.filter(p => p === dup)).toHaveLength(1);
  });

  it('returns empty for fully disabled config', () => {
    const config = resolveDiscovery({
      usePublicBootstrap: false,
      useDnsaddr: false,
      useTcpBootstrap: false,
      customBootstrapPeers: [],
    });
    expect(buildBootstrapList(config, [])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getDiscoveryTopics
// ---------------------------------------------------------------------------

describe('getDiscoveryTopics', () => {
  it('returns all discovery topics', () => {
    const topics = getDiscoveryTopics();
    expect(topics).toEqual(NEXUS_DISCOVERY_TOPICS);
  });

  it('returns a copy (not the original array)', () => {
    const topics = getDiscoveryTopics();
    topics.push('modified');
    expect(getDiscoveryTopics()).toEqual(NEXUS_DISCOVERY_TOPICS);
  });
});
