/**
 * NexusClient.reportMetrics() unit tests — Phase 8
 *
 * reportMetrics() is an optional, low-frequency call that POSTs aggregate
 * counters (peers, rooms, msgRate) to the hub. It sends NO identity, NO
 * content, NO PII — only simple numbers. Failures are silent.
 *
 * Because it relies on `fetch`, we mock the global fetch to verify the
 * correct URL, method, and body are used. We also verify the method is
 * resilient to network failures.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NexusClient } from '../index.js';

describe('NexusClient — reportMetrics()', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a callable method on NexusClient instances', () => {
    const client = new NexusClient();
    expect(typeof client.reportMetrics).toBe('function');
  });

  it('returns a Promise<void>', async () => {
    const client = new NexusClient();
    const result = client.reportMetrics();
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });

  it('POSTs to /api/v1/metrics on the configured signalingServer', async () => {
    const client = new NexusClient({
      signalingServer: 'https://openagents.nexus',
    });
    await client.reportMetrics();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openagents.nexus/api/v1/metrics');
  });

  it('uses POST method with JSON content-type', async () => {
    const client = new NexusClient();
    await client.reportMetrics();
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('sends only aggregate counters — peers, rooms, msgRate', async () => {
    const client = new NexusClient();
    await client.reportMetrics();
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);

    // Must include the three expected numeric fields
    expect(typeof body.peers).toBe('number');
    expect(typeof body.rooms).toBe('number');
    expect(typeof body.msgRate).toBe('number');

    // Must NOT include identity or content fields
    expect(body).not.toHaveProperty('peerId');
    expect(body).not.toHaveProperty('agentName');
    expect(body).not.toHaveProperty('model');
    expect(body).not.toHaveProperty('system');
    expect(body).not.toHaveProperty('content');
    expect(body).not.toHaveProperty('capabilities');
  });

  it('sends non-negative numeric values', async () => {
    const client = new NexusClient();
    await client.reportMetrics();
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.peers).toBeGreaterThanOrEqual(0);
    expect(body.rooms).toBeGreaterThanOrEqual(0);
    expect(body.msgRate).toBeGreaterThanOrEqual(0);
  });

  it('is silent on network failure — resolves without throwing', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network error'));
    const client = new NexusClient();
    await expect(client.reportMetrics()).resolves.toBeUndefined();
  });

  it('is silent on non-200 HTTP response — resolves without throwing', async () => {
    fetchMock.mockResolvedValueOnce(new Response('error', { status: 500 }));
    const client = new NexusClient();
    await expect(client.reportMetrics()).resolves.toBeUndefined();
  });

  it('is NOT called automatically — requires explicit opt-in', () => {
    // Simply constructing a client should not trigger any fetch
    new NexusClient();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the custom signalingServer URL when configured', async () => {
    const client = new NexusClient({
      signalingServer: 'https://my-custom-hub.example.com',
    });
    await client.reportMetrics();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://my-custom-hub.example.com/api/v1/metrics');
  });

  it('rooms field reflects joined rooms count (0 when not connected)', async () => {
    // When not connected, roomManager is null — rooms should default to 0
    const client = new NexusClient();
    await client.reportMetrics();
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.rooms).toBe(0);
  });
});
