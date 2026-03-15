/**
 * NatsDiscovery unit tests
 *
 * Covers construction, defaults, constants, and safe no-op behavior when not
 * connected to a real NATS server. No network connections are made.
 */

import { describe, it, expect } from 'vitest';
import {
  NatsDiscovery,
  DEFAULT_NATS_CONFIG,
  NATS_DISCOVERY_SERVERS,
  NATS_DISCOVERY_SUBJECT,
  NATS_PRESENCE_SUBJECT,
} from '../index.js';
import type { NatsDiscoveryConfig, NatsAgentAnnouncement } from '../index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('NATS_DISCOVERY_SERVERS', () => {
  it('is non-empty', () => {
    expect(NATS_DISCOVERY_SERVERS.length).toBeGreaterThan(0);
  });

  it('contains WSS URLs', () => {
    for (const server of NATS_DISCOVERY_SERVERS) {
      expect(server).toMatch(/^wss:\/\//);
    }
  });

  it('includes the public demo server', () => {
    expect(NATS_DISCOVERY_SERVERS).toContain('wss://demo.nats.io:8443');
  });
});

describe('NATS_DISCOVERY_SUBJECT', () => {
  it('is the expected subject string', () => {
    expect(NATS_DISCOVERY_SUBJECT).toBe('nexus.agents.discovery');
  });
});

describe('NATS_PRESENCE_SUBJECT', () => {
  it('is the expected presence subject string', () => {
    expect(NATS_PRESENCE_SUBJECT).toBe('nexus.agents.presence');
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_NATS_CONFIG
// ---------------------------------------------------------------------------

describe('DEFAULT_NATS_CONFIG', () => {
  it('is enabled by default', () => {
    expect(DEFAULT_NATS_CONFIG.enabled).toBe(true);
  });

  it('references the public NATS discovery servers', () => {
    expect(DEFAULT_NATS_CONFIG.servers).toEqual(NATS_DISCOVERY_SERVERS);
  });

  it('includes both discovery and presence subjects', () => {
    expect(DEFAULT_NATS_CONFIG.subjects).toContain(NATS_DISCOVERY_SUBJECT);
    expect(DEFAULT_NATS_CONFIG.subjects).toContain(NATS_PRESENCE_SUBJECT);
  });

  it('has at least 2 subjects', () => {
    expect(DEFAULT_NATS_CONFIG.subjects.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// NatsDiscovery — construction
// ---------------------------------------------------------------------------

describe('NatsDiscovery — construction', () => {
  it('creates an instance with no options', () => {
    const nd = new NatsDiscovery();
    expect(nd).toBeInstanceOf(NatsDiscovery);
  });

  it('creates an instance with partial config', () => {
    const nd = new NatsDiscovery({ enabled: false });
    expect(nd).toBeInstanceOf(NatsDiscovery);
  });

  it('creates an instance with custom servers', () => {
    const nd = new NatsDiscovery({ servers: ['wss://custom.nats.example.com:8443'] });
    expect(nd).toBeInstanceOf(NatsDiscovery);
  });

  it('accepts a full NatsDiscoveryConfig', () => {
    const config: NatsDiscoveryConfig = {
      enabled: true,
      servers: ['wss://demo.nats.io:8443'],
      subjects: ['nexus.agents.discovery'],
    };
    const nd = new NatsDiscovery(config);
    expect(nd).toBeInstanceOf(NatsDiscovery);
  });
});

// ---------------------------------------------------------------------------
// NatsDiscovery — isConnected before connect()
// ---------------------------------------------------------------------------

describe('NatsDiscovery — isConnected', () => {
  it('returns false before connect() is called', () => {
    const nd = new NatsDiscovery();
    expect(nd.isConnected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NatsDiscovery — disconnect() is safe when not connected
// ---------------------------------------------------------------------------

describe('NatsDiscovery — disconnect', () => {
  it('resolves without throwing when not connected', async () => {
    const nd = new NatsDiscovery();
    await expect(nd.disconnect()).resolves.toBeUndefined();
  });

  it('is idempotent — calling disconnect() twice does not throw', async () => {
    const nd = new NatsDiscovery();
    await nd.disconnect();
    await expect(nd.disconnect()).resolves.toBeUndefined();
  });

  it('isConnected remains false after disconnect() with no connection', async () => {
    const nd = new NatsDiscovery();
    await nd.disconnect();
    expect(nd.isConnected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NatsDiscovery — announce() is safe when not connected
// ---------------------------------------------------------------------------

describe('NatsDiscovery — announce (no connection)', () => {
  it('does not throw when called before connect()', async () => {
    const nd = new NatsDiscovery();
    const announcement: NatsAgentAnnouncement = {
      type: 'nexus.announce',
      peerId: '12D3KooWTestPeer',
      agentName: 'test-agent',
      rooms: ['general'],
      multiaddrs: ['/ip4/1.2.3.4/tcp/4001'],
      timestamp: Date.now(),
    };
    await expect(nd.announce(announcement)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// NatsDiscovery — subscribe() is safe when not connected
// ---------------------------------------------------------------------------

describe('NatsDiscovery — subscribe (no connection)', () => {
  it('does not throw when called before connect()', async () => {
    const nd = new NatsDiscovery();
    await expect(nd.subscribe((_ann) => {})).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// NatsDiscovery — connect() returns false when disabled
// ---------------------------------------------------------------------------

describe('NatsDiscovery — connect when disabled', () => {
  it('returns false immediately when enabled is false', async () => {
    const nd = new NatsDiscovery({ enabled: false });
    const result = await nd.connect();
    expect(result).toBe(false);
  });

  it('isConnected remains false after connect() with enabled=false', async () => {
    const nd = new NatsDiscovery({ enabled: false });
    await nd.connect();
    expect(nd.isConnected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NatsAgentAnnouncement — type shape
// ---------------------------------------------------------------------------

describe('NatsAgentAnnouncement — type shape', () => {
  it('satisfies the expected structure', () => {
    const announcement: NatsAgentAnnouncement = {
      type: 'nexus.announce',
      peerId: '12D3KooWAbcDef',
      agentName: 'agent-alpha',
      rooms: ['room-1', 'room-2'],
      multiaddrs: ['/ip4/127.0.0.1/tcp/4001'],
      timestamp: 1710000000000,
    };
    expect(announcement.type).toBe('nexus.announce');
    expect(announcement.peerId).toBe('12D3KooWAbcDef');
    expect(announcement.agentName).toBe('agent-alpha');
    expect(Array.isArray(announcement.rooms)).toBe(true);
    expect(Array.isArray(announcement.multiaddrs)).toBe(true);
    expect(typeof announcement.timestamp).toBe('number');
  });
});
