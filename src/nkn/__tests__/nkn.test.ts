/**
 * NknFallback unit tests
 *
 * Covers construction, defaults, constants, and safe no-op behavior when NKN
 * is disabled or not yet connected. No network connections are made.
 */

import { describe, it, expect } from 'vitest';
import {
  NknFallback,
  DEFAULT_NKN_CONFIG,
} from '../index.js';
import type { NknConfig, NknAddressInfo } from '../index.js';

// ---------------------------------------------------------------------------
// DEFAULT_NKN_CONFIG
// ---------------------------------------------------------------------------

describe('DEFAULT_NKN_CONFIG', () => {
  it('is disabled by default (opt-in)', () => {
    expect(DEFAULT_NKN_CONFIG.enabled).toBe(false);
  });

  it('has a nexus identifier prefix', () => {
    expect(DEFAULT_NKN_CONFIG.identifier).toBe('nexus');
  });

  it('has a positive numSubClients', () => {
    expect(DEFAULT_NKN_CONFIG.numSubClients).toBeGreaterThan(0);
  });

  it('has numSubClients of 3', () => {
    expect(DEFAULT_NKN_CONFIG.numSubClients).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// NknFallback — construction
// ---------------------------------------------------------------------------

describe('NknFallback — construction', () => {
  it('creates an instance with no options', () => {
    const nkn = new NknFallback();
    expect(nkn).toBeInstanceOf(NknFallback);
  });

  it('creates an instance with partial config (enabled)', () => {
    const nkn = new NknFallback({ enabled: true });
    expect(nkn).toBeInstanceOf(NknFallback);
  });

  it('creates an instance with custom identifier', () => {
    const nkn = new NknFallback({ identifier: 'my-agent' });
    expect(nkn).toBeInstanceOf(NknFallback);
  });

  it('creates an instance with a full NknConfig', () => {
    const config: NknConfig = {
      enabled: false,
      identifier: 'nexus-test',
      numSubClients: 2,
    };
    const nkn = new NknFallback(config);
    expect(nkn).toBeInstanceOf(NknFallback);
  });
});

// ---------------------------------------------------------------------------
// NknFallback — isConnected before connect()
// ---------------------------------------------------------------------------

describe('NknFallback — isConnected', () => {
  it('returns false before connect() is called', () => {
    const nkn = new NknFallback();
    expect(nkn.isConnected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NknFallback — address before connect()
// ---------------------------------------------------------------------------

describe('NknFallback — address', () => {
  it('returns null before connect() is called', () => {
    const nkn = new NknFallback();
    expect(nkn.address).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// NknFallback — disconnect() is safe when not connected
// ---------------------------------------------------------------------------

describe('NknFallback — disconnect', () => {
  it('resolves without throwing when not connected', async () => {
    const nkn = new NknFallback();
    await expect(nkn.disconnect()).resolves.toBeUndefined();
  });

  it('is idempotent — calling disconnect() twice does not throw', async () => {
    const nkn = new NknFallback();
    await nkn.disconnect();
    await expect(nkn.disconnect()).resolves.toBeUndefined();
  });

  it('isConnected remains false after disconnect() with no connection', async () => {
    const nkn = new NknFallback();
    await nkn.disconnect();
    expect(nkn.isConnected).toBe(false);
  });

  it('address remains null after disconnect() with no connection', async () => {
    const nkn = new NknFallback();
    await nkn.disconnect();
    expect(nkn.address).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// NknFallback — send() returns false when not connected
// ---------------------------------------------------------------------------

describe('NknFallback — send (no connection)', () => {
  it('returns false when not connected', async () => {
    const nkn = new NknFallback();
    const result = await nkn.send('some-nkn-address', 'hello');
    expect(result).toBe(false);
  });

  it('does not throw when not connected', async () => {
    const nkn = new NknFallback();
    await expect(nkn.send('some-nkn-address', 'hello')).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NknFallback — connect() returns null when disabled (default)
// ---------------------------------------------------------------------------

describe('NknFallback — connect when disabled', () => {
  it('returns null immediately when enabled is false (default)', async () => {
    const nkn = new NknFallback(); // enabled: false by default
    const result = await nkn.connect();
    expect(result).toBeNull();
  });

  it('returns null when explicitly disabled', async () => {
    const nkn = new NknFallback({ enabled: false });
    const result = await nkn.connect();
    expect(result).toBeNull();
  });

  it('isConnected remains false after connect() with enabled=false', async () => {
    const nkn = new NknFallback({ enabled: false });
    await nkn.connect();
    expect(nkn.isConnected).toBe(false);
  });

  it('address remains null after connect() with enabled=false', async () => {
    const nkn = new NknFallback({ enabled: false });
    await nkn.connect();
    expect(nkn.address).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// NknFallback — setMessageHandler
// ---------------------------------------------------------------------------

describe('NknFallback — setMessageHandler', () => {
  it('sets a handler without throwing', () => {
    const nkn = new NknFallback();
    expect(() => {
      nkn.setMessageHandler((_src, _payload) => {});
    }).not.toThrow();
  });

  it('replaces an existing handler without throwing', () => {
    const nkn = new NknFallback();
    nkn.setMessageHandler((_src, _payload) => {});
    expect(() => {
      nkn.setMessageHandler((_src, _payload) => {});
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// NknAddressInfo — type shape
// ---------------------------------------------------------------------------

describe('NknAddressInfo — type shape', () => {
  it('satisfies the expected structure', () => {
    const info: NknAddressInfo = {
      address: 'nexus.abc123publickey',
      publicKey: 'abc123publickey',
      seed: 'deadbeefdeadbeef',
    };
    expect(typeof info.address).toBe('string');
    expect(typeof info.publicKey).toBe('string');
    expect(typeof info.seed).toBe('string');
  });
});
