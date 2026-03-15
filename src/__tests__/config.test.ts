import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, resolveConfig } from '../config.js';

describe('DEFAULT_CONFIG', () => {
  it('has empty bootstrapPeers array', () => {
    expect(DEFAULT_CONFIG.bootstrapPeers).toEqual([]);
  });

  it('has the correct signalingServer', () => {
    expect(DEFAULT_CONFIG.signalingServer).toBe('https://openagents.nexus');
  });

  it('has role set to full', () => {
    expect(DEFAULT_CONFIG.role).toBe('full');
  });

  it('has two listen addresses', () => {
    expect(DEFAULT_CONFIG.listenAddresses).toHaveLength(2);
    expect(DEFAULT_CONFIG.listenAddresses[0]).toBe('/ip4/0.0.0.0/tcp/0');
    expect(DEFAULT_CONFIG.listenAddresses[1]).toBe('/ip4/0.0.0.0/tcp/0/ws');
  });

  it('has agentType set to autonomous', () => {
    expect(DEFAULT_CONFIG.agentType).toBe('autonomous');
  });

  it('has correct timeout values', () => {
    expect(DEFAULT_CONFIG.connectionTimeoutMs).toBe(30_000);
    expect(DEFAULT_CONFIG.syncTimeoutMs).toBe(60_000);
  });

  it('has correct rate limit values', () => {
    expect(DEFAULT_CONFIG.maxMessagesPerSecond).toBe(10);
    expect(DEFAULT_CONFIG.maxDhtPutsPerMinute).toBe(5);
  });
});

describe('resolveConfig', () => {
  it('returns DEFAULT_CONFIG when called with no argument', () => {
    const config = resolveConfig();
    expect(config.role).toBe('full');
    expect(config.signalingServer).toBe('https://openagents.nexus');
    expect(config.connectionTimeoutMs).toBe(30_000);
  });

  it('merges partial config over defaults', () => {
    const config = resolveConfig({
      role: 'light',
      agentName: 'my-agent',
      connectionTimeoutMs: 5_000,
    });
    expect(config.role).toBe('light');
    expect(config.agentName).toBe('my-agent');
    expect(config.connectionTimeoutMs).toBe(5_000);
    // defaults preserved
    expect(config.signalingServer).toBe('https://openagents.nexus');
    expect(config.maxMessagesPerSecond).toBe(10);
  });

  it('allows overriding bootstrapPeers', () => {
    const peers = ['/ip4/1.2.3.4/tcp/4001/p2p/QmFoo'];
    const config = resolveConfig({ bootstrapPeers: peers });
    expect(config.bootstrapPeers).toEqual(peers);
  });

  it('allows overriding storage fields', () => {
    const config = resolveConfig({ datastorePath: '/tmp/nexus-data' });
    expect(config.datastorePath).toBe('/tmp/nexus-data');
  });

  it('does not mutate DEFAULT_CONFIG', () => {
    resolveConfig({ role: 'storage', connectionTimeoutMs: 1 });
    expect(DEFAULT_CONFIG.role).toBe('full');
    expect(DEFAULT_CONFIG.connectionTimeoutMs).toBe(30_000);
  });

  it('generates a random agentName by default', () => {
    // Each call to resolveConfig() uses the already-computed DEFAULT_CONFIG.agentName
    // but two separate calls should at minimum produce a non-empty string
    const config = resolveConfig();
    expect(config.agentName).toBeTruthy();
    expect(config.agentName.startsWith('agent-')).toBe(true);
  });
});
