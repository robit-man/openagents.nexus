import { createLogger } from '../logger.js';

const log = createLogger('security:rate-limit');

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private maxTokens: number;
  private refillRate: number; // tokens per second

  constructor(maxTokens: number, refillRatePerSecond: number) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRatePerSecond;
  }

  // Returns true if the action is allowed, false if rate-limited
  allow(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    log.warn(`Rate limited: ${key}`);
    return false;
  }

  // Clean up stale buckets (call periodically)
  cleanup(maxAgeMs: number = 300_000): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > maxAgeMs) {
        this.buckets.delete(key);
      }
    }
  }
}
