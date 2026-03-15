/**
 * EIP-712 Typed Data for USDC Transfers (EIP-3009)
 *
 * Implements the `transferWithAuthorization` signing and verification
 * for USDC on Base (Chain ID 8453). Uses viem for all cryptographic
 * operations — no external signing services.
 */

import type { PrivateKeyAccount } from 'viem/accounts';
import { verifyTypedData } from 'viem';
import { createLogger } from '../logger.js';

const log = createLogger('x402:eip712');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** USDC contract address on Base mainnet */
export const USDC_BASE_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

/** Base chain ID */
export const BASE_CHAIN_ID = 8453;

/** EIP-712 domain separator for USDC on Base */
export const USDC_EIP712_DOMAIN = {
  name: 'USD Coin' as const,
  version: '2' as const,
  chainId: BASE_CHAIN_ID,
  verifyingContract: USDC_BASE_ADDRESS,
} as const;

/** EIP-3009 TransferWithAuthorization typed data */
export const TRANSFER_WITH_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The message payload for a TransferWithAuthorization signature */
export interface TransferAuthMessage {
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: `0x${string}`;
}

// ---------------------------------------------------------------------------
// Signing & Verification
// ---------------------------------------------------------------------------

/**
 * Sign a TransferWithAuthorization message using the agent's wallet.
 * Returns an EIP-712 signature (0x-prefixed hex).
 */
export async function signPaymentAuthorization(
  account: PrivateKeyAccount,
  message: TransferAuthMessage,
): Promise<`0x${string}`> {
  const signature = await account.signTypedData({
    domain: USDC_EIP712_DOMAIN,
    types: TRANSFER_WITH_AUTH_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  });
  log.info(`Signed payment authorization: ${message.value} to ${message.to}`);
  return signature;
}

/**
 * Verify an EIP-712 signature against a claimed signer address.
 * Pure crypto — no network calls needed.
 */
export async function verifyPaymentSignature(
  address: `0x${string}`,
  message: TransferAuthMessage,
  signature: `0x${string}`,
): Promise<boolean> {
  try {
    const valid = await verifyTypedData({
      address,
      domain: USDC_EIP712_DOMAIN,
      types: TRANSFER_WITH_AUTH_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
      signature,
    });
    return valid;
  } catch (err) {
    log.warn(`Signature verification error: ${err}`);
    return false;
  }
}

/**
 * Generate a random bytes32 nonce for EIP-3009 authorization.
 * Each authorization must use a unique nonce — the contract rejects replays.
 */
export function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ('0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;
}
