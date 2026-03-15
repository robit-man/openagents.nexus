/**
 * Viral content propagation — automatic pinning of received content
 *
 * When Agent A receives content from Agent B (a chat message referencing CIDs,
 * or content retrieved from the network), Agent A automatically pins those CIDs.
 * This creates organic growth in content redundancy: popular content gets pinned
 * by more agents proportional to how widely it is shared.
 */

import { createLogger } from '../logger.js';

const log = createLogger('storage:propagation');

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
    if (!this.autopinEnabled || !this.pinCallback) {
      // Even when disabled, track sources so we know what is popular
      if (cids.length > 0) {
        for (const cid of cids) {
          if (!this.cidSources.has(cid)) {
            this.cidSources.set(cid, new Set());
          }
          this.cidSources.get(cid)!.add(sourcePeerId);
        }
      }
      return;
    }

    for (const cid of cids) {
      // Track who has this content
      if (!this.cidSources.has(cid)) {
        this.cidSources.set(cid, new Set());
      }
      this.cidSources.get(cid)!.add(sourcePeerId);

      // Auto-pin if we haven't already
      if (!this.localPins.has(cid)) {
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
}
