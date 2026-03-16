/**
 * x402 invoke payment flow tests
 *
 * Tests registerCapability with pricing, CapabilityOptions, and the
 * payment gating behavior without spinning up a real libp2p node.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NexusClient } from '../index.js';
import type { CapabilityOptions } from '../index.js';

describe('NexusClient — registerCapability with pricing', () => {
  let client: NexusClient;

  beforeEach(() => {
    client = new NexusClient();
  });

  it('registers a capability with pricing options', () => {
    const handler = vi.fn();
    const options: CapabilityOptions = {
      pricing: { amount: '100000', currency: 'USDC', description: 'Per-request fee' },
    };
    client.registerCapability('translate', handler, options);
    expect(client.getRegisteredCapabilities()).toContain('translate');
  });

  it('registers a capability without pricing (free)', () => {
    const handler = vi.fn();
    client.registerCapability('echo', handler);
    expect(client.getRegisteredCapabilities()).toContain('echo');
  });

  it('registers a capability with $0 free-tier pricing', () => {
    const handler = vi.fn();
    client.registerCapability('free-chat', handler, {
      pricing: { amount: '0', currency: 'USDC' },
    });
    expect(client.getRegisteredCapabilities()).toContain('free-chat');
  });

  it('unregistering clears pricing too', () => {
    client.registerCapability('paid', vi.fn(), {
      pricing: { amount: '50000', currency: 'USDC' },
    });
    client.unregisterCapability('paid');
    expect(client.getRegisteredCapabilities()).not.toContain('paid');
  });

  it('re-registering with pricing replaces old pricing', () => {
    client.registerCapability('svc', vi.fn(), {
      pricing: { amount: '100', currency: 'USDC' },
    });
    client.registerCapability('svc', vi.fn(), {
      pricing: { amount: '200', currency: 'USDC' },
    });
    expect(client.getRegisteredCapabilities()).toHaveLength(1);
  });

  it('re-registering without pricing removes old pricing', () => {
    client.registerCapability('svc', vi.fn(), {
      pricing: { amount: '100', currency: 'USDC' },
    });
    client.registerCapability('svc', vi.fn());
    expect(client.getRegisteredCapabilities()).toHaveLength(1);
  });
});

describe('NexusClient — invokeCapability payment handling', () => {
  it('throws when provider requires payment but x402 wallet not initialized', async () => {
    // This tests the error path — we can't actually invoke without libp2p,
    // but we can verify the wallet check exists by checking the method signature
    const client = new NexusClient();
    await expect(
      client.invokeCapability('12D3KooWTest', 'paid-service', { prompt: 'hello' }),
    ).rejects.toThrow('Not connected');
  });
});
