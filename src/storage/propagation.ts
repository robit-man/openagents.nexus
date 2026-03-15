/**
 * Viral content propagation — automatic pinning of received content
 *
 * When Agent A receives content from Agent B (a chat message referencing CIDs,
 * or content retrieved from the network), Agent A automatically pins those CIDs.
 * This creates organic growth in content redundancy: popular content gets pinned
 * by more agents proportional to how widely it is shared.
 */

import { createLogger } from '../logger.js';
import { isValidCid } from '../security/validators.js';

const log = createLogger('storage:propagation');

// Security bounds — prevent unbounded memory growth and viral amplification attacks
export const MAX_REFS_PER_MESSAGE = 8;
export const MAX_PINNED_CIDS = 10_000;
export const MAX_TRACKED_CIDS = 50_000;
/** Max pin-trigger events per sender per minute */
const MAX_PIN_TRIGGERS_PER_MINUTE = 10;

export interface PropagationStats {
  totalPinned: number;
  pinnedFromOthers: number;
  pinnedByOthers: number; // tracked via DHT announcements
  cidPopularity: Map<string, number>; // CID -> number of known pinners
}

export class ContentPropagation {
  private localPins = new Set<string>();
  private cidSources = new Map<string, Set<string>>(); // CID -> set of peerIds that have it
  private autopinEnabled = true;
  private pinCallback: ((cid: string) => Promise<void>) | null = null;

  // Per-sender rate limiting: tracks pin-trigger counts in the current minute window
  private senderPinCounts = new Map<string, { count: number; windowStart: number }>();

  constructor() {}

  // Set the callback that actually pins content (connected to StorageManager)
  setPinCallback(cb: (cid: string) => Promise<void>): void {
    this.pinCallback = cb;
  }

  // Enable/disable automatic pinning of received content
  setAutopin(enabled: boolean): void {
    this.autopinEnabled = enabled;
    log.info(`Autopin ${enabled ? 'enabled' : 'disabled'}`);
  }

  // Called when we receive a message that references CIDs.
  // This is the viral mechanism: seeing content = pinning content.
  async onContentReceived(cids: string[], sourcePeerId: string): Promise<void> {
    // Clamp the number of references to guard against amplification
    const clampedCids = cids.slice(0, MAX_REFS_PER_MESSAGE);

    // Validate each CID format; skip invalid ones
    const validCids = clampedCids.filter(cid => {
      if (!isValidCid(cid)) {
        log.warn(`Skipping invalid CID from ${sourcePeerId.slice(0, 12)}...: ${cid}`);
        return false;
      }
      return true;
    });

    if (!this.autopinEnabled || !this.pinCallback) {
      // Even when disabled, track sources so we know what is popular
      if (validCids.length > 0) {
        for (const cid of validCids) {
          this._trackSource(cid, sourcePeerId);
        }
      }
      return;
    }

    // Per-sender rate limit: max MAX_PIN_TRIGGERS_PER_MINUTE triggers per minute
    if (!this._checkSenderRateLimit(sourcePeerId)) {
      log.warn(`Rate limiting pin triggers from ${sourcePeerId.slice(0, 12)}...`);
      return;
    }

    for (const cid of validCids) {
      // Track who has this content
      this._trackSource(cid, sourcePeerId);

      // Auto-pin if we haven't already and within bounds
      if (!this.localPins.has(cid)) {
        if (this.localPins.size >= MAX_PINNED_CIDS) {
          // LRU eviction: remove the first (oldest) entry
          const oldest = this.localPins.values().next().value;
          if (oldest !== undefined) {
            this.localPins.delete(oldest);
            log.debug(`LRU evicted pin: ${oldest}`);
          }
        }

        try {
          await this.pinCallback(cid);
          this.localPins.add(cid);
          log.info(`Auto-pinned ${cid} (from ${sourcePeerId.slice(0, 12)}...)`);
        } catch (err) {
          log.debug(`Failed to auto-pin ${cid}: ${err}`);
        }
      }
    }
  }

  // Called when we store our own content locally
  trackLocalContent(cid: string): void {
    this.localPins.add(cid);
  }

  // Get popularity of a CID (number of known pinners: local + peers)
  getPopularity(cid: string): number {
    const sources = this.cidSources.get(cid);
    let count = sources?.size ?? 0;
    if (this.localPins.has(cid)) count++;
    return count;
  }

  // Get aggregate stats
  getStats(): { totalPinned: number; pinnedFromOthers: number; trackedCids: number } {
    const pinnedFromOthers = Array.from(this.localPins).filter(cid => {
      const sources = this.cidSources.get(cid);
      return sources && sources.size > 0;
    }).length;

    return {
      totalPinned: this.localPins.size,
      pinnedFromOthers,
      trackedCids: this.cidSources.size,
    };
  }

  // Get all locally pinned CIDs
  getLocalPins(): string[] {
    return Array.from(this.localPins);
  }

  // ---- Private helpers ----

  private _trackSource(cid: string, sourcePeerId: string): void {
    if (this.cidSources.size >= MAX_TRACKED_CIDS && !this.cidSources.has(cid)) {
      // Cap the tracked CIDs map to avoid unbounded memory growth
      log.warn(`MAX_TRACKED_CIDS (${MAX_TRACKED_CIDS}) reached; dropping source tracking for ${cid}`);
      return;
    }

    if (!this.cidSources.has(cid)) {
      this.cidSources.set(cid, new Set());
    }
    this.cidSources.get(cid)!.add(sourcePeerId);
  }

  private _checkSenderRateLimit(peerId: string): boolean {
    const now = Date.now();
    const windowMs = 60_000; // 1 minute

    let entry = this.senderPinCounts.get(peerId);
    if (!entry || now - entry.windowStart >= windowMs) {
      // Start a new window
      entry = { count: 0, windowStart: now };
      this.senderPinCounts.set(peerId, entry);
    }

    entry.count++;
    return entry.count <= MAX_PIN_TRIGGERS_PER_MINUTE;
  }
}
