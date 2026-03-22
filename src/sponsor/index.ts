/**
 * sponsor/index.ts — COHERE Plane 3: Sponsor Pools and Free-Tier Funding
 *
 * Implements treasury management for subsidized inference per the unified
 * COHERE paper (p.43-44). The free tier is a network growth engine, not charity.
 *
 * Revenue split (COHERE proposal, p.46):
 *   70% provider payout
 *   10% commons subsidy pool
 *    8% memory and storage stewardship
 *    7% relay/discovery/bandwidth
 *    5% protocol reserve and dispute handling
 *
 * Provenance: Project COHERE Unified Complete §Free sponsored inference
 */

import { createLogger } from '../logger.js';

const log = createLogger('sponsor');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Revenue split percentages per COHERE paper p.46 */
export const COHERE_REVENUE_SPLIT = {
  provider: 0.70,
  commons: 0.10,
  memory: 0.08,
  relay: 0.07,
  reserve: 0.05,
} as const;

/** Funding sources for inference requests */
export type FundingSource = 'paid' | 'sponsor' | 'provider-credit' | 'mixed';

/** Sponsored request classes per COHERE paper p.44 */
export type SponsoredRequestClass =
  | 'commons-chat'        // everyday assistance
  | 'public-knowledge'    // retrieval/summarization over public corpora
  | 'network-maintenance' // safety, health, diagnostic traffic
  | 'community-research'; // sponsor-approved open research

/** Sponsor pool state */
export interface SponsorPool {
  /** Total USDC balance available for subsidized inference */
  balance: number;
  /** Daily budget cap (resets at epoch boundary) */
  dailyBudget: number;
  /** Spent today */
  dailySpent: number;
  /** Epoch number (increments daily) */
  epoch: number;
  /** Last epoch reset timestamp */
  epochResetAt: string;
  /** Per-class budgets */
  classBudgets: Record<SponsoredRequestClass, number>;
  /** Per-class spent */
  classSpent: Record<SponsoredRequestClass, number>;
}

/** Free-user allocation per COHERE paper p.44 */
export interface FreeUserEnvelope {
  /** Daily or epoch-based base token budget */
  baseTokens: number;
  /** Tokens used today */
  tokensUsed: number;
  /** Queue priority (lower = lower priority for free users) */
  queuePriority: 'low' | 'normal';
  /** Model tier restriction */
  maxModelTier: 'small' | 'medium';
  /** Bonus capacity if user contributes compute/relay/storage */
  contributorBonus: number;
}

/** Contribution credit for users who share resources */
export interface ContributionCredit {
  peerId: string;
  /** What is being contributed */
  type: 'compute' | 'relay' | 'storage' | 'memory-stewardship';
  /** Credit earned (in token equivalents) */
  creditEarned: number;
  /** Period start */
  periodStart: string;
  /** Period end */
  periodEnd: string;
}

// ---------------------------------------------------------------------------
// SponsorPoolManager
// ---------------------------------------------------------------------------

export class SponsorPoolManager {
  private pool: SponsorPool;
  private freeUsers = new Map<string, FreeUserEnvelope>();
  private contributions: ContributionCredit[] = [];

  constructor(initialBalance = 0, dailyBudget = 100) {
    const now = new Date();
    this.pool = {
      balance: initialBalance,
      dailyBudget,
      dailySpent: 0,
      epoch: 1,
      epochResetAt: now.toISOString(),
      classBudgets: {
        'commons-chat': dailyBudget * 0.4,
        'public-knowledge': dailyBudget * 0.3,
        'network-maintenance': dailyBudget * 0.15,
        'community-research': dailyBudget * 0.15,
      },
      classSpent: {
        'commons-chat': 0,
        'public-knowledge': 0,
        'network-maintenance': 0,
        'community-research': 0,
      },
    };
  }

  /** Check if a free request can be funded */
  canFundRequest(
    requestClass: SponsoredRequestClass,
    estimatedCost: number,
  ): boolean {
    if (this.pool.dailySpent + estimatedCost > this.pool.dailyBudget) return false;
    if (this.pool.classSpent[requestClass] + estimatedCost > this.pool.classBudgets[requestClass]) return false;
    if (this.pool.balance < estimatedCost) return false;
    return true;
  }

  /** Reserve funds for a sponsored request */
  reserveFunds(requestClass: SponsoredRequestClass, amount: number): boolean {
    if (!this.canFundRequest(requestClass, amount)) return false;
    this.pool.balance -= amount;
    this.pool.dailySpent += amount;
    this.pool.classSpent[requestClass] += amount;
    log.info(`Sponsor pool: reserved $${amount.toFixed(4)} for ${requestClass} (remaining: $${this.pool.balance.toFixed(4)})`);
    return true;
  }

  /** Deposit funds into the sponsor pool */
  deposit(amount: number, source: string): void {
    this.pool.balance += amount;
    log.info(`Sponsor pool: +$${amount.toFixed(4)} from ${source} (total: $${this.pool.balance.toFixed(4)})`);
  }

  /** Apply revenue split from a paid request */
  applyRevenueSplit(totalRevenue: number): {
    provider: number;
    commons: number;
    memory: number;
    relay: number;
    reserve: number;
  } {
    const split = {
      provider: totalRevenue * COHERE_REVENUE_SPLIT.provider,
      commons: totalRevenue * COHERE_REVENUE_SPLIT.commons,
      memory: totalRevenue * COHERE_REVENUE_SPLIT.memory,
      relay: totalRevenue * COHERE_REVENUE_SPLIT.relay,
      reserve: totalRevenue * COHERE_REVENUE_SPLIT.reserve,
    };
    // Auto-deposit commons portion into sponsor pool
    this.pool.balance += split.commons;
    return split;
  }

  /** Get or create a free-user envelope */
  getFreeUserEnvelope(peerId: string): FreeUserEnvelope {
    let env = this.freeUsers.get(peerId);
    if (!env) {
      env = {
        baseTokens: 10000,  // default daily token budget for free users
        tokensUsed: 0,
        queuePriority: 'low',
        maxModelTier: 'medium',
        contributorBonus: 0,
      };
      this.freeUsers.set(peerId, env);
    }
    return env;
  }

  /** Record a contribution credit */
  recordContribution(credit: ContributionCredit): void {
    this.contributions.push(credit);
    // Boost the contributor's free-user envelope
    const env = this.getFreeUserEnvelope(credit.peerId);
    env.contributorBonus += credit.creditEarned;
    env.queuePriority = 'normal'; // contributors get normal priority
    log.info(`Contribution credit: ${credit.peerId} earned ${credit.creditEarned} tokens for ${credit.type}`);
  }

  /** Reset epoch (call at daily boundary) */
  resetEpoch(): void {
    this.pool.epoch++;
    this.pool.dailySpent = 0;
    this.pool.epochResetAt = new Date().toISOString();
    for (const key of Object.keys(this.pool.classSpent) as SponsoredRequestClass[]) {
      this.pool.classSpent[key] = 0;
    }
    // Reset free-user daily usage
    for (const env of this.freeUsers.values()) {
      env.tokensUsed = 0;
    }
    log.info(`Sponsor pool: epoch ${this.pool.epoch} started`);
  }

  /** Get pool state for reporting */
  getState(): Readonly<SponsorPool> {
    return { ...this.pool };
  }

  /** Get all contribution credits */
  getContributions(): readonly ContributionCredit[] {
    return this.contributions;
  }
}
