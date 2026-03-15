import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RelayQuotaManager, DEFAULT_RELAY_QUOTA } from '../quotas.js';

describe('RelayQuotaManager — reserve()', () => {
  let mgr: RelayQuotaManager;

  beforeEach(() => {
    mgr = new RelayQuotaManager();
  });

  it('returns a reservation with correct fields', () => {
    const r = mgr.reserve('peer-a');
    expect(r).not.toBeNull();
    expect(r!.peerId).toBe('peer-a');
    expect(r!.grantedAt).toBeGreaterThan(0);
    expect(r!.expiresAt).toBeGreaterThan(r!.grantedAt);
    expect(r!.maxStreams).toBe(DEFAULT_RELAY_QUOTA.defaultMaxStreams);
    expect(r!.maxBytes).toBe(DEFAULT_RELAY_QUOTA.defaultMaxBytes);
    expect(r!.usedBytes).toBe(0);
    expect(r!.activeStreams).toBe(0);
  });

  it('expiry is set to now + duration * 1000', () => {
    const before = Date.now();
    const r = mgr.reserve('peer-a', 300);
    const after = Date.now();
    expect(r!.expiresAt).toBeGreaterThanOrEqual(before + 300_000);
    expect(r!.expiresAt).toBeLessThanOrEqual(after + 300_000);
  });

  it('caps duration at maxDurationSec', () => {
    const r = mgr.reserve('peer-a', 9999);
    expect(r!.expiresAt - r!.grantedAt).toBeLessThanOrEqual(DEFAULT_RELAY_QUOTA.maxDurationSec * 1000 + 5);
  });

  it('enforces per-peer reservation limit', () => {
    // Default max is 2 per peer
    const r1 = mgr.reserve('peer-b');
    const r2 = mgr.reserve('peer-b');
    const r3 = mgr.reserve('peer-b');
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r3).toBeNull(); // 3rd reservation denied
  });

  it('enforces total reservation limit', () => {
    const smallMgr = new RelayQuotaManager({ maxTotalReservations: 3, maxReservationsPerPeer: 3 });
    smallMgr.reserve('peer-1');
    smallMgr.reserve('peer-2');
    smallMgr.reserve('peer-3');
    const r = smallMgr.reserve('peer-4');
    expect(r).toBeNull();
  });

  it('uses custom maxStreams and maxBytes when provided', () => {
    const r = mgr.reserve('peer-a', undefined, 2, 1024);
    expect(r!.maxStreams).toBe(2);
    expect(r!.maxBytes).toBe(1024);
  });
});

describe('RelayQuotaManager — hasReservation()', () => {
  it('returns true when active reservation exists', () => {
    const mgr = new RelayQuotaManager();
    mgr.reserve('peer-a');
    expect(mgr.hasReservation('peer-a')).toBe(true);
  });

  it('returns false when no reservation made', () => {
    const mgr = new RelayQuotaManager();
    expect(mgr.hasReservation('peer-unknown')).toBe(false);
  });

  it('returns false after reservation expires', () => {
    vi.useFakeTimers();
    const mgr = new RelayQuotaManager({ defaultDurationSec: 1 });
    mgr.reserve('peer-a');
    expect(mgr.hasReservation('peer-a')).toBe(true);
    vi.advanceTimersByTime(2000); // expire the reservation
    expect(mgr.hasReservation('peer-a')).toBe(false);
    vi.useRealTimers();
  });
});

describe('RelayQuotaManager — recordBytes()', () => {
  let mgr: RelayQuotaManager;

  beforeEach(() => {
    mgr = new RelayQuotaManager({ defaultMaxBytes: 100 });
  });

  it('returns true when within budget', () => {
    mgr.reserve('peer-a');
    expect(mgr.recordBytes('peer-a', 50)).toBe(true);
  });

  it('tracks cumulative usage', () => {
    mgr.reserve('peer-a');
    mgr.recordBytes('peer-a', 60);
    // Next call pushes over the 100 byte limit
    expect(mgr.recordBytes('peer-a', 50)).toBe(false);
  });

  it('returns false when budget exactly exceeded', () => {
    mgr.reserve('peer-a');
    mgr.recordBytes('peer-a', 100);
    // usedBytes == maxBytes — still within budget (<=)
    // One more byte exceeds it
    expect(mgr.recordBytes('peer-a', 1)).toBe(false);
  });

  it('returns false when peer has no reservation', () => {
    expect(mgr.recordBytes('no-peer', 10)).toBe(false);
  });
});

describe('RelayQuotaManager — expired reservation cleanup', () => {
  it('removes expired reservations on cleanup triggered by reserve()', () => {
    vi.useFakeTimers();
    const mgr = new RelayQuotaManager({
      maxReservationsPerPeer: 2,
      defaultDurationSec: 1,
    });

    mgr.reserve('peer-a');
    mgr.reserve('peer-a'); // fills per-peer limit
    expect(mgr.reserve('peer-a')).toBeNull(); // 3rd is denied

    vi.advanceTimersByTime(2000); // expire both

    // After expiry, a new reserve() triggers cleanup, freeing slots
    const r = mgr.reserve('peer-a');
    expect(r).not.toBeNull();
    vi.useRealTimers();
  });
});

describe('RelayQuotaManager — getStats()', () => {
  it('returns zero stats when empty', () => {
    const mgr = new RelayQuotaManager();
    const stats = mgr.getStats();
    expect(stats.totalReservations).toBe(0);
    expect(stats.peersWithReservations).toBe(0);
  });

  it('returns accurate stats after reservations', () => {
    const mgr = new RelayQuotaManager();
    mgr.reserve('peer-a');
    mgr.reserve('peer-a'); // 2nd for same peer
    mgr.reserve('peer-b');
    const stats = mgr.getStats();
    expect(stats.totalReservations).toBe(3);
    expect(stats.peersWithReservations).toBe(2);
  });

  it('stats exclude expired reservations', () => {
    vi.useFakeTimers();
    const mgr = new RelayQuotaManager({ defaultDurationSec: 1 });
    mgr.reserve('peer-a');
    vi.advanceTimersByTime(2000);
    const stats = mgr.getStats();
    expect(stats.totalReservations).toBe(0);
    expect(stats.peersWithReservations).toBe(0);
    vi.useRealTimers();
  });
});

describe('DEFAULT_RELAY_QUOTA values', () => {
  it('has correct defaults', () => {
    expect(DEFAULT_RELAY_QUOTA.maxReservationsPerPeer).toBe(2);
    expect(DEFAULT_RELAY_QUOTA.maxTotalReservations).toBe(20);
    expect(DEFAULT_RELAY_QUOTA.defaultDurationSec).toBe(300);
    expect(DEFAULT_RELAY_QUOTA.maxDurationSec).toBe(600);
    expect(DEFAULT_RELAY_QUOTA.defaultMaxStreams).toBe(4);
    expect(DEFAULT_RELAY_QUOTA.defaultMaxBytes).toBe(16 * 1024 * 1024);
  });
});
