/**
 * Usage metering engine
 *
 * Records per-request usage (tokens, bytes, duration, payment) and aggregates
 * summaries per peer per service. Supports hooks for audit/alerting.
 * FIFO eviction keeps memory bounded (default 10K records).
 */

import { createLogger } from '../logger.js';

const log = createLogger('metering');

const DEFAULT_MAX_RECORDS = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageRecord {
  id: string;
  timestamp: number;
  peerId: string;
  service: string;
  capability: string;
  direction: 'inbound' | 'outbound';
  inputBytes: number;
  outputBytes: number;
  durationMs: number;
  tokens?: number;
  payment?: {
    amount: string;
    currency: string;
    txHash?: string;
  };
}

export interface PeerUsageSummary {
  peerId: string;
  totalRequests: number;
  totalInputBytes: number;
  totalOutputBytes: number;
  totalDurationMs: number;
  totalTokens: number;
  totalPayments: number;
  services: Map<string, {
    requests: number;
    inputBytes: number;
    outputBytes: number;
    durationMs: number;
  }>;
  firstSeen: number;
  lastSeen: number;
}

export interface UsageFilter {
  peerId?: string;
  service?: string;
  capability?: string;
  direction?: 'inbound' | 'outbound';
  since?: number;
  until?: number;
}

export type MeteringHook = (record: UsageRecord) => void | Promise<void>;

// ---------------------------------------------------------------------------
// MeteringEngine
// ---------------------------------------------------------------------------

export class MeteringEngine {
  private records: UsageRecord[] = [];
  private summaries = new Map<string, PeerUsageSummary>();
  private hooks: MeteringHook[] = [];
  private maxRecords: number;

  constructor(maxRecords = DEFAULT_MAX_RECORDS) {
    this.maxRecords = maxRecords;
  }

  /**
   * Record a usage event. Fires hooks, updates summaries, FIFO-evicts if needed.
   */
  async record(record: UsageRecord): Promise<void> {
    this.records.push(record);

    // FIFO eviction
    while (this.records.length > this.maxRecords) {
      this.records.shift();
    }

    // Update peer summary
    this.updateSummary(record);

    // Fire hooks (errors are logged, not thrown)
    for (const hook of this.hooks) {
      try {
        await hook(record);
      } catch (err) {
        log.debug(`Metering hook error: ${(err as Error).message}`);
      }
    }
  }

  private updateSummary(record: UsageRecord): void {
    let summary = this.summaries.get(record.peerId);
    if (!summary) {
      summary = {
        peerId: record.peerId,
        totalRequests: 0,
        totalInputBytes: 0,
        totalOutputBytes: 0,
        totalDurationMs: 0,
        totalTokens: 0,
        totalPayments: 0,
        services: new Map(),
        firstSeen: record.timestamp,
        lastSeen: record.timestamp,
      };
      this.summaries.set(record.peerId, summary);
    }

    summary.totalRequests++;
    summary.totalInputBytes += record.inputBytes;
    summary.totalOutputBytes += record.outputBytes;
    summary.totalDurationMs += record.durationMs;
    summary.totalTokens += record.tokens ?? 0;
    if (record.payment) {
      summary.totalPayments += parseFloat(record.payment.amount) || 0;
    }
    summary.lastSeen = Math.max(summary.lastSeen, record.timestamp);

    // Per-service breakdown
    const svcKey = record.service || record.capability;
    let svc = summary.services.get(svcKey);
    if (!svc) {
      svc = { requests: 0, inputBytes: 0, outputBytes: 0, durationMs: 0 };
      summary.services.set(svcKey, svc);
    }
    svc.requests++;
    svc.inputBytes += record.inputBytes;
    svc.outputBytes += record.outputBytes;
    svc.durationMs += record.durationMs;
  }

  /**
   * Add a hook that fires on every recorded usage event.
   */
  addHook(hook: MeteringHook): void {
    this.hooks.push(hook);
  }

  /**
   * Remove a previously added hook.
   */
  removeHook(hook: MeteringHook): void {
    const idx = this.hooks.indexOf(hook);
    if (idx >= 0) this.hooks.splice(idx, 1);
  }

  /**
   * Query records with optional filters.
   */
  getRecords(filter?: UsageFilter): UsageRecord[] {
    if (!filter) return [...this.records];

    return this.records.filter(r => {
      if (filter.peerId && r.peerId !== filter.peerId) return false;
      if (filter.service && r.service !== filter.service) return false;
      if (filter.capability && r.capability !== filter.capability) return false;
      if (filter.direction && r.direction !== filter.direction) return false;
      if (filter.since && r.timestamp < filter.since) return false;
      if (filter.until && r.timestamp > filter.until) return false;
      return true;
    });
  }

  /**
   * Get the aggregated usage summary for a peer.
   */
  getSummary(peerId: string): PeerUsageSummary | undefined {
    return this.summaries.get(peerId);
  }

  /**
   * Get all peer summaries.
   */
  getAllSummaries(): PeerUsageSummary[] {
    return Array.from(this.summaries.values());
  }

  /**
   * Total number of records currently held.
   */
  get size(): number {
    return this.records.length;
  }

  /**
   * Clear all records and summaries.
   */
  clear(): void {
    this.records = [];
    this.summaries.clear();
  }
}
