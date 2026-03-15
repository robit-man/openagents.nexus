/**
 * Unit tests for RateLimiter
 *
 * Tests the token-bucket rate limiter used for per-sender enforcement.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('creates a limiter with specified maxTokens and refillRate', () => {
      const limiter = new RateLimiter(10, 1);
      // Should allow the first 10 requests
      for (let i = 0; i < 10; i++) {
        expect(limiter.allow('key')).toBe(true);
      }
      // 11th request should be denied
      expect(limiter.allow('key')).toBe(false);
    });
  });

  describe('allow()', () => {
    it('allows requests up to maxTokens for a new key', () => {
      const limiter = new RateLimiter(5, 1);
      for (let i = 0; i < 5; i++) {
        expect(limiter.allow('user1')).toBe(true);
      }
    });

    it('denies requests once bucket is empty', () => {
      const limiter = new RateLimiter(2, 0.1); // very slow refill
      limiter.allow('user1');
      limiter.allow('user1');
      expect(limiter.allow('user1')).toBe(false);
    });

    it('tracks each key independently', () => {
      const limiter = new RateLimiter(2, 0.1);
      // Exhaust user1
      limiter.allow('user1');
      limiter.allow('user1');
      expect(limiter.allow('user1')).toBe(false);
      // user2 should still have full bucket
      expect(limiter.allow('user2')).toBe(true);
      expect(limiter.allow('user2')).toBe(true);
      expect(limiter.allow('user2')).toBe(false);
    });

    it('refills tokens over time', () => {
      const limiter = new RateLimiter(2, 2); // 2 tokens/sec refill
      // Exhaust the bucket
      limiter.allow('key');
      limiter.allow('key');
      expect(limiter.allow('key')).toBe(false);

      // Advance time by 1 second to get 2 new tokens
      vi.advanceTimersByTime(1000);
      expect(limiter.allow('key')).toBe(true);
      expect(limiter.allow('key')).toBe(true);
      expect(limiter.allow('key')).toBe(false);
    });

    it('does not exceed maxTokens on refill', () => {
      const limiter = new RateLimiter(3, 10); // fast refill
      // Use all tokens
      limiter.allow('key');
      limiter.allow('key');
      limiter.allow('key');
      expect(limiter.allow('key')).toBe(false);

      // Wait a long time — should cap at maxTokens (3)
      vi.advanceTimersByTime(10_000);
      expect(limiter.allow('key')).toBe(true);
      expect(limiter.allow('key')).toBe(true);
      expect(limiter.allow('key')).toBe(true);
      expect(limiter.allow('key')).toBe(false);
    });

    it('initializes new key with full bucket', () => {
      const limiter = new RateLimiter(3, 1);
      expect(limiter.allow('brand-new-key')).toBe(true);
    });

    it('returns true when single token is available', () => {
      const limiter = new RateLimiter(1, 0.1);
      expect(limiter.allow('key')).toBe(true);
      expect(limiter.allow('key')).toBe(false);
    });
  });

  describe('cleanup()', () => {
    it('removes buckets older than maxAgeMs', () => {
      const limiter = new RateLimiter(5, 1);
      limiter.allow('stale-key');

      // Advance time well past the default 5 minute window
      vi.advanceTimersByTime(400_000);
      limiter.cleanup(300_000);

      // After cleanup, the key should have a fresh bucket (full tokens again)
      // We verify by exhausting the new full bucket
      for (let i = 0; i < 5; i++) {
        expect(limiter.allow('stale-key')).toBe(true);
      }
    });

    it('does not remove recently used buckets', () => {
      const limiter = new RateLimiter(2, 0.1);
      // Exhaust the bucket
      limiter.allow('active-key');
      limiter.allow('active-key');

      // Only advance 1 second — well within default 5 min window
      vi.advanceTimersByTime(1000);
      limiter.cleanup(300_000);

      // Bucket should still be exhausted (not reset by cleanup)
      expect(limiter.allow('active-key')).toBe(false);
    });

    it('uses default maxAgeMs of 300_000 when not provided', () => {
      const limiter = new RateLimiter(5, 1);
      limiter.allow('key');

      vi.advanceTimersByTime(400_000); // > 5 min
      limiter.cleanup(); // no arg — should use 300_000

      // Bucket should be gone, so full bucket returns true
      expect(limiter.allow('key')).toBe(true);
    });
  });

  describe('token bucket math', () => {
    it('partial refill grants fractional tokens correctly', () => {
      const limiter = new RateLimiter(10, 2); // 2 tokens/sec
      // Use all 10 tokens
      for (let i = 0; i < 10; i++) limiter.allow('key');
      expect(limiter.allow('key')).toBe(false);

      // Advance 0.4 seconds = 0.8 tokens (< 1 so no allow)
      vi.advanceTimersByTime(400);
      expect(limiter.allow('key')).toBe(false);

      // Advance another 0.1 seconds: total elapsed = 0.5s = 1.0 tokens exactly
      vi.advanceTimersByTime(100);
      expect(limiter.allow('key')).toBe(true);
    });
  });
});
