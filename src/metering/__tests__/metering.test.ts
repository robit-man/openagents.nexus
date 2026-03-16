/**
 * Metering engine tests
 */

import { describe, it, expect, vi } from 'vitest';
import { MeteringEngine } from '../index.js';
import type { UsageRecord, MeteringHook } from '../index.js';

function makeRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: `req-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    peerId: 'peer-1',
    service: 'chat',
    capability: 'chat',
    direction: 'inbound',
    inputBytes: 100,
    outputBytes: 200,
    durationMs: 50,
    ...overrides,
  };
}

describe('MeteringEngine', () => {
  it('records a usage event', async () => {
    const engine = new MeteringEngine();
    await engine.record(makeRecord());
    expect(engine.size).toBe(1);
  });

  it('FIFO evicts when exceeding max records', async () => {
    const engine = new MeteringEngine(3);
    await engine.record(makeRecord({ id: 'a' }));
    await engine.record(makeRecord({ id: 'b' }));
    await engine.record(makeRecord({ id: 'c' }));
    await engine.record(makeRecord({ id: 'd' }));
    expect(engine.size).toBe(3);
    const ids = engine.getRecords().map(r => r.id);
    expect(ids).toEqual(['b', 'c', 'd']);
  });

  it('aggregates per-peer summaries', async () => {
    const engine = new MeteringEngine();
    await engine.record(makeRecord({ peerId: 'p1', inputBytes: 10, outputBytes: 20, durationMs: 5 }));
    await engine.record(makeRecord({ peerId: 'p1', inputBytes: 30, outputBytes: 40, durationMs: 10 }));
    await engine.record(makeRecord({ peerId: 'p2', inputBytes: 50, outputBytes: 60, durationMs: 15 }));

    const s1 = engine.getSummary('p1')!;
    expect(s1.totalRequests).toBe(2);
    expect(s1.totalInputBytes).toBe(40);
    expect(s1.totalOutputBytes).toBe(60);
    expect(s1.totalDurationMs).toBe(15);

    const s2 = engine.getSummary('p2')!;
    expect(s2.totalRequests).toBe(1);

    expect(engine.getAllSummaries()).toHaveLength(2);
  });

  it('tracks per-service breakdown in summary', async () => {
    const engine = new MeteringEngine();
    await engine.record(makeRecord({ peerId: 'p1', service: 'translate', inputBytes: 10, outputBytes: 20, durationMs: 5 }));
    await engine.record(makeRecord({ peerId: 'p1', service: 'summarize', inputBytes: 30, outputBytes: 40, durationMs: 10 }));

    const s = engine.getSummary('p1')!;
    expect(s.services.get('translate')?.requests).toBe(1);
    expect(s.services.get('summarize')?.requests).toBe(1);
  });

  it('tracks payment totals', async () => {
    const engine = new MeteringEngine();
    await engine.record(makeRecord({ peerId: 'p1', payment: { amount: '0.001', currency: 'USDC' } }));
    await engine.record(makeRecord({ peerId: 'p1', payment: { amount: '0.002', currency: 'USDC' } }));

    const s = engine.getSummary('p1')!;
    expect(s.totalPayments).toBeCloseTo(0.003);
  });

  it('fires hooks on record', async () => {
    const engine = new MeteringEngine();
    const hook = vi.fn();
    engine.addHook(hook);
    const rec = makeRecord();
    await engine.record(rec);
    expect(hook).toHaveBeenCalledWith(rec);
  });

  it('removing a hook prevents it from firing', async () => {
    const engine = new MeteringEngine();
    const hook = vi.fn();
    engine.addHook(hook);
    engine.removeHook(hook);
    await engine.record(makeRecord());
    expect(hook).not.toHaveBeenCalled();
  });

  it('hook errors do not prevent recording', async () => {
    const engine = new MeteringEngine();
    const badHook: MeteringHook = () => { throw new Error('hook fail'); };
    engine.addHook(badHook);
    await engine.record(makeRecord());
    expect(engine.size).toBe(1);
  });

  it('getRecords filters by peerId', async () => {
    const engine = new MeteringEngine();
    await engine.record(makeRecord({ peerId: 'a' }));
    await engine.record(makeRecord({ peerId: 'b' }));
    const filtered = engine.getRecords({ peerId: 'a' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].peerId).toBe('a');
  });

  it('getRecords filters by service', async () => {
    const engine = new MeteringEngine();
    await engine.record(makeRecord({ service: 'chat' }));
    await engine.record(makeRecord({ service: 'translate' }));
    expect(engine.getRecords({ service: 'translate' })).toHaveLength(1);
  });

  it('getRecords filters by direction', async () => {
    const engine = new MeteringEngine();
    await engine.record(makeRecord({ direction: 'inbound' }));
    await engine.record(makeRecord({ direction: 'outbound' }));
    expect(engine.getRecords({ direction: 'outbound' })).toHaveLength(1);
  });

  it('getRecords filters by time range', async () => {
    const engine = new MeteringEngine();
    await engine.record(makeRecord({ timestamp: 1000 }));
    await engine.record(makeRecord({ timestamp: 2000 }));
    await engine.record(makeRecord({ timestamp: 3000 }));
    expect(engine.getRecords({ since: 1500, until: 2500 })).toHaveLength(1);
  });

  it('getRecords returns all when no filter', async () => {
    const engine = new MeteringEngine();
    await engine.record(makeRecord());
    await engine.record(makeRecord());
    expect(engine.getRecords()).toHaveLength(2);
  });

  it('clear() empties records and summaries', async () => {
    const engine = new MeteringEngine();
    await engine.record(makeRecord());
    engine.clear();
    expect(engine.size).toBe(0);
    expect(engine.getAllSummaries()).toHaveLength(0);
  });

  it('getSummary returns undefined for unknown peer', () => {
    const engine = new MeteringEngine();
    expect(engine.getSummary('unknown')).toBeUndefined();
  });
});
