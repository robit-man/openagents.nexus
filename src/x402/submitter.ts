/**
 * On-Chain Payment Execution
 *
 * Submits EIP-3009 `transferWithAuthorization` transactions to the
 * USDC contract on Base via Alchemy RPC. The provider agent calls
 * this after verifying a payment proof to settle the transfer on-chain.
 *
 * The submitting wallet needs Base ETH for gas (separate from the
 * USDC being transferred).
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  hexToSignature,
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { USDC_BASE_ADDRESS, type TransferAuthMessage } from './eip712.js';
import { createLogger } from '../logger.js';

const log = createLogger('x402:submitter');

// ---------------------------------------------------------------------------
// Minimal USDC ABI for transferWithAuthorization
// ---------------------------------------------------------------------------

const USDC_WRITE_ABI = [
  {
    name: 'transferWithAuthorization',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'from', type: 'address' as const },
      { name: 'to', type: 'address' as const },
      { name: 'value', type: 'uint256' as const },
      { name: 'validAfter', type: 'uint256' as const },
      { name: 'validBefore', type: 'uint256' as const },
      { name: 'nonce', type: 'bytes32' as const },
      { name: 'v', type: 'uint8' as const },
      { name: 'r', type: 'bytes32' as const },
      { name: 's', type: 'bytes32' as const },
    ],
    outputs: [],
  },
] as const;

// ---------------------------------------------------------------------------
// Structural interfaces — avoids viem's chain-specific generic incompatibilities
// between L1 and L2 (Base deposit transaction types).
// ---------------------------------------------------------------------------

interface ContractWriter {
  writeContract(args: Record<string, unknown>): Promise<`0x${string}`>;
}

interface TxWaiter {
  waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ blockNumber: bigint }>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubmitResult {
  txHash: `0x${string}`;
  blockNumber: bigint;
}

// ---------------------------------------------------------------------------
// PaymentSubmitter
// ---------------------------------------------------------------------------

export class PaymentSubmitter {
  private walletClient: ContractWriter;
  private publicClient: TxWaiter;

  constructor(walletClient: ContractWriter, publicClient: TxWaiter) {
    this.walletClient = walletClient;
    this.publicClient = publicClient;
  }

  /**
   * Create a submitter with a wallet connected to Base via Alchemy.
   * The wallet must have Base ETH for gas.
   */
  static create(privateKey: `0x${string}`, alchemyApiKey: string): PaymentSubmitter {
    const account = privateKeyToAccount(privateKey);
    const transport = http(`https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`);
    const walletClient = createWalletClient({ account, chain: base, transport });
    const publicClient = createPublicClient({ chain: base, transport });
    return new PaymentSubmitter(
      walletClient as unknown as ContractWriter,
      publicClient as unknown as TxWaiter,
    );
  }

  /**
   * Submit a transferWithAuthorization transaction to the USDC contract.
   * Splits the EIP-712 signature into v, r, s for the contract call.
   * Waits for transaction confirmation before returning.
   */
  async submit(
    message: TransferAuthMessage,
    signature: `0x${string}`,
  ): Promise<SubmitResult> {
    const { v, r, s } = hexToSignature(signature);

    log.info(
      `Submitting transferWithAuthorization: ${message.value} from ${message.from} to ${message.to}`,
    );

    const txHash = await this.walletClient.writeContract({
      chain: base,
      address: USDC_BASE_ADDRESS,
      abi: USDC_WRITE_ABI,
      functionName: 'transferWithAuthorization',
      args: [
        message.from,
        message.to,
        message.value,
        message.validAfter,
        message.validBefore,
        message.nonce,
        Number(v),
        r,
        s,
      ],
    });

    log.info(`Transaction submitted: ${txHash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    log.info(`Transaction confirmed in block ${receipt.blockNumber}`);

    return { txHash, blockNumber: receipt.blockNumber };
  }
}
