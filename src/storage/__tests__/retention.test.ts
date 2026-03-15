import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  RetentionPolicyEngine,
  DEFAULT_RETENTION,
  type StoredObject,
  type RetentionClass,
} from '../retention.js';

function makeObj(overrides: Partial<StoredObject> = {}): StoredObject {
  return {
    cid: 'bafytest' + Math.random().toString(36).slice(2),
    retentionClass: 'cache',
    storedAt: Date.now(),
    sizeBytes: 1024,
    ...overrides,
  };
}

describe('RetentionPolicyEngine — shouldAccept()', () => {
  let engine: RetentionPolicyEngine;

  beforeEach(() => {
    engine = new RetentionPolicyEngine({
      maxTotalBytes: 1000,
      maxPerRoomBytes: 500,
    });
  });

  it('accepts object when under total budget', () => {
    const result = engine.shouldAccept(makeObj({ sizeBytes: 100 }));
    expect(result.accept).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('rejects when object would exceed total budget', () => {
    // Track some objects first
    const obj1 = makeObj({ sizeBytes: 800 });
    engine.track(obj1);
    // Now try to add one that would push over 1000
    const obj2 = makeObj({ sizeBytes: 300 });
    const result = engine.shouldAccept(obj2);
    expect(result.accept).toBe(false);
    expect(result.reason).toMatch(/total storage budget/i);
  });

  it('accepts when total exactly at budget before new object', () => {
    const obj1 = makeObj({ sizeBytes: 999 });
    engine.track(obj1);
    const obj2 = makeObj({ sizeBytes: 1 });
    const result = engine.shouldAccept(obj2);
    expect(result.accept).toBe(true);
  });

  it('rejects when per-room budget exceeded', () => {
    const room = 'room-alpha';
    const obj1 = makeObj({ sizeBytes: 400, roomId: room });
    engine.track(obj1);
    const obj2 = makeObj({ sizeBytes: 200, roomId: room });
    const result = engine.shouldAccept(obj2);
    expect(result.accept).toBe(false);
    expect(result.reason).toMatch(/per-room storage budget/i);
  });

  it('accepts object with no roomId even when other rooms are full', () => {
    const obj1 = makeObj({ sizeBytes: 400, roomId: 'room-a' });
    engine.track(obj1);
    const obj2 = makeObj({ sizeBytes: 200 }); // no roomId
    const result = engine.shouldAccept(obj2);
    expect(result.accept).toBe(true);
  });

  it('rejects mirrored object when room not in allowedMirrorRooms', () => {
    const engineWithMirrorList = new RetentionPolicyEngine({
      maxTotalBytes: 10_000,
      maxPerRoomBytes: 5_000,
      allowedMirrorRooms: ['approved-room'],
    });
    const obj = makeObj({ retentionClass: 'mirrored', roomId: 'unapproved-room', sizeBytes: 100 });
    const result = engineWithMirrorList.shouldAccept(obj);
    expect(result.accept).toBe(false);
    expect(result.reason).toMatch(/mirror allowlist/i);
  });

  it('accepts mirrored object when room is in allowedMirrorRooms', () => {
    const engineWithMirrorList = new RetentionPolicyEngine({
      maxTotalBytes: 10_000,
      maxPerRoomBytes: 5_000,
      allowedMirrorRooms: ['approved-room'],
    });
    const obj = makeObj({ retentionClass: 'mirrored', roomId: 'approved-room', sizeBytes: 100 });
    const result = engineWithMirrorList.shouldAccept(obj);
    expect(result.accept).toBe(true);
  });

  it('accepts mirrored object with no roomId regardless of allowedMirrorRooms', () => {
    const engineWithMirrorList = new RetentionPolicyEngine({
      maxTotalBytes: 10_000,
      maxPerRoomBytes: 5_000,
      allowedMirrorRooms: ['approved-room'],
    });
    const obj = makeObj({ retentionClass: 'mirrored', sizeBytes: 100 }); // no roomId
    const result = engineWithMirrorList.shouldAccept(obj);
    expect(result.accept).toBe(true);
  });

  it('accepts mirrored object when allowedMirrorRooms is empty (no restriction)', () => {
    const engineNoRestriction = new RetentionPolicyEngine({
      maxTotalBytes: 10_000,
      maxPerRoomBytes: 5_000,
      allowedMirrorRooms: [],
    });
    const obj = makeObj({ retentionClass: 'mirrored', roomId: 'any-room', sizeBytes: 100 });
    const result = engineNoRestriction.shouldAccept(obj);
    expect(result.accept).toBe(true);
  });
});

describe('RetentionPolicyEngine — track() / untrack()', () => {
  let engine: RetentionPolicyEngine;

  beforeEach(() => {
    engine = new RetentionPolicyEngine();
  });

  it('track increases tracked count', () => {
    expect(engine.getTrackedCount()).toBe(0);
    engine.track(makeObj({ cid: 'cid-1' }));
    expect(engine.getTrackedCount()).toBe(1);
    engine.track(makeObj({ cid: 'cid-2' }));
    expect(engine.getTrackedCount()).toBe(2);
  });

  it('untrack decreases tracked count', () => {
    const obj = makeObj({ cid: 'cid-1' });
    engine.track(obj);
    expect(engine.getTrackedCount()).toBe(1);
    engine.untrack('cid-1');
    expect(engine.getTrackedCount()).toBe(0);
  });

  it('untrack on unknown cid is a no-op', () => {
    engine.untrack('does-not-exist');
    expect(engine.getTrackedCount()).toBe(0);
  });
});

describe('RetentionPolicyEngine — getExpired()', () => {
  it('returns CIDs past their TTL', () => {
    vi.useFakeTimers();
    const engine = new RetentionPolicyEngine({
      ttlByClass: {
        ephemeral: 1000,
        cache: 5000,
        retained: 10_000,
        mirrored: 20_000,
        archival: Infinity,
      },
    });

    const obj1 = makeObj({ cid: 'cid-ephemeral', retentionClass: 'ephemeral', storedAt: Date.now() });
    const obj2 = makeObj({ cid: 'cid-cache', retentionClass: 'cache', storedAt: Date.now() });
    engine.track(obj1);
    engine.track(obj2);

    vi.advanceTimersByTime(2000); // ephemeral expired, cache not yet

    const expired = engine.getExpired();
    expect(expired).toContain('cid-ephemeral');
    expect(expired).not.toContain('cid-cache');

    vi.useRealTimers();
  });

  it('ignores archival objects (Infinity TTL)', () => {
    const engine = new RetentionPolicyEngine();
    const obj = makeObj({ cid: 'cid-archival', retentionClass: 'archival', storedAt: 0 }); // very old
    engine.track(obj);
    const expired = engine.getExpired();
    expect(expired).not.toContain('cid-archival');
  });

  it('returns empty array when nothing is expired', () => {
    const engine = new RetentionPolicyEngine();
    const obj = makeObj({ retentionClass: 'retained', storedAt: Date.now() });
    engine.track(obj);
    expect(engine.getExpired()).toHaveLength(0);
  });
});

describe('RetentionPolicyEngine — gc()', () => {
  it('removes expired objects and returns their CIDs', () => {
    vi.useFakeTimers();
    const engine = new RetentionPolicyEngine({
      ttlByClass: {
        ephemeral: 100,
        cache: 5000,
        retained: 10_000,
        mirrored: 20_000,
        archival: Infinity,
      },
    });
    const obj = makeObj({ cid: 'cid-old', retentionClass: 'ephemeral', storedAt: Date.now() });
    engine.track(obj);

    vi.advanceTimersByTime(200);

    const removed = engine.gc();
    expect(removed).toContain('cid-old');
    expect(engine.getTrackedCount()).toBe(0);

    vi.useRealTimers();
  });

  it('returns empty array when nothing to remove', () => {
    const engine = new RetentionPolicyEngine();
    expect(engine.gc()).toHaveLength(0);
  });

  it('does not remove non-expired objects', () => {
    vi.useFakeTimers();
    const engine = new RetentionPolicyEngine({
      ttlByClass: {
        ephemeral: 1000,
        cache: 5000,
        retained: 10_000,
        mirrored: 20_000,
        archival: Infinity,
      },
    });
    const obj = makeObj({ cid: 'cid-fresh', retentionClass: 'cache', storedAt: Date.now() });
    engine.track(obj);

    vi.advanceTimersByTime(200);

    const removed = engine.gc();
    expect(removed).toHaveLength(0);
    expect(engine.getTrackedCount()).toBe(1);

    vi.useRealTimers();
  });
});

describe('RetentionPolicyEngine — getTotalSize() / getRoomSize()', () => {
  let engine: RetentionPolicyEngine;

  beforeEach(() => {
    engine = new RetentionPolicyEngine();
  });

  it('getTotalSize returns 0 when empty', () => {
    expect(engine.getTotalSize()).toBe(0);
  });

  it('getTotalSize sums all tracked objects', () => {
    engine.track(makeObj({ cid: 'a', sizeBytes: 100 }));
    engine.track(makeObj({ cid: 'b', sizeBytes: 200 }));
    expect(engine.getTotalSize()).toBe(300);
  });

  it('getRoomSize returns 0 for unknown room', () => {
    expect(engine.getRoomSize('nonexistent')).toBe(0);
  });

  it('getRoomSize sums only objects in that room', () => {
    engine.track(makeObj({ cid: 'a', sizeBytes: 100, roomId: 'room-1' }));
    engine.track(makeObj({ cid: 'b', sizeBytes: 200, roomId: 'room-1' }));
    engine.track(makeObj({ cid: 'c', sizeBytes: 300, roomId: 'room-2' }));
    expect(engine.getRoomSize('room-1')).toBe(300);
    expect(engine.getRoomSize('room-2')).toBe(300);
  });

  it('getTotalSize decreases after untrack', () => {
    engine.track(makeObj({ cid: 'a', sizeBytes: 100 }));
    engine.track(makeObj({ cid: 'b', sizeBytes: 200 }));
    engine.untrack('a');
    expect(engine.getTotalSize()).toBe(200);
  });
});

describe('DEFAULT_RETENTION values', () => {
  it('has correct maxTotalBytes (500MB)', () => {
    expect(DEFAULT_RETENTION.maxTotalBytes).toBe(500 * 1024 * 1024);
  });

  it('has correct maxPerRoomBytes (100MB)', () => {
    expect(DEFAULT_RETENTION.maxPerRoomBytes).toBe(100 * 1024 * 1024);
  });

  it('has correct TTL for ephemeral (1h)', () => {
    expect(DEFAULT_RETENTION.ttlByClass.ephemeral).toBe(60 * 60 * 1000);
  });

  it('has correct TTL for cache (24h)', () => {
    expect(DEFAULT_RETENTION.ttlByClass.cache).toBe(24 * 60 * 60 * 1000);
  });

  it('has correct TTL for retained (7d)', () => {
    expect(DEFAULT_RETENTION.ttlByClass.retained).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('has correct TTL for mirrored (30d)', () => {
    expect(DEFAULT_RETENTION.ttlByClass.mirrored).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('has Infinity TTL for archival', () => {
    expect(DEFAULT_RETENTION.ttlByClass.archival).toBe(Infinity);
  });

  it('has empty allowedMirrorRooms by default', () => {
    expect(DEFAULT_RETENTION.allowedMirrorRooms).toEqual([]);
  });

  it('has gcIntervalMs of 60000', () => {
    expect(DEFAULT_RETENTION.gcIntervalMs).toBe(60_000);
  });
});
