import { createLogger } from '../logger.js';

const log = createLogger('relay:quotas');

export interface RelayReservation {
  peerId: string;
  grantedAt: number;
  expiresAt: number;
  maxStreams: number;
  maxBytes: number;
  usedBytes: number;
  activeStreams: number;
}

export interface RelayQuotaConfig {
  maxReservationsPerPeer: number;  // default 2
  maxTotalReservations: number;    // default 20
  defaultDurationSec: number;      // default 300 (5 min)
  maxDurationSec: number;          // default 600 (10 min)
  defaultMaxStreams: number;        // default 4
  defaultMaxBytes: number;          // default 16 MB
}

export const DEFAULT_RELAY_QUOTA: RelayQuotaConfig = {
  maxReservationsPerPeer: 2,
  maxTotalReservations: 20,
  defaultDurationSec: 300,
  maxDurationSec: 600,
  defaultMaxStreams: 4,
  defaultMaxBytes: 16 * 1024 * 1024,
};

export class RelayQuotaManager {
  private reservations = new Map<string, RelayReservation[]>();
  private config: RelayQuotaConfig;

  constructor(config?: Partial<RelayQuotaConfig>) {
    this.config = { ...DEFAULT_RELAY_QUOTA, ...config };
  }

  // Try to reserve relay capacity for a peer
  reserve(
    peerId: string,
    requestedDurationSec?: number,
    requestedMaxStreams?: number,
    requestedMaxBytes?: number,
  ): RelayReservation | null {
    this.cleanup();

    // Check per-peer limit
    const existing = this.reservations.get(peerId) ?? [];
    if (existing.length >= this.config.maxReservationsPerPeer) {
      log.warn(`Relay reservation denied: per-peer limit for ${peerId.slice(0, 12)}...`);
      return null;
    }

    // Check total limit
    let total = 0;
    for (const rs of this.reservations.values()) total += rs.length;
    if (total >= this.config.maxTotalReservations) {
      log.warn('Relay reservation denied: total capacity');
      return null;
    }

    const duration = Math.min(
      requestedDurationSec ?? this.config.defaultDurationSec,
      this.config.maxDurationSec,
    );
    const now = Date.now();

    const reservation: RelayReservation = {
      peerId,
      grantedAt: now,
      expiresAt: now + duration * 1000,
      maxStreams: requestedMaxStreams ?? this.config.defaultMaxStreams,
      maxBytes: requestedMaxBytes ?? this.config.defaultMaxBytes,
      usedBytes: 0,
      activeStreams: 0,
    };

    existing.push(reservation);
    this.reservations.set(peerId, existing);
    log.info(`Relay reserved for ${peerId.slice(0, 12)}..., ${duration}s`);
    return reservation;
  }

  // Check if a peer has an active reservation
  hasReservation(peerId: string): boolean {
    this.cleanup();
    const rs = this.reservations.get(peerId) ?? [];
    return rs.some(r => r.expiresAt > Date.now());
  }

  // Record bytes used — returns false if budget exceeded
  recordBytes(peerId: string, bytes: number): boolean {
    const rs = this.reservations.get(peerId) ?? [];
    const active = rs.find(r => r.expiresAt > Date.now());
    if (!active) return false;
    active.usedBytes += bytes;
    return active.usedBytes <= active.maxBytes;
  }

  // Get stats
  getStats(): { totalReservations: number; peersWithReservations: number } {
    this.cleanup();
    let total = 0;
    for (const rs of this.reservations.values()) total += rs.length;
    return { totalReservations: total, peersWithReservations: this.reservations.size };
  }

  // Remove expired reservations
  private cleanup(): void {
    const now = Date.now();
    for (const [peerId, rs] of this.reservations) {
      const active = rs.filter(r => r.expiresAt > now);
      if (active.length === 0) {
        this.reservations.delete(peerId);
      } else {
        this.reservations.set(peerId, active);
      }
    }
  }
}
