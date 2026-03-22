/**
 * x402/balance.ts — COHERE Plane 3: Two-Balance Model
 *
 * Implements the dual-balance accounting system per unified COHERE paper (p.46).
 * Providers earn both cash-settled credits AND network access credits.
 * This lets providers either cash out or spend earned value back into the commons.
 *
 * Balance A: Cash-settled provider credits (USDC, withdrawable)
 * Balance B: Network access credits (internal, for consuming inference)
 *
 * Provenance: Project COHERE Unified Complete §Two-balance model
 */

import { createLogger } from '../logger.js';

const log = createLogger('balance');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The two distinct balance types per COHERE paper */
export interface DualBalance {
  /** Cash-settled credits — USDC value that can be withdrawn on-chain */
  cashCredits: number;
  /** Network access credits — internal value for consuming inference */
  networkCredits: number;
  /** Total earned (lifetime, for trust scoring) */
  totalEarned: number;
  /** Total spent on network inference */
  totalSpentNetwork: number;
  /** Total withdrawn to on-chain USDC */
  totalWithdrawn: number;
  /** Last updated */
  updatedAt: string;
}

/** Transaction types in the dual-balance ledger */
export type BalanceTransactionType =
  | 'earn_inference'      // Provider earned from serving inference
  | 'earn_relay'          // Provider earned from relay services
  | 'earn_storage'        // Provider earned from memory stewardship
  | 'earn_sponsor_bonus'  // Provider earned sponsor multiplier
  | 'spend_inference'     // Consumer spent on remote inference
  | 'withdraw_cash'       // Provider withdrew to on-chain USDC
  | 'contribution_credit' // Credit for contributing resources
  | 'sponsor_deposit'     // Sponsor deposited funds
  | 'penalty';            // Deduction for quality issues

export interface BalanceTransaction {
  id: string;
  type: BalanceTransactionType;
  /** Which balance is affected */
  balanceType: 'cash' | 'network' | 'both';
  /** Amount (positive = credit, negative = debit) */
  amount: number;
  /** Counterparty peer ID (for earn/spend) */
  counterparty?: string;
  /** Reference (job_id, tx_hash, etc.) */
  reference?: string;
  /** Description */
  description: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// DualBalanceManager
// ---------------------------------------------------------------------------

export class DualBalanceManager {
  private balance: DualBalance;
  private ledger: BalanceTransaction[] = [];
  private readonly maxLedgerSize: number;

  constructor(maxLedgerSize = 10000) {
    this.maxLedgerSize = maxLedgerSize;
    this.balance = {
      cashCredits: 0,
      networkCredits: 0,
      totalEarned: 0,
      totalSpentNetwork: 0,
      totalWithdrawn: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Earn from providing inference — splits into cash + network credits */
  earnFromInference(amount: number, counterparty: string, jobId: string): void {
    // Default split: 80% cash, 20% network credits
    const cashPortion = amount * 0.80;
    const networkPortion = amount * 0.20;

    this.balance.cashCredits += cashPortion;
    this.balance.networkCredits += networkPortion;
    this.balance.totalEarned += amount;
    this.balance.updatedAt = new Date().toISOString();

    this.addTransaction({
      id: `txn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'earn_inference',
      balanceType: 'both',
      amount,
      counterparty,
      reference: jobId,
      description: `Earned $${amount.toFixed(6)} from inference (cash: $${cashPortion.toFixed(6)}, network: $${networkPortion.toFixed(6)})`,
      timestamp: new Date().toISOString(),
    });

    log.info(`Balance: earned $${amount.toFixed(6)} from ${counterparty} (job: ${jobId})`);
  }

  /** Spend network credits on remote inference */
  spendOnInference(amount: number, counterparty: string, jobId: string): boolean {
    if (this.balance.networkCredits < amount) {
      log.warn(`Balance: insufficient network credits ($${this.balance.networkCredits.toFixed(6)} < $${amount.toFixed(6)})`);
      return false;
    }

    this.balance.networkCredits -= amount;
    this.balance.totalSpentNetwork += amount;
    this.balance.updatedAt = new Date().toISOString();

    this.addTransaction({
      id: `txn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'spend_inference',
      balanceType: 'network',
      amount: -amount,
      counterparty,
      reference: jobId,
      description: `Spent $${amount.toFixed(6)} on remote inference`,
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  /** Withdraw cash credits to on-chain USDC */
  withdrawCash(amount: number): boolean {
    if (this.balance.cashCredits < amount) {
      return false;
    }

    this.balance.cashCredits -= amount;
    this.balance.totalWithdrawn += amount;
    this.balance.updatedAt = new Date().toISOString();

    this.addTransaction({
      id: `txn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'withdraw_cash',
      balanceType: 'cash',
      amount: -amount,
      description: `Withdrew $${amount.toFixed(6)} to on-chain USDC`,
      timestamp: new Date().toISOString(),
    });

    log.info(`Balance: withdrew $${amount.toFixed(6)} to on-chain USDC`);
    return true;
  }

  /** Add contribution credits (for users sharing resources) */
  addContributionCredit(amount: number, type: string, peerId: string): void {
    this.balance.networkCredits += amount;
    this.balance.updatedAt = new Date().toISOString();

    this.addTransaction({
      id: `txn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'contribution_credit',
      balanceType: 'network',
      amount,
      counterparty: peerId,
      description: `Contribution credit: ${type} ($${amount.toFixed(6)})`,
      timestamp: new Date().toISOString(),
    });
  }

  /** Get current balance */
  getBalance(): Readonly<DualBalance> {
    return { ...this.balance };
  }

  /** Get recent transactions */
  getTransactions(limit = 50): readonly BalanceTransaction[] {
    return this.ledger.slice(-limit);
  }

  /** Check if user can afford a network spend */
  canAfford(amount: number): boolean {
    return this.balance.networkCredits >= amount;
  }

  // ── Internal ──

  private addTransaction(txn: BalanceTransaction): void {
    this.ledger.push(txn);
    if (this.ledger.length > this.maxLedgerSize) {
      this.ledger = this.ledger.slice(-Math.floor(this.maxLedgerSize * 0.8));
    }
  }
}
