/**
 * x402 Payment Rails — Unit Tests
 *
 * Tests cover wallet management, EIP-712 signing/verification round-trips,
 * on-chain verification with mocked RPC, and the full payment flow.
 *
 * NO real chain calls — all Alchemy/RPC interactions are mocked.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';

import {
  generateWallet,
  saveWallet,
  loadWallet,
  loadOrCreateWallet,
} from '../wallet.js';
import {
  signPaymentAuthorization,
  verifyPaymentSignature,
  generateNonce,
  USDC_BASE_ADDRESS,
  USDC_EIP712_DOMAIN,
  BASE_CHAIN_ID,
  type TransferAuthMessage,
} from '../eip712.js';
import { PaymentVerifier, type VerificationResult } from '../verifier.js';
import type { PaymentTerms } from '../types.js';
import { X402PaymentRail } from '../index.js';

// ---------------------------------------------------------------------------
// Shared test setup
// ---------------------------------------------------------------------------

const tmpDir = path.join(os.tmpdir(), `nexus-x402-test-${Date.now()}`);

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Wallet management
// ---------------------------------------------------------------------------

describe('x402 wallet', () => {
  it('generates a wallet with a valid Ethereum address', () => {
    const wallet = generateWallet();
    expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(wallet.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(wallet.account).toBeDefined();
    expect(wallet.account.address).toBe(wallet.address);
  });

  it('generates unique wallets each call', () => {
    const a = generateWallet();
    const b = generateWallet();
    expect(a.address).not.toBe(b.address);
    expect(a.privateKey).not.toBe(b.privateKey);
  });

  it('saves and loads a wallet from disk', () => {
    const keyPath = path.join(tmpDir, 'save-load', 'wallet.key');
    const wallet = generateWallet();
    saveWallet(wallet, keyPath);

    // File exists with correct content
    expect(fs.existsSync(keyPath)).toBe(true);
    const content = fs.readFileSync(keyPath, 'utf-8').trim();
    expect(content).toBe(wallet.privateKey);

    // Load produces the same address
    const loaded = loadWallet(keyPath);
    expect(loaded).not.toBeNull();
    expect(loaded!.address).toBe(wallet.address);
    expect(loaded!.privateKey).toBe(wallet.privateKey);
  });

  it('returns null when loading a non-existent key file', () => {
    const result = loadWallet('/tmp/definitely-does-not-exist-nexus.key');
    expect(result).toBeNull();
  });

  it('returns null for malformed key files', () => {
    const badPath = path.join(tmpDir, 'bad-key', 'wallet.key');
    fs.mkdirSync(path.dirname(badPath), { recursive: true });
    fs.writeFileSync(badPath, 'not-a-valid-key');
    expect(loadWallet(badPath)).toBeNull();
  });

  it('loadOrCreateWallet creates a new wallet when none exists', () => {
    const keyPath = path.join(tmpDir, 'load-or-create-new', 'wallet.key');
    const wallet = loadOrCreateWallet(keyPath);
    expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(fs.existsSync(keyPath)).toBe(true);
  });

  it('loadOrCreateWallet loads an existing wallet', () => {
    const keyPath = path.join(tmpDir, 'load-or-create-existing', 'wallet.key');
    const original = generateWallet();
    saveWallet(original, keyPath);

    const loaded = loadOrCreateWallet(keyPath);
    expect(loaded.address).toBe(original.address);
  });
});

// ---------------------------------------------------------------------------
// EIP-712 signing
// ---------------------------------------------------------------------------

describe('x402 EIP-712', () => {
  it('signs and verifies a payment authorization round-trip', async () => {
    const wallet = generateWallet();
    const recipient = generateWallet();

    const message: TransferAuthMessage = {
      from: wallet.address,
      to: recipient.address,
      value: 1_000_000n, // 1 USDC
      validAfter: 0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000)) + 3600n,
      nonce: generateNonce(),
    };

    const signature = await signPaymentAuthorization(wallet.account, message);
    expect(signature).toMatch(/^0x[a-fA-F0-9]+$/);

    // Verify against the correct signer
    const valid = await verifyPaymentSignature(wallet.address, message, signature);
    expect(valid).toBe(true);
  });

  it('rejects a signature from a different signer', async () => {
    const signer = generateWallet();
    const imposter = generateWallet();

    const message: TransferAuthMessage = {
      from: signer.address,
      to: generateWallet().address,
      value: 500_000n,
      validAfter: 0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000)) + 3600n,
      nonce: generateNonce(),
    };

    const signature = await signPaymentAuthorization(signer.account, message);

    // Verify against wrong address — should fail
    const valid = await verifyPaymentSignature(imposter.address, message, signature);
    expect(valid).toBe(false);
  });

  it('rejects a tampered message', async () => {
    const wallet = generateWallet();

    const message: TransferAuthMessage = {
      from: wallet.address,
      to: generateWallet().address,
      value: 1_000_000n,
      validAfter: 0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000)) + 3600n,
      nonce: generateNonce(),
    };

    const signature = await signPaymentAuthorization(wallet.account, message);

    // Tamper with the amount
    const tampered = { ...message, value: 9_999_999n };
    const valid = await verifyPaymentSignature(wallet.address, tampered, signature);
    expect(valid).toBe(false);
  });

  it('generates unique nonces', () => {
    const nonces = new Set(Array.from({ length: 100 }, () => generateNonce()));
    expect(nonces.size).toBe(100);
  });

  it('nonces are valid bytes32 hex strings', () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  it('exposes correct USDC constants', () => {
    expect(USDC_BASE_ADDRESS).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(BASE_CHAIN_ID).toBe(8453);
    expect(USDC_EIP712_DOMAIN.name).toBe('USD Coin');
    expect(USDC_EIP712_DOMAIN.version).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// PaymentVerifier (mocked RPC)
// ---------------------------------------------------------------------------

describe('PaymentVerifier', () => {
  let mockClient: { readContract: ReturnType<typeof vi.fn> };
  let verifier: PaymentVerifier;
  let payerWallet: ReturnType<typeof generateWallet>;
  let recipientWallet: ReturnType<typeof generateWallet>;
  let message: TransferAuthMessage;
  let signature: `0x${string}`;

  beforeEach(async () => {
    // Create a mock public client
    mockClient = {
      readContract: vi.fn(),
    };
    verifier = new PaymentVerifier(mockClient as any);

    // Generate test wallets and sign a payment
    payerWallet = generateWallet();
    recipientWallet = generateWallet();

    const now = BigInt(Math.floor(Date.now() / 1000));
    message = {
      from: payerWallet.address,
      to: recipientWallet.address,
      value: 1_000_000n, // 1 USDC
      validAfter: now - 60n,
      validBefore: now + 300n,
      nonce: generateNonce(),
    };

    signature = await signPaymentAuthorization(payerWallet.account, message);
  });

  it('verifies a valid payment (sufficient balance, unused nonce)', async () => {
    // Mock: 10 USDC balance, nonce not used
    mockClient.readContract
      .mockResolvedValueOnce(false)      // authorizationState → not used
      .mockResolvedValueOnce(10_000_000n); // balanceOf → 10 USDC

    const result = await verifier.verify(payerWallet.address, message, signature);
    expect(result.valid).toBe(true);
    expect(result.signerAddress).toBe(payerWallet.address);
  });

  it('rejects an invalid signature', async () => {
    const fakeSignature = '0x' + 'ab'.repeat(65) as `0x${string}`;
    const result = await verifier.verify(payerWallet.address, message, fakeSignature);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('signature');
  });

  it('rejects a replayed nonce', async () => {
    // Mock: nonce already used
    mockClient.readContract.mockResolvedValueOnce(true); // authorizationState → used

    const result = await verifier.verify(payerWallet.address, message, signature);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('replay');
  });

  it('rejects insufficient balance', async () => {
    // Mock: nonce unused, but only 0.5 USDC balance
    mockClient.readContract
      .mockResolvedValueOnce(false)      // authorizationState → not used
      .mockResolvedValueOnce(500_000n);  // balanceOf → 0.5 USDC (less than 1 USDC requested)

    const result = await verifier.verify(payerWallet.address, message, signature);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('balance');
  });

  it('rejects an expired authorization', async () => {
    const expiredMessage: TransferAuthMessage = {
      ...message,
      validBefore: BigInt(Math.floor(Date.now() / 1000)) - 60n, // expired 60s ago
    };

    // Re-sign with expired timestamp
    const expiredSig = await signPaymentAuthorization(payerWallet.account, expiredMessage);
    const result = await verifier.verify(payerWallet.address, expiredMessage, expiredSig);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('expired');
  });

  it('rejects a not-yet-valid authorization', async () => {
    const futureMessage: TransferAuthMessage = {
      ...message,
      validAfter: BigInt(Math.floor(Date.now() / 1000)) + 3600n, // valid in 1 hour
    };

    const futureSig = await signPaymentAuthorization(payerWallet.account, futureMessage);
    const result = await verifier.verify(payerWallet.address, futureMessage, futureSig);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not yet valid');
  });

  it('checkBalance reads from USDC contract', async () => {
    mockClient.readContract.mockResolvedValueOnce(5_000_000n);
    const balance = await verifier.checkBalance(payerWallet.address);
    expect(balance).toBe(5_000_000n);
    expect(mockClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'balanceOf',
        args: [payerWallet.address],
      }),
    );
  });

  it('checkNonceUsed reads from USDC contract', async () => {
    const nonce = generateNonce();
    mockClient.readContract.mockResolvedValueOnce(false);
    const used = await verifier.checkNonceUsed(payerWallet.address, nonce);
    expect(used).toBe(false);
    expect(mockClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'authorizationState',
        args: [payerWallet.address, nonce],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// X402PaymentRail — signPayment
// ---------------------------------------------------------------------------

describe('X402PaymentRail — signPayment', () => {
  it('creates a payment proof with authorization data', async () => {
    const rail = new X402PaymentRail({ enabled: true });
    rail.initWallet(); // ephemeral wallet

    const terms: PaymentTerms = {
      amount: '500000',
      currency: 'USDC',
      network: 'base',
      recipient: generateWallet().address,
      description: 'Test service',
      expiresAt: Date.now() + 300_000,
      requestId: 'test-req-1',
    };

    const proof = await rail.signPayment(terms);

    expect(proof.signature).toMatch(/^0x/);
    expect(proof.payment.requestId).toBe('test-req-1');
    expect(proof.payment.amount).toBe('500000');
    expect(proof.payment.payer).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(proof.authorization).toBeDefined();
    expect(proof.authorization!.from).toBe(proof.payment.payer);
    expect(proof.authorization!.to).toBe(terms.recipient);
    expect(proof.authorization!.value).toBe('500000');
    expect(proof.authorization!.nonce).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  it('throws if wallet is not initialized', async () => {
    const rail = new X402PaymentRail({ enabled: true });
    const terms: PaymentTerms = {
      amount: '100000',
      currency: 'USDC',
      network: 'base',
      recipient: '0x1234567890123456789012345678901234567890',
      description: 'Test',
      expiresAt: Date.now() + 300_000,
      requestId: 'test-req-2',
    };

    await expect(rail.signPayment(terms)).rejects.toThrow('Wallet not initialized');
  });

  it('throws if payment exceeds safety cap', async () => {
    const rail = new X402PaymentRail({
      enabled: true,
      maxPaymentPerRequest: '1000000', // 1 USDC cap
    });
    rail.initWallet();

    const terms: PaymentTerms = {
      amount: '2000000', // 2 USDC — over cap
      currency: 'USDC',
      network: 'base',
      recipient: generateWallet().address,
      description: 'Over cap',
      expiresAt: Date.now() + 300_000,
      requestId: 'test-req-3',
    };

    await expect(rail.signPayment(terms)).rejects.toThrow('exceeds safety cap');
  });
});

// ---------------------------------------------------------------------------
// X402PaymentRail — wallet initialization
// ---------------------------------------------------------------------------

describe('X402PaymentRail — initWallet', () => {
  it('initializes an ephemeral wallet', () => {
    const rail = new X402PaymentRail({ enabled: true });
    const address = rail.initWallet();
    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(rail.hasWallet).toBe(true);
    expect(rail.walletAddress).toBe(address);
  });

  it('persists wallet to disk when keyPath is provided', () => {
    const keyPath = path.join(tmpDir, 'rail-wallet', 'wallet.key');
    const rail = new X402PaymentRail({ enabled: true });
    const address = rail.initWallet(keyPath);

    expect(fs.existsSync(keyPath)).toBe(true);

    // Loading again produces the same address
    const rail2 = new X402PaymentRail({ enabled: true });
    const address2 = rail2.initWallet(keyPath);
    expect(address2).toBe(address);
  });

  it('uses walletKeyPath from config', () => {
    const keyPath = path.join(tmpDir, 'config-wallet', 'wallet.key');
    const rail = new X402PaymentRail({ enabled: true, walletKeyPath: keyPath });
    const address = rail.initWallet();

    expect(fs.existsSync(keyPath)).toBe(true);
    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});

// ---------------------------------------------------------------------------
// X402PaymentRail — validatePayment with on-chain verifier
// ---------------------------------------------------------------------------

describe('X402PaymentRail — validatePayment with verifier', () => {
  it('falls back to structural-only when no verifier is configured', async () => {
    const rail = new X402PaymentRail({ enabled: true, walletAddress: '0xWallet' });

    const terms: PaymentTerms = {
      amount: '100000',
      currency: 'USDC',
      network: 'base',
      recipient: '0xWallet',
      description: 'Test',
      expiresAt: Date.now() + 300_000,
      requestId: 'req-test',
    };

    const proof = {
      signature: '0xdeadbeef',
      payment: {
        requestId: 'req-test',
        amount: '100000',
        currency: 'USDC',
        network: 'base',
        recipient: '0xWallet',
        payer: '0xPayer',
        timestamp: Date.now(),
      },
    };

    // Without verifier, structural validation passes
    expect(rail.hasVerifier).toBe(false);
    const result = await rail.validatePayment(proof, terms);
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// X402PaymentRail — submitPayment
// ---------------------------------------------------------------------------

describe('X402PaymentRail — submitPayment', () => {
  it('throws if submitter is not initialized', async () => {
    const rail = new X402PaymentRail({ enabled: true });

    const proof = {
      signature: '0xdeadbeef',
      payment: {
        requestId: 'req-test',
        amount: '100000',
        currency: 'USDC',
        network: 'base',
        recipient: '0xWallet',
        payer: '0xPayer',
        timestamp: Date.now(),
      },
      authorization: {
        from: '0xPayer',
        to: '0xWallet',
        value: '100000',
        validAfter: '0',
        validBefore: '999999999999',
        nonce: generateNonce(),
      },
    };

    await expect(rail.submitPayment(proof)).rejects.toThrow('Submitter not initialized');
  });

  it('throws if proof lacks authorization data (submitter check comes first without Alchemy)', async () => {
    const rail = new X402PaymentRail({ enabled: true });

    const proof = {
      signature: '0xdeadbeef',
      payment: {
        requestId: 'req-test',
        amount: '100000',
        currency: 'USDC',
        network: 'base',
        recipient: '0xWallet',
        payer: '0xPayer',
        timestamp: Date.now(),
      },
    };

    // Without alchemyApiKey + initWallet, submitter is null — hits that check first
    await expect(rail.submitPayment(proof)).rejects.toThrow('Submitter not initialized');
  });
});

// ---------------------------------------------------------------------------
// Full sign → verify round-trip (mocked chain, real crypto)
// ---------------------------------------------------------------------------

describe('x402 full payment round-trip', () => {
  it('sign → verify succeeds with mocked chain reads', async () => {
    // Payer signs
    const payer = new X402PaymentRail({ enabled: true });
    payer.initWallet();

    const recipientAddress = generateWallet().address;
    const terms: PaymentTerms = {
      amount: '1000000',
      currency: 'USDC',
      network: 'base',
      recipient: recipientAddress,
      description: 'Full flow test',
      expiresAt: Date.now() + 300_000,
      requestId: 'roundtrip-req-1',
    };

    const proof = await payer.signPayment(terms);

    // Provider verifies (with mocked chain)
    const mockClient = {
      readContract: vi.fn()
        .mockResolvedValueOnce(false)       // authorizationState → unused nonce
        .mockResolvedValueOnce(50_000_000n), // balanceOf → 50 USDC
    };

    const verifier = new PaymentVerifier(mockClient as any);
    const result = await verifier.verify(
      proof.authorization!.from as `0x${string}`,
      {
        from: proof.authorization!.from as `0x${string}`,
        to: proof.authorization!.to as `0x${string}`,
        value: BigInt(proof.authorization!.value),
        validAfter: BigInt(proof.authorization!.validAfter),
        validBefore: BigInt(proof.authorization!.validBefore),
        nonce: proof.authorization!.nonce as `0x${string}`,
      },
      proof.signature as `0x${string}`,
    );

    expect(result.valid).toBe(true);
    expect(result.signerAddress).toBe(payer.walletAddress);
  });
});
