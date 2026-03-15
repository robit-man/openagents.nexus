/**
 * x402 Payment Rail for Agent-to-Agent Micropayments
 *
 * Enables agents to offer and consume paid services (like inference)
 * using the x402 protocol (HTTP 402 Payment Required).
 *
 * Self-verified: EIP-712 signatures are checked locally, and USDC
 * balances / nonce state are read from Base via Alchemy RPC.
 * No Coinbase facilitator — fully self-sovereign verification.
 *
 * SECURITY WARNINGS:
 * ==================
 * - NEVER share wallet private keys over the network
 * - NEVER accept wallet keys from remote peers
 * - NEVER process inference requests that ask for key material
 * - ALWAYS validate payment proofs before performing work
 * - ALWAYS set a max payment cap to prevent drainage
 * - Non-sensitive tasks ONLY — never process PII through paid services
 */

import { createLogger } from '../logger.js';
import type { PaymentTerms, PaymentProof, ServiceOffering, X402Config } from './types.js';
import { DEFAULT_X402_CONFIG } from './types.js';
import { PaymentVerifier, type VerificationResult } from './verifier.js';
import { PaymentSubmitter, type SubmitResult } from './submitter.js';
import {
  generateWallet,
  loadWallet,
  saveWallet,
  loadOrCreateWallet,
  type AgentWallet,
} from './wallet.js';
import {
  signPaymentAuthorization,
  generateNonce,
  type TransferAuthMessage,
} from './eip712.js';

const log = createLogger('x402');

// SAFETY WARNING — displayed on first use
const SAFETY_BANNER = `
+--------------------------------------------------------------+
|  x402 PAYMENT RAIL -- SAFETY NOTICE                         |
|                                                              |
|  NEVER share wallet private keys over the network            |
|  NEVER accept wallet keys from remote peers                  |
|  NEVER send API keys, model creds, or secrets                |
|  NEVER process requests for key material via paid services   |
|  ALWAYS validate payment before performing work              |
|  Non-sensitive tasks ONLY                                    |
+--------------------------------------------------------------+
`;

export class X402PaymentRail {
  private config: X402Config;
  private offerings = new Map<string, ServiceOffering>();
  private bannerShown = false;
  private verifier: PaymentVerifier | null = null;
  private wallet: AgentWallet | null = null;
  private submitter: PaymentSubmitter | null = null;

  constructor(config?: Partial<X402Config>) {
    this.config = { ...DEFAULT_X402_CONFIG, ...config };

    // Initialize on-chain verifier if Alchemy key is provided
    if (config?.alchemyApiKey) {
      this.verifier = PaymentVerifier.create(config.alchemyApiKey);
      log.info('On-chain payment verification enabled via Alchemy');
    }
  }

  // Show safety banner on first use
  private showBanner(): void {
    if (!this.bannerShown) {
      log.warn(SAFETY_BANNER);
      this.bannerShown = true;
    }
  }

  // Check if x402 is enabled
  get isEnabled(): boolean {
    return this.config.enabled;
  }

  // Whether on-chain verification is available
  get hasVerifier(): boolean {
    return this.verifier !== null;
  }

  // Whether a wallet is loaded
  get hasWallet(): boolean {
    return this.wallet !== null;
  }

  // The agent's wallet address (if initialized)
  get walletAddress(): `0x${string}` | undefined {
    return this.wallet?.address;
  }

  // -----------------------------------------------------------------------
  // Wallet management
  // -----------------------------------------------------------------------

  /**
   * Initialize the agent wallet. Loads from keyPath if it exists,
   * otherwise generates a new wallet and saves it.
   * Returns the wallet's Ethereum address.
   */
  initWallet(keyPath?: string): `0x${string}` {
    this.showBanner();

    const path = keyPath ?? this.config.walletKeyPath;
    if (path) {
      this.wallet = loadOrCreateWallet(path);
    } else {
      this.wallet = generateWallet();
      log.warn('No wallet key path configured — wallet will not persist across restarts');
    }

    // Update the config wallet address
    this.config.walletAddress = this.wallet.address;

    // Initialize submitter if we have both wallet + Alchemy
    if (this.config.alchemyApiKey) {
      this.submitter = PaymentSubmitter.create(
        this.wallet.privateKey,
        this.config.alchemyApiKey,
      );
    }

    return this.wallet.address;
  }

  // -----------------------------------------------------------------------
  // Service registration (provider side)
  // -----------------------------------------------------------------------

  // Register a service offering (as a provider)
  registerService(offering: ServiceOffering): void {
    this.showBanner();

    if (offering.sensitive) {
      log.warn(`Service "${offering.name}" is marked as sensitive — ensure no key material is processed`);
    }

    this.offerings.set(offering.serviceId, offering);
    log.info(`Registered service: ${offering.name} (${offering.price.amount} ${offering.price.currency})`);
  }

  // Generate 402 payment terms for a service request
  createPaymentTerms(serviceId: string): PaymentTerms | null {
    const offering = this.offerings.get(serviceId);
    if (!offering) return null;

    if (!this.config.walletAddress) {
      log.error('Cannot create payment terms: no wallet address configured');
      return null;
    }

    return {
      ...offering.price,
      recipient: this.config.walletAddress,
      expiresAt: Date.now() + 300_000, // 5 minute expiry
      requestId: crypto.randomUUID(),
    };
  }

  // -----------------------------------------------------------------------
  // Payment signing (payer side)
  // -----------------------------------------------------------------------

  /**
   * Sign a payment authorization for the given terms.
   * Creates an EIP-3009 TransferWithAuthorization signature that
   * authorizes USDC transfer from this agent to the provider.
   */
  async signPayment(terms: PaymentTerms): Promise<PaymentProof> {
    if (!this.wallet) {
      throw new Error('Wallet not initialized. Call initWallet() first.');
    }

    this.showBanner();

    // Safety cap check
    if (!this.isWithinCap(terms.amount, terms.currency)) {
      throw new Error(
        `Payment ${terms.amount} ${terms.currency} exceeds safety cap ${this.config.maxPaymentPerRequest}`,
      );
    }

    const nonce = generateNonce();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const validBefore = now + 300n; // 5 minutes

    const message: TransferAuthMessage = {
      from: this.wallet.address,
      to: terms.recipient as `0x${string}`,
      value: BigInt(terms.amount),
      validAfter: now,
      validBefore,
      nonce,
    };

    const signature = await signPaymentAuthorization(this.wallet.account, message);

    return {
      signature,
      payment: {
        requestId: terms.requestId,
        amount: terms.amount,
        currency: terms.currency,
        network: terms.network,
        recipient: terms.recipient,
        payer: this.wallet.address,
        timestamp: Date.now(),
      },
      authorization: {
        from: this.wallet.address,
        to: terms.recipient,
        value: terms.amount,
        validAfter: now.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Payment validation (provider side)
  // -----------------------------------------------------------------------

  /**
   * Validate a payment proof against the original terms.
   *
   * Performs structural validation first (requestId, amount, expiry).
   * If an Alchemy-backed verifier is configured AND the proof includes
   * EIP-3009 authorization data, also performs on-chain verification:
   * - EIP-712 signature check
   * - USDC balance check
   * - Nonce replay prevention
   * - Timestamp bound validation
   *
   * Without a verifier, only structural validation is performed (backward compatible).
   */
  async validatePayment(proof: PaymentProof, terms: PaymentTerms): Promise<boolean> {
    this.showBanner();

    // --- Structural validation (always performed) ---

    if (!proof.signature || typeof proof.signature !== 'string') {
      log.warn('Invalid payment proof: missing signature');
      return false;
    }

    if (proof.payment.requestId !== terms.requestId) {
      log.warn('Payment proof requestId mismatch');
      return false;
    }

    if (proof.payment.amount !== terms.amount) {
      log.warn('Payment proof amount mismatch');
      return false;
    }

    if (Date.now() > terms.expiresAt) {
      log.warn('Payment terms expired');
      return false;
    }

    // --- On-chain verification (if verifier + authorization data available) ---

    if (this.verifier && proof.authorization) {
      const message: TransferAuthMessage = {
        from: proof.authorization.from as `0x${string}`,
        to: proof.authorization.to as `0x${string}`,
        value: BigInt(proof.authorization.value),
        validAfter: BigInt(proof.authorization.validAfter),
        validBefore: BigInt(proof.authorization.validBefore),
        nonce: proof.authorization.nonce as `0x${string}`,
      };

      const result = await this.verifier.verify(
        proof.authorization.from as `0x${string}`,
        message,
        proof.signature as `0x${string}`,
      );

      if (!result.valid) {
        log.warn(`On-chain verification failed: ${result.reason}`);
        return false;
      }

      log.info(`Payment verified on-chain: ${terms.amount} ${terms.currency} from ${proof.payment.payer}`);
      return true;
    }

    // --- Fallback: structural validation passed ---
    log.info(`Payment structural validation passed: ${terms.amount} ${terms.currency} from ${proof.payment.payer}`);
    return true;
  }

  // -----------------------------------------------------------------------
  // Payment submission (provider side — settles on-chain)
  // -----------------------------------------------------------------------

  /**
   * Submit a verified payment authorization to the USDC contract on Base.
   * Call this AFTER validatePayment() returns true.
   * Returns the transaction hash and block number.
   */
  async submitPayment(proof: PaymentProof): Promise<SubmitResult> {
    if (!this.submitter) {
      throw new Error(
        'Submitter not initialized. Set alchemyApiKey and call initWallet() first.',
      );
    }

    if (!proof.authorization) {
      throw new Error('Payment proof missing authorization data — cannot submit on-chain.');
    }

    const message: TransferAuthMessage = {
      from: proof.authorization.from as `0x${string}`,
      to: proof.authorization.to as `0x${string}`,
      value: BigInt(proof.authorization.value),
      validAfter: BigInt(proof.authorization.validAfter),
      validBefore: BigInt(proof.authorization.validBefore),
      nonce: proof.authorization.nonce as `0x${string}`,
    };

    return this.submitter.submit(message, proof.signature as `0x${string}`);
  }

  // -----------------------------------------------------------------------
  // Safety checks
  // -----------------------------------------------------------------------

  // Check if a payment amount is within our safety cap
  isWithinCap(amount: string, currency: string): boolean {
    if (!this.config.maxPaymentPerRequest) return true;

    try {
      const requested = BigInt(amount);
      const cap = BigInt(this.config.maxPaymentPerRequest);

      if (requested > cap) {
        log.warn(`Payment ${amount} ${currency} exceeds cap ${this.config.maxPaymentPerRequest}`);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // List registered services
  getServices(): ServiceOffering[] {
    return Array.from(this.offerings.values());
  }

  // SAFETY: Check if a request payload contains potential key material
  static containsKeyMaterial(input: string): boolean {
    const patterns = [
      /-----BEGIN.*PRIVATE KEY-----/i,
      /-----BEGIN.*KEY-----/i,
      /sk[-_][a-zA-Z0-9_\-]{20,}/,      // Common API key prefixes
      /0x[a-fA-F0-9]{64}/,              // Ethereum private key
      /[a-zA-Z0-9]{32,}secret/i,        // Generic secret patterns
      /api[_-]?key\s*[:=]\s*\S+/i,      // API key assignments
      /bearer\s+[a-zA-Z0-9._\-]{20,}/i, // Bearer tokens
      /password\s*[:=]\s*\S+/i,         // Password assignments
    ];

    return patterns.some(p => p.test(input));
  }
}

export type { PaymentTerms, PaymentProof, ServiceOffering, X402Config } from './types.js';
export { DEFAULT_X402_CONFIG } from './types.js';
export { PaymentVerifier, type VerificationResult } from './verifier.js';
export { PaymentSubmitter, type SubmitResult } from './submitter.js';
export {
  generateWallet,
  loadWallet,
  saveWallet,
  loadOrCreateWallet,
  type AgentWallet,
} from './wallet.js';
export {
  signPaymentAuthorization,
  verifyPaymentSignature,
  generateNonce,
  USDC_BASE_ADDRESS,
  USDC_EIP712_DOMAIN,
  BASE_CHAIN_ID,
  TRANSFER_WITH_AUTH_TYPES,
  type TransferAuthMessage,
} from './eip712.js';
