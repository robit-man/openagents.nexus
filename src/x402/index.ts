/**
 * x402 Payment Rail for Agent-to-Agent Micropayments
 *
 * Enables agents to offer and consume paid services (like inference)
 * using the x402 protocol (HTTP 402 Payment Required).
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

  constructor(config?: Partial<X402Config>) {
    this.config = { ...DEFAULT_X402_CONFIG, ...config };
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

  // Validate a payment proof (STUB — real implementation needs on-chain verification)
  async validatePayment(proof: PaymentProof, terms: PaymentTerms): Promise<boolean> {
    this.showBanner();

    // Basic structural validation
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

    // TODO: Real implementation needs:
    // 1. EIP-712 signature verification
    // 2. On-chain balance check
    // 3. Nonce validation to prevent replay
    // 4. Integration with Coinbase CDP facilitator or direct chain verification
    log.info(`Payment validation stub: would verify ${proof.payment.amount} ${terms.currency} from ${proof.payment.payer}`);

    return true; // STUB — always passes structural validation for now
  }

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
