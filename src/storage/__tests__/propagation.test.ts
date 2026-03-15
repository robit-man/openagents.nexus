/**
 * Unit tests for ContentPropagation
 *
 * Tests the viral content pinning mechanism: when content is received from
 * another peer, it is automatically pinned locally, creating organic redundancy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentPropagation } from '../propagation.js';

const CID_A = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const CID_B = 'bafkreia2whgx6s37eelvekdkbwskyuqzlwtlnk5yjkk6na4is3i2kqzfei';
const CID_C = 'bafkreibm6jg3ux5qumhcn2hiyvhmv3bs5se5j6ofer2dcqe4bpieyd3kxy';

const PEER_A = 'QmPeerAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const PEER_B = 'QmPeerBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('ContentPropagation', () => {
  let propagation: ContentPropagation;
  let pinCallback: ReturnType<typeof vi.fn<(cid: string) => Promise<void>>>;

  beforeEach(() => {
    propagation = new ContentPropagation();
    pinCallback = vi.fn<(cid: string) => Promise<void>>().mockResolvedValue(undefined);
    propagation.setPinCallback(pinCallback);
  });

  // ---------------------------------------------------------------------------
  // Auto-pin when content received
  // ---------------------------------------------------------------------------

  describe('onContentReceived()', () => {
    it('calls the pin callback for each received CID', async () => {
      await propagation.onContentReceived([CID_A, CID_B], PEER_A);
      expect(pinCallback).toHaveBeenCalledTimes(2);
      expect(pinCallback).toHaveBeenCalledWith(CID_A);
      expect(pinCallback).toHaveBeenCalledWith(CID_B);
    });

    it('adds pinned CIDs to local pins', async () => {
      await propagation.onContentReceived([CID_A], PEER_A);
      expect(propagation.getLocalPins()).toContain(CID_A);
    });

    it('does nothing when no pin callback is set', async () => {
      const noCb = new ContentPropagation();
      // Should not throw even with no callback
      await expect(noCb.onContentReceived([CID_A], PEER_A)).resolves.toBeUndefined();
    });

    it('does nothing when autopin is disabled', async () => {
      propagation.setAutopin(false);
      await propagation.onContentReceived([CID_A], PEER_A);
      expect(pinCallback).not.toHaveBeenCalled();
      expect(propagation.getLocalPins()).not.toContain(CID_A);
    });

    // Deduplication: don't pin the same CID twice
    it('does not call pin callback for a CID already pinned', async () => {
      await propagation.onContentReceived([CID_A], PEER_A);
      pinCallback.mockClear();

      await propagation.onContentReceived([CID_A], PEER_B);
      expect(pinCallback).not.toHaveBeenCalled();
    });

    it('still tracks new source even when CID is already pinned', async () => {
      await propagation.onContentReceived([CID_A], PEER_A);
      await propagation.onContentReceived([CID_A], PEER_B);
      // Both peers should be known sources
      expect(propagation.getPopularity(CID_A)).toBeGreaterThanOrEqual(2);
    });

    it('does not add CID to localPins if pin callback throws', async () => {
      pinCallback.mockRejectedValueOnce(new Error('pin failed'));
      await propagation.onContentReceived([CID_A], PEER_A);
      expect(propagation.getLocalPins()).not.toContain(CID_A);
    });

    it('continues pinning subsequent CIDs even if one throws', async () => {
      pinCallback
        .mockRejectedValueOnce(new Error('pin failed'))
        .mockResolvedValueOnce(undefined);

      await propagation.onContentReceived([CID_A, CID_B], PEER_A);
      // CID_A failed, CID_B should still be pinned
      expect(propagation.getLocalPins()).not.toContain(CID_A);
      expect(propagation.getLocalPins()).toContain(CID_B);
    });

    it('handles an empty CID array without calling pin callback', async () => {
      await propagation.onContentReceived([], PEER_A);
      expect(pinCallback).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // CID source tracking
  // ---------------------------------------------------------------------------

  describe('source tracking', () => {
    it('records the source peer for a received CID', async () => {
      await propagation.onContentReceived([CID_A], PEER_A);
      // Popularity includes local + sources; at minimum sources size > 0
      expect(propagation.getPopularity(CID_A)).toBeGreaterThanOrEqual(1);
    });

    it('tracks multiple different sources for the same CID', async () => {
      // Peer A sends CID_A, then Peer B also sends CID_A
      await propagation.onContentReceived([CID_A], PEER_A);
      await propagation.onContentReceived([CID_A], PEER_B);
      // Both should be in sources; popularity >= 2 (sources) + 1 (local) = 3
      expect(propagation.getPopularity(CID_A)).toBeGreaterThanOrEqual(2);
    });

    it('does not double-count the same source peer', async () => {
      await propagation.onContentReceived([CID_A], PEER_A);
      const pop1 = propagation.getPopularity(CID_A);
      await propagation.onContentReceived([CID_A], PEER_A);
      const pop2 = propagation.getPopularity(CID_A);
      expect(pop2).toBe(pop1); // Same peer should not increase count
    });

    it('tracks sources independently for different CIDs', async () => {
      await propagation.onContentReceived([CID_A], PEER_A);
      await propagation.onContentReceived([CID_B], PEER_B);
      // CID_A should not know about PEER_B
      // We can verify by checking popularity — CID_A has 1 source + 1 local = 2
      // CID_B has 1 source + 1 local = 2
      expect(propagation.getPopularity(CID_A)).toBeGreaterThanOrEqual(1);
      expect(propagation.getPopularity(CID_B)).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Popularity tracking
  // ---------------------------------------------------------------------------

  describe('getPopularity()', () => {
    it('returns 0 for an unknown CID', () => {
      expect(propagation.getPopularity(CID_A)).toBe(0);
    });

    it('returns 1 for a locally tracked CID with no external sources', () => {
      propagation.trackLocalContent(CID_A);
      expect(propagation.getPopularity(CID_A)).toBe(1);
    });

    it('returns at least 2 when locally pinned and seen from one peer', async () => {
      await propagation.onContentReceived([CID_A], PEER_A);
      // Now local (auto-pinned) + PEER_A as source = 2
      expect(propagation.getPopularity(CID_A)).toBeGreaterThanOrEqual(2);
    });

    it('increases when more peers are seen as sources', async () => {
      await propagation.onContentReceived([CID_A], PEER_A);
      const pop1 = propagation.getPopularity(CID_A);
      await propagation.onContentReceived([CID_A], PEER_B);
      const pop2 = propagation.getPopularity(CID_A);
      expect(pop2).toBeGreaterThan(pop1);
    });
  });

  // ---------------------------------------------------------------------------
  // trackLocalContent()
  // ---------------------------------------------------------------------------

  describe('trackLocalContent()', () => {
    it('adds the CID to local pins', () => {
      propagation.trackLocalContent(CID_A);
      expect(propagation.getLocalPins()).toContain(CID_A);
    });

    it('does not call the pin callback (tracking only)', () => {
      propagation.trackLocalContent(CID_A);
      expect(pinCallback).not.toHaveBeenCalled();
    });

    it('adds to popularity count', () => {
      propagation.trackLocalContent(CID_A);
      expect(propagation.getPopularity(CID_A)).toBe(1);
    });

    it('is idempotent — calling twice does not duplicate', () => {
      propagation.trackLocalContent(CID_A);
      propagation.trackLocalContent(CID_A);
      expect(propagation.getLocalPins()).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Stats reporting
  // ---------------------------------------------------------------------------

  describe('getStats()', () => {
    it('starts with zeroed stats', () => {
      const stats = propagation.getStats();
      expect(stats.totalPinned).toBe(0);
      expect(stats.pinnedFromOthers).toBe(0);
      expect(stats.trackedCids).toBe(0);
    });

    it('totalPinned reflects local pins', async () => {
      await propagation.onContentReceived([CID_A, CID_B], PEER_A);
      const stats = propagation.getStats();
      expect(stats.totalPinned).toBe(2);
    });

    it('pinnedFromOthers counts CIDs whose source set is non-empty', async () => {
      await propagation.onContentReceived([CID_A], PEER_A);
      const stats = propagation.getStats();
      expect(stats.pinnedFromOthers).toBe(1);
    });

    it('pinnedFromOthers does not count locally-originated content', () => {
      propagation.trackLocalContent(CID_A);
      const stats = propagation.getStats();
      expect(stats.pinnedFromOthers).toBe(0);
    });

    it('trackedCids counts all CIDs seen in onContentReceived', async () => {
      await propagation.onContentReceived([CID_A, CID_B], PEER_A);
      const stats = propagation.getStats();
      expect(stats.trackedCids).toBe(2);
    });

    it('trackedCids does not increase for the same CID from a different peer', async () => {
      await propagation.onContentReceived([CID_A], PEER_A);
      await propagation.onContentReceived([CID_A], PEER_B);
      const stats = propagation.getStats();
      expect(stats.trackedCids).toBe(1);
    });

    it('totalPinned includes both auto-pinned and locally tracked', async () => {
      propagation.trackLocalContent(CID_A);
      await propagation.onContentReceived([CID_B], PEER_A);
      const stats = propagation.getStats();
      expect(stats.totalPinned).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Autopin enable/disable toggle
  // ---------------------------------------------------------------------------

  describe('setAutopin()', () => {
    it('auto-pins by default (autopin enabled)', async () => {
      await propagation.onContentReceived([CID_A], PEER_A);
      expect(pinCallback).toHaveBeenCalledOnce();
    });

    it('disabling autopin prevents future auto-pins', async () => {
      propagation.setAutopin(false);
      await propagation.onContentReceived([CID_A], PEER_A);
      expect(pinCallback).not.toHaveBeenCalled();
    });

    it('re-enabling autopin resumes auto-pinning', async () => {
      propagation.setAutopin(false);
      propagation.setAutopin(true);
      await propagation.onContentReceived([CID_A], PEER_A);
      expect(pinCallback).toHaveBeenCalledOnce();
    });

    it('CIDs received while disabled are still tracked as sources when autopin is re-enabled', async () => {
      propagation.setAutopin(false);
      await propagation.onContentReceived([CID_A], PEER_A);
      propagation.setAutopin(true);

      // CID_A source from PEER_A was tracked but not pinned
      // Now receive again from PEER_B — should pin (first time for local)
      await propagation.onContentReceived([CID_A], PEER_B);
      expect(pinCallback).toHaveBeenCalledWith(CID_A);
    });
  });

  // ---------------------------------------------------------------------------
  // getLocalPins()
  // ---------------------------------------------------------------------------

  describe('getLocalPins()', () => {
    it('starts empty', () => {
      expect(propagation.getLocalPins()).toEqual([]);
    });

    it('returns all locally pinned CIDs', async () => {
      await propagation.onContentReceived([CID_A, CID_B], PEER_A);
      propagation.trackLocalContent(CID_C);
      const pins = propagation.getLocalPins();
      expect(pins).toContain(CID_A);
      expect(pins).toContain(CID_B);
      expect(pins).toContain(CID_C);
      expect(pins).toHaveLength(3);
    });
  });
});
