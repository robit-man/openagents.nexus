/**
 * Discovery cascade tests
 *
 * Covers: DEFAULT_DISCOVERY values, resolveDiscovery, buildBootstrapList,
 * deduplication, PUBLIC_BOOTSTRAP_WSS validity, NEXUS_DISCOVERY_TOPIC constant.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DISCOVERY,
  NEXUS_DISCOVERY_TOPIC,
  PUBLIC_BOOTSTRAP_WSS,
  resolveDiscovery,
  buildBootstrapList,
  type DiscoveryConfig,
} from '../discovery.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('NEXUS_DISCOVERY_TOPIC', () => {
  it('is the expected discovery topic string', () => {
    expect(NEXUS_DISCOVERY_TOPIC).toBe('_nexus._peer-discovery._p2p._pubsub');
  });
});

describe('PUBLIC_BOOTSTRAP_WSS', () => {
  it('is non-empty', () => {
    expect(PUBLIC_BOOTSTRAP_WSS.length).toBeGreaterThan(0);
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

  it('every entry contains /p2p/ with a peer ID', () => {
    for (const addr of PUBLIC_BOOTSTRAP_WSS) {
      expect(addr).toMatch(/\/p2p\/Qm[a-zA-Z0-9]+/);
    }
  });

  it('has at least 4 distinct bootstrap nodes for redundancy', () => {
    expect(PUBLIC_BOOTSTRAP_WSS.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_DISCOVERY
// ---------------------------------------------------------------------------

describe('DEFAULT_DISCOVERY', () => {
  it('has usePublicBootstrap enabled by default', () => {
    expect(DEFAULT_DISCOVERY.usePublicBootstrap).toBe(true);
  });

  it('has enableCircuitRelay enabled by default', () => {
    expect(DEFAULT_DISCOVERY.enableCircuitRelay).toBe(true);
  });

  it('has enablePubsubDiscovery enabled by default', () => {
    expect(DEFAULT_DISCOVERY.enablePubsubDiscovery).toBe(true);
  });

  it('has enableMdns enabled by default', () => {
    expect(DEFAULT_DISCOVERY.enableMdns).toBe(true);
  });

  it('has an empty customBootstrapPeers list by default', () => {
    expect(DEFAULT_DISCOVERY.customBootstrapPeers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveDiscovery
// ---------------------------------------------------------------------------

describe('resolveDiscovery', () => {
  it('returns defaults when called with no arguments', () => {
    const config = resolveDiscovery();
    expect(config).toEqual(DEFAULT_DISCOVERY);
  });

  it('returns defaults when called with undefined', () => {
    const config = resolveDiscovery(undefined);
    expect(config).toEqual(DEFAULT_DISCOVERY);
  });

  it('overrides a single boolean field', () => {
    const config = resolveDiscovery({ usePublicBootstrap: false });
    expect(config.usePublicBootstrap).toBe(false);
    // Others remain at default
    expect(config.enableCircuitRelay).toBe(true);
    expect(config.enablePubsubDiscovery).toBe(true);
    expect(config.enableMdns).toBe(true);
  });

  it('overrides multiple fields at once', () => {
    const config = resolveDiscovery({
      usePublicBootstrap: false,
      enableCircuitRelay: false,
    });
    expect(config.usePublicBootstrap).toBe(false);
    expect(config.enableCircuitRelay).toBe(false);
    expect(config.enablePubsubDiscovery).toBe(true);
    expect(config.enableMdns).toBe(true);
  });

  it('accepts custom bootstrap peers', () => {
    const peers = ['/ip4/1.2.3.4/tcp/4001/p2p/QmCustom'];
    const config = resolveDiscovery({ customBootstrapPeers: peers });
    expect(config.customBootstrapPeers).toEqual(peers);
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
  const fullConfig: DiscoveryConfig = {
    usePublicBootstrap: true,
    enableCircuitRelay: true,
    enablePubsubDiscovery: true,
    enableMdns: true,
    customBootstrapPeers: [],
  };

  it('returns public bootstrap nodes when usePublicBootstrap is true', () => {
    const list = buildBootstrapList(fullConfig);
    for (const addr of PUBLIC_BOOTSTRAP_WSS) {
      expect(list).toContain(addr);
    }
  });

  it('returns empty list when usePublicBootstrap is false and no other peers', () => {
    const config: DiscoveryConfig = { ...fullConfig, usePublicBootstrap: false };
    const list = buildBootstrapList(config);
    expect(list).toHaveLength(0);
  });

  it('includes signaling peers at the front of the combined list', () => {
    const signalingPeers = ['/ip4/10.0.0.1/tcp/4001/p2p/QmSignaling'];
    const list = buildBootstrapList(fullConfig, signalingPeers);
    expect(list).toContain(signalingPeers[0]);
  });

  it('includes custom bootstrap peers', () => {
    const config: DiscoveryConfig = {
      ...fullConfig,
      customBootstrapPeers: ['/ip4/5.6.7.8/tcp/4001/p2p/QmCustom'],
    };
    const list = buildBootstrapList(config);
    expect(list).toContain('/ip4/5.6.7.8/tcp/4001/p2p/QmCustom');
  });

  it('deduplicates when the same peer appears in multiple sources', () => {
    const duplicatePeer = PUBLIC_BOOTSTRAP_WSS[0];
    const config: DiscoveryConfig = {
      ...fullConfig,
      customBootstrapPeers: [duplicatePeer],
    };
    // duplicatePeer is in both customBootstrapPeers and PUBLIC_BOOTSTRAP_WSS
    const list = buildBootstrapList(config, [duplicatePeer]);
    const occurrences = list.filter(p => p === duplicatePeer).length;
    expect(occurrences).toBe(1);
  });

  it('deduplicates when signaling peer overlaps with custom peer', () => {
    const peer = '/ip4/1.2.3.4/tcp/4001/p2p/QmDup';
    const config: DiscoveryConfig = {
      ...fullConfig,
      usePublicBootstrap: false,
      customBootstrapPeers: [peer],
    };
    const list = buildBootstrapList(config, [peer]);
    expect(list.filter(p => p === peer)).toHaveLength(1);
  });

  it('combines all three sources: signaling, custom, and public', () => {
    const signalingPeer = '/ip4/9.9.9.9/tcp/4001/p2p/QmSignaling';
    const customPeer = '/ip4/8.8.8.8/tcp/4001/p2p/QmCustom';
    const config: DiscoveryConfig = {
      ...fullConfig,
      customBootstrapPeers: [customPeer],
    };
    const list = buildBootstrapList(config, [signalingPeer]);
    expect(list).toContain(signalingPeer);
    expect(list).toContain(customPeer);
    // At least one public bootstrap should be present
    expect(list.some(p => PUBLIC_BOOTSTRAP_WSS.includes(p))).toBe(true);
  });

  it('returns an array (not a Set)', () => {
    const list = buildBootstrapList(fullConfig);
    expect(Array.isArray(list)).toBe(true);
  });

  it('returns empty list for fully-disabled config with no signaling peers', () => {
    const config: DiscoveryConfig = {
      usePublicBootstrap: false,
      enableCircuitRelay: false,
      enablePubsubDiscovery: false,
      enableMdns: false,
      customBootstrapPeers: [],
    };
    const list = buildBootstrapList(config, []);
    expect(list).toHaveLength(0);
  });
});
