/**
 * X402PaymentRail unit tests
 *
 * Tests cover construction, service registration, payment term generation,
 * payment cap enforcement, key material detection, and payment proof validation.
 *
 * These tests do NOT require a connected NexusClient or network access.
 * All on-chain validation is stubbed per the current implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { X402PaymentRail } from '../index.js';
import type { ServiceOffering, PaymentProof, PaymentTerms } from '../index.js';
import { DEFAULT_X402_CONFIG } from '../index.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const BASE_PRICE_TERMS: PaymentTerms = {
  amount: '100000',
  currency: 'USDC',
  network: 'base',
  recipient: '0xRecipient',
  description: 'Test service',
  expiresAt: Date.now() + 300_000,
  requestId: 'req-fixture',
};

const BASE_OFFERING: ServiceOffering = {
  serviceId: 'text-summary',
  name: 'Text Summarization',
  description: 'Summarize text documents',
  price: BASE_PRICE_TERMS,
  rateLimit: 10,
  sensitive: false,
};

function makeProof(overrides?: Partial<PaymentProof['payment']>): PaymentProof {
  return {
    signature: '0xdeadbeefdeadbeef',
    payment: {
      requestId: 'req-fixture',
      amount: '100000',
      currency: 'USDC',
      network: 'base',
      recipient: '0xRecipient',
      payer: '0xPayer',
      timestamp: Date.now(),
      ...overrides,
    },
  };
}

function makeTerms(overrides?: Partial<PaymentTerms>): PaymentTerms {
  return {
    ...BASE_PRICE_TERMS,
    requestId: 'req-fixture',
    expiresAt: Date.now() + 300_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('X402PaymentRail — construction', () => {
  it('creates an instance with no config', () => {
    const rail = new X402PaymentRail();
    expect(rail).toBeInstanceOf(X402PaymentRail);
  });

  it('is disabled by default', () => {
    const rail = new X402PaymentRail();
    expect(rail.isEnabled).toBe(false);
  });

  it('can be enabled via config', () => {
    const rail = new X402PaymentRail({ enabled: true });
    expect(rail.isEnabled).toBe(true);
  });

  it('merges partial config with defaults', () => {
    const rail = new X402PaymentRail({ walletAddress: '0xABC' });
    // Still disabled — only walletAddress was overridden
    expect(rail.isEnabled).toBe(false);
  });

  it('starts with no registered services', () => {
    const rail = new X402PaymentRail();
    expect(rail.getServices()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_X402_CONFIG
// ---------------------------------------------------------------------------

describe('DEFAULT_X402_CONFIG', () => {
  it('is disabled', () => {
    expect(DEFAULT_X402_CONFIG.enabled).toBe(false);
  });

  it('has no wallet address by default', () => {
    expect(DEFAULT_X402_CONFIG.walletAddress).toBeUndefined();
  });

  it('caps payments at 1000000 (1 USDC at 6 decimals)', () => {
    expect(DEFAULT_X402_CONFIG.maxPaymentPerRequest).toBe('1000000');
  });

  it('allows USDC only by default', () => {
    expect(DEFAULT_X402_CONFIG.allowedCurrencies).toEqual(['USDC']);
  });

  it('allows base network only by default', () => {
    expect(DEFAULT_X402_CONFIG.allowedNetworks).toEqual(['base']);
  });
});

// ---------------------------------------------------------------------------
// registerService
// ---------------------------------------------------------------------------

describe('X402PaymentRail — registerService', () => {
  let rail: X402PaymentRail;

  beforeEach(() => {
    rail = new X402PaymentRail({ enabled: true, walletAddress: '0xWallet' });
  });

  it('stores the offering so getServices() returns it', () => {
    rail.registerService(BASE_OFFERING);
    const services = rail.getServices();
    expect(services).toHaveLength(1);
    expect(services[0].serviceId).toBe('text-summary');
  });

  it('stores multiple offerings independently', () => {
    rail.registerService(BASE_OFFERING);
    rail.registerService({ ...BASE_OFFERING, serviceId: 'image-caption', name: 'Image Caption' });
    expect(rail.getServices()).toHaveLength(2);
  });

  it('overwrites an existing offering with the same serviceId', () => {
    rail.registerService(BASE_OFFERING);
    rail.registerService({ ...BASE_OFFERING, name: 'Updated Name' });
    const services = rail.getServices();
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe('Updated Name');
  });

  it('warns when sensitive service is registered', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rail.registerService({ ...BASE_OFFERING, sensitive: true });
    // The logger calls console.warn internally
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not warn for non-sensitive services', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // First call shows banner (warn), subsequent calls for non-sensitive should not warn about sensitivity
    rail.registerService(BASE_OFFERING);
    // Reset after banner shown (bannerShown = true now)
    warnSpy.mockClear();
    rail.registerService({ ...BASE_OFFERING, serviceId: 'another', sensitive: false });
    // After banner is shown, non-sensitive registration should not add another warn about sensitivity
    const sensitivityWarnings = warnSpy.mock.calls.filter(args =>
      String(args[0]).includes('sensitive'),
    );
    expect(sensitivityWarnings).toHaveLength(0);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// createPaymentTerms
// ---------------------------------------------------------------------------

describe('X402PaymentRail — createPaymentTerms', () => {
  it('returns null when service is not registered', () => {
    const rail = new X402PaymentRail({ walletAddress: '0xWallet' });
    expect(rail.createPaymentTerms('unknown-service')).toBeNull();
  });

  it('returns null when wallet address is not configured', () => {
    const rail = new X402PaymentRail(); // no walletAddress
    rail.registerService(BASE_OFFERING);
    expect(rail.createPaymentTerms('text-summary')).toBeNull();
  });

  it('returns PaymentTerms with wallet as recipient when configured', () => {
    const rail = new X402PaymentRail({ walletAddress: '0xMyWallet' });
    rail.registerService(BASE_OFFERING);
    const terms = rail.createPaymentTerms('text-summary');
    expect(terms).not.toBeNull();
    expect(terms!.recipient).toBe('0xMyWallet');
  });

  it('copies price fields from the offering', () => {
    const rail = new X402PaymentRail({ walletAddress: '0xMyWallet' });
    rail.registerService(BASE_OFFERING);
    const terms = rail.createPaymentTerms('text-summary');
    expect(terms!.amount).toBe('100000');
    expect(terms!.currency).toBe('USDC');
    expect(terms!.network).toBe('base');
  });

  it('sets expiresAt approximately 5 minutes from now', () => {
    const rail = new X402PaymentRail({ walletAddress: '0xMyWallet' });
    rail.registerService(BASE_OFFERING);
    const before = Date.now();
    const terms = rail.createPaymentTerms('text-summary');
    const after = Date.now();
    expect(terms!.expiresAt).toBeGreaterThanOrEqual(before + 299_000);
    expect(terms!.expiresAt).toBeLessThanOrEqual(after + 300_001);
  });

  it('generates a unique requestId each call', () => {
    const rail = new X402PaymentRail({ walletAddress: '0xMyWallet' });
    rail.registerService(BASE_OFFERING);
    const terms1 = rail.createPaymentTerms('text-summary');
    const terms2 = rail.createPaymentTerms('text-summary');
    expect(terms1!.requestId).not.toBe(terms2!.requestId);
  });
});

// ---------------------------------------------------------------------------
// isWithinCap
// ---------------------------------------------------------------------------

describe('X402PaymentRail — isWithinCap', () => {
  it('returns true for an amount below the cap', () => {
    const rail = new X402PaymentRail({ maxPaymentPerRequest: '1000000' });
    expect(rail.isWithinCap('500000', 'USDC')).toBe(true);
  });

  it('returns true for an amount equal to the cap', () => {
    const rail = new X402PaymentRail({ maxPaymentPerRequest: '1000000' });
    expect(rail.isWithinCap('1000000', 'USDC')).toBe(true);
  });

  it('returns false for an amount above the cap', () => {
    const rail = new X402PaymentRail({ maxPaymentPerRequest: '1000000' });
    expect(rail.isWithinCap('1000001', 'USDC')).toBe(false);
  });

  it('returns true when no cap is configured', () => {
    const rail = new X402PaymentRail({ maxPaymentPerRequest: undefined });
    expect(rail.isWithinCap('999999999', 'USDC')).toBe(true);
  });

  it('returns false for non-numeric amount strings', () => {
    const rail = new X402PaymentRail({ maxPaymentPerRequest: '1000000' });
    expect(rail.isWithinCap('not-a-number', 'USDC')).toBe(false);
  });

  it('handles zero amount', () => {
    const rail = new X402PaymentRail({ maxPaymentPerRequest: '1000000' });
    expect(rail.isWithinCap('0', 'USDC')).toBe(true);
  });

  it('handles very large amounts correctly via BigInt', () => {
    const rail = new X402PaymentRail({ maxPaymentPerRequest: '1000000000000000000' });
    expect(rail.isWithinCap('999999999999999999', 'USDC')).toBe(true);
    expect(rail.isWithinCap('1000000000000000001', 'USDC')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// containsKeyMaterial (static)
// ---------------------------------------------------------------------------

describe('X402PaymentRail.containsKeyMaterial', () => {
  // Positive detections — should return true

  it('detects PEM private key header', () => {
    expect(X402PaymentRail.containsKeyMaterial('-----BEGIN PRIVATE KEY-----\nMIIE...')).toBe(true);
  });

  it('detects RSA private key header', () => {
    expect(X402PaymentRail.containsKeyMaterial('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
  });

  it('detects EC private key header', () => {
    expect(X402PaymentRail.containsKeyMaterial('-----BEGIN EC PRIVATE KEY-----')).toBe(true);
  });

  it('detects generic BEGIN KEY header', () => {
    expect(X402PaymentRail.containsKeyMaterial('here is my -----BEGIN KEY----- data')).toBe(true);
  });

  it('detects Ethereum private key (0x + 64 hex chars)', () => {
    expect(
      X402PaymentRail.containsKeyMaterial(
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      ),
    ).toBe(true);
  });

  it('detects sk_ prefixed API key', () => {
    expect(X402PaymentRail.containsKeyMaterial('sk_test_' + 'x'.repeat(24))).toBe(true);
  });

  it('detects sk- prefixed API key', () => {
    expect(X402PaymentRail.containsKeyMaterial('sk-abc123def456ghi789jkl012mno345')).toBe(true);
  });

  it('detects bearer token in Authorization header', () => {
    expect(
      X402PaymentRail.containsKeyMaterial('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'),
    ).toBe(true);
  });

  it('detects api_key assignment', () => {
    expect(X402PaymentRail.containsKeyMaterial('api_key=abc123xyz')).toBe(true);
  });

  it('detects api-key assignment', () => {
    expect(X402PaymentRail.containsKeyMaterial('api-key: abc123xyz')).toBe(true);
  });

  it('detects apikey= assignment', () => {
    expect(X402PaymentRail.containsKeyMaterial('apikey=abc123xyz')).toBe(true);
  });

  it('detects password assignment', () => {
    expect(X402PaymentRail.containsKeyMaterial('password=hunter2')).toBe(true);
  });

  it('detects password: assignment', () => {
    expect(X402PaymentRail.containsKeyMaterial('password: mysecretpassword123')).toBe(true);
  });

  it('detects generic ...secret pattern', () => {
    expect(
      X402PaymentRail.containsKeyMaterial('abcdefghijklmnopqrstuvwxyzABCDEFGHsecret'),
    ).toBe(true);
  });

  // Negative detections — should return false (normal text)

  it('allows normal prose text', () => {
    expect(X402PaymentRail.containsKeyMaterial('Hello! Please summarize this article.')).toBe(false);
  });

  it('allows JSON without secrets', () => {
    expect(
      X402PaymentRail.containsKeyMaterial('{"action":"summarize","text":"The quick brown fox"}'),
    ).toBe(false);
  });

  it('allows a short hex string (not 64 chars)', () => {
    // 32 hex chars — too short for an ETH private key
    expect(X402PaymentRail.containsKeyMaterial('0xdeadbeef1234567890abcdef12345678')).toBe(false);
  });

  it('allows the word "key" without a PEM header', () => {
    expect(X402PaymentRail.containsKeyMaterial('The key to good writing is clarity.')).toBe(false);
  });

  it('allows empty string', () => {
    expect(X402PaymentRail.containsKeyMaterial('')).toBe(false);
  });

  it('allows URLs with query strings', () => {
    expect(
      X402PaymentRail.containsKeyMaterial('https://example.com/search?q=test&lang=en'),
    ).toBe(false);
  });

  it('allows short sk_ strings under threshold', () => {
    // 'sk_' + 19 chars = 22 total, but pattern requires 20 after the prefix
    expect(X402PaymentRail.containsKeyMaterial('sk_tooshort')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validatePayment
// ---------------------------------------------------------------------------

describe('X402PaymentRail — validatePayment', () => {
  let rail: X402PaymentRail;

  beforeEach(() => {
    rail = new X402PaymentRail({ enabled: true, walletAddress: '0xWallet' });
  });

  it('returns true for a structurally valid proof matching the terms', async () => {
    const terms = makeTerms();
    const proof = makeProof({ requestId: terms.requestId, amount: terms.amount });
    const result = await rail.validatePayment(proof, terms);
    expect(result).toBe(true);
  });

  it('returns false when signature is missing', async () => {
    const terms = makeTerms();
    const proof = { ...makeProof(), signature: '' };
    expect(await rail.validatePayment(proof, terms)).toBe(false);
  });

  it('returns false when proof requestId does not match terms requestId', async () => {
    const terms = makeTerms({ requestId: 'correct-id' });
    const proof = makeProof({ requestId: 'wrong-id', amount: terms.amount });
    expect(await rail.validatePayment(proof, terms)).toBe(false);
  });

  it('returns false when proof amount does not match terms amount', async () => {
    const terms = makeTerms({ amount: '100000' });
    const proof = makeProof({ requestId: terms.requestId, amount: '999999' });
    expect(await rail.validatePayment(proof, terms)).toBe(false);
  });

  it('returns false when payment terms have expired', async () => {
    const expiredTerms = makeTerms({ expiresAt: Date.now() - 1 });
    const proof = makeProof({ requestId: expiredTerms.requestId, amount: expiredTerms.amount });
    expect(await rail.validatePayment(proof, expiredTerms)).toBe(false);
  });

  it('returns false when signature is not a string', async () => {
    const terms = makeTerms();
    const proof = { ...makeProof(), signature: null as unknown as string };
    expect(await rail.validatePayment(proof, terms)).toBe(false);
  });

  it('returns true for terms expiring exactly in the future', async () => {
    const terms = makeTerms({ expiresAt: Date.now() + 10_000 });
    const proof = makeProof({ requestId: terms.requestId, amount: terms.amount });
    expect(await rail.validatePayment(proof, terms)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getServices
// ---------------------------------------------------------------------------

describe('X402PaymentRail — getServices', () => {
  it('returns an empty array when no services are registered', () => {
    const rail = new X402PaymentRail();
    expect(rail.getServices()).toEqual([]);
  });

  it('returns a copy of the registered services', () => {
    const rail = new X402PaymentRail({ walletAddress: '0xWallet' });
    rail.registerService(BASE_OFFERING);
    const services = rail.getServices();
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({ serviceId: 'text-summary' });
  });

  it('reflects all registered services', () => {
    const rail = new X402PaymentRail({ walletAddress: '0xWallet' });
    rail.registerService(BASE_OFFERING);
    rail.registerService({ ...BASE_OFFERING, serviceId: 'svc-b', name: 'Service B' });
    const ids = rail.getServices().map(s => s.serviceId);
    expect(ids).toContain('text-summary');
    expect(ids).toContain('svc-b');
  });
});
