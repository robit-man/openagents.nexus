/**
 * Self-Verified Payment Verification via Alchemy RPC
 *
 * Verifies EIP-3009 TransferWithAuthorization proofs by:
 * 1. Checking the EIP-712 signature matches the claimed payer
 * 2. Reading payer's USDC balance on Base via Alchemy
 * 3. Checking the authorization nonce hasn't been used (replay prevention)
 * 4. Validating timestamp bounds (validAfter / validBefore)
 *
 * No Coinbase facilitator — fully self-sovereign verification.
 */

import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import {
  verifyPaymentSignature,
  USDC_BASE_ADDRESS,
  type TransferAuthMessage,
} from './eip712.js';
import { createLogger } from '../logger.js';

const log = createLogger('x402:verifier');

// ---------------------------------------------------------------------------
// Minimal USDC ABI for read operations
// ---------------------------------------------------------------------------

const USDC_READ_ABI = [
  {
    name: 'balanceOf',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [{ name: 'account', type: 'address' as const }],
    outputs: [{ name: '', type: 'uint256' as const }],
  },
  {
    name: 'authorizationState',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [
      { name: 'authorizer', type: 'address' as const },
      { name: 'nonce', type: 'bytes32' as const },
    ],
    outputs: [{ name: '', type: 'bool' as const }],
  },
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerificationResult {
  valid: boolean;
  reason?: string;
  signerAddress?: `0x${string}`;
  balance?: bigint;
}

// ---------------------------------------------------------------------------
// PaymentVerifier
// ---------------------------------------------------------------------------

// Structural interface — avoids viem's chain-specific PublicClient generics
// which are incompatible across L1/L2 transaction type unions.
interface ContractReader {
  readContract(args: Record<string, unknown>): Promise<unknown>;
}

export class PaymentVerifier {
  private client: ContractReader;

  constructor(client: ContractReader) {
    this.client = client;
  }

  /**
   * Create a verifier connected to Base mainnet via Alchemy.
   */
  static create(alchemyApiKey: string): PaymentVerifier {
    const client = createPublicClient({
      chain: base,
      transport: http(`https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`),
    });
    return new PaymentVerifier(client as unknown as ContractReader);
  }

  /**
   * Read a payer's USDC balance on Base.
   */
  async checkBalance(address: `0x${string}`): Promise<bigint> {
    const balance = await this.client.readContract({
      address: USDC_BASE_ADDRESS,
      abi: USDC_READ_ABI,
      functionName: 'balanceOf',
      args: [address],
    }) as bigint;
    return balance;
  }

  /**
   * Check whether an EIP-3009 nonce has already been used.
   * Returns true if the nonce was consumed (i.e., replay detected).
   */
  async checkNonceUsed(authorizer: `0x${string}`, nonce: `0x${string}`): Promise<boolean> {
    return this.client.readContract({
      address: USDC_BASE_ADDRESS,
      abi: USDC_READ_ABI,
      functionName: 'authorizationState',
      args: [authorizer, nonce],
    }) as Promise<boolean>;
  }

  /**
   * Full payment verification pipeline:
   * signature → timestamps → nonce → balance
   */
  async verify(
    from: `0x${string}`,
    message: TransferAuthMessage,
    signature: `0x${string}`,
  ): Promise<VerificationResult> {
    // 1. Verify EIP-712 signature
    const sigValid = await verifyPaymentSignature(from, message, signature);
    if (!sigValid) {
      log.warn(`Signature verification failed for ${from}`);
      return { valid: false, reason: 'Invalid EIP-712 signature' };
    }

    // 2. Check timestamp bounds
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < message.validAfter) {
      return { valid: false, reason: 'Authorization not yet valid', signerAddress: from };
    }
    if (now > message.validBefore) {
      return { valid: false, reason: 'Authorization expired', signerAddress: from };
    }

    // 3. Check nonce hasn't been replayed
    const nonceUsed = await this.checkNonceUsed(from, message.nonce);
    if (nonceUsed) {
      log.warn(`Nonce replay detected for ${from}`);
      return { valid: false, reason: 'Nonce already used (replay)', signerAddress: from };
    }

    // 4. Check payer has sufficient USDC balance
    const balance = await this.checkBalance(from);
    if (balance < message.value) {
      log.warn(`Insufficient balance: ${balance} < ${message.value} for ${from}`);
      return {
        valid: false,
        reason: 'Insufficient USDC balance',
        signerAddress: from,
        balance,
      };
    }

    log.info(`Payment verified: ${message.value} USDC from ${from}`);
    return { valid: true, signerAddress: from, balance };
  }
}
