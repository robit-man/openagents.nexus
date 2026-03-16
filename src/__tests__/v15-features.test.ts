/**
 * v1.5 agent interaction features — unit tests
 *
 * Tests registerCapability, blocking, metering accessor, and new event types
 * on NexusClient without spinning up a real libp2p node.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NexusClient } from '../index.js';

// ---------------------------------------------------------------------------
// registerCapability / unregisterCapability / getRegisteredCapabilities
// ---------------------------------------------------------------------------

describe('NexusClient — capability registration', () => {
  let client: NexusClient;

  beforeEach(() => {
    client = new NexusClient();
  });

  it('registers a capability handler', () => {
    const handler = vi.fn();
    client.registerCapability('translate', handler);
    expect(client.getRegisteredCapabilities()).toContain('translate');
  });

  it('unregisters a capability handler', () => {
    const handler = vi.fn();
    client.registerCapability('translate', handler);
    client.unregisterCapability('translate');
    expect(client.getRegisteredCapabilities()).not.toContain('translate');
  });

  it('returns empty array when no capabilities registered', () => {
    expect(client.getRegisteredCapabilities()).toEqual([]);
  });

  it('registers multiple capabilities', () => {
    client.registerCapability('translate', vi.fn());
    client.registerCapability('summarize', vi.fn());
    const caps = client.getRegisteredCapabilities();
    expect(caps).toContain('translate');
    expect(caps).toContain('summarize');
    expect(caps).toHaveLength(2);
  });

  it('overwrites handler when same name registered twice', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    client.registerCapability('translate', h1);
    client.registerCapability('translate', h2);
    expect(client.getRegisteredCapabilities()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// blockPeer / unblockPeer
// ---------------------------------------------------------------------------

describe('NexusClient — blocking', () => {
  let client: NexusClient;

  beforeEach(() => {
    client = new NexusClient();
  });

  it('blockPeer adds to denylist', () => {
    client.blockPeer('12D3KooWBadPeer');
    expect(client.trustPolicy.allowPeer('12D3KooWBadPeer')).toBe(false);
  });

  it('unblockPeer removes from denylist', () => {
    client.blockPeer('12D3KooWBadPeer');
    client.unblockPeer('12D3KooWBadPeer');
    expect(client.trustPolicy.allowPeer('12D3KooWBadPeer')).toBe(true);
  });

  it('trustPolicy is lazy-initialized', () => {
    expect(client.trustPolicy).toBeTruthy();
    expect(client.trustPolicy.allowPeer('any-peer')).toBe(true);
  });

  it('trustPolicy respects constructor config', () => {
    const c = new NexusClient({
      trustPolicy: { denylist: ['blocked-peer'] },
    });
    expect(c.trustPolicy.allowPeer('blocked-peer')).toBe(false);
    expect(c.trustPolicy.allowPeer('ok-peer')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// metering accessor
// ---------------------------------------------------------------------------

describe('NexusClient — metering', () => {
  it('metering is lazy-initialized', () => {
    const client = new NexusClient();
    expect(client.metering).toBeTruthy();
    expect(client.metering.size).toBe(0);
  });

  it('same metering instance returned on multiple accesses', () => {
    const client = new NexusClient();
    const a = client.metering;
    const b = client.metering;
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// New event types
// ---------------------------------------------------------------------------

describe('NexusClient — new event types', () => {
  let client: NexusClient;

  beforeEach(() => {
    client = new NexusClient();
  });

  it('message event fires with roomId and message', () => {
    const listener = vi.fn();
    client.on('message', listener);
    (client as any).emit('message', { roomId: 'general', message: { id: 'msg-1' } });
    expect(listener).toHaveBeenCalledWith({
      roomId: 'general',
      message: { id: 'msg-1' },
    });
  });

  it('dm event fires with from, content, format, messageId', () => {
    const listener = vi.fn();
    client.on('dm', listener);
    (client as any).emit('dm', {
      from: 'peer-abc',
      content: 'hello',
      format: 'text/plain',
      messageId: 'dm-1',
    });
    expect(listener).toHaveBeenCalledWith({
      from: 'peer-abc',
      content: 'hello',
      format: 'text/plain',
      messageId: 'dm-1',
    });
  });

  it('invoke event fires with from, capability, requestId', () => {
    const listener = vi.fn();
    client.on('invoke', listener);
    (client as any).emit('invoke', {
      from: 'peer-xyz',
      capability: 'translate',
      requestId: 'req-1',
    });
    expect(listener).toHaveBeenCalledWith({
      from: 'peer-xyz',
      capability: 'translate',
      requestId: 'req-1',
    });
  });
});
