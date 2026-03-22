/**
 * metering/payout.ts — COHERE Plane 3: Provider Payout Equation
 *
 * Multi-factor provider compensation per unified COHERE paper (p.45).
 * A healthy market should not pay only for output tokens — providers
 * should be compensated for multiple dimensions of value.
 *
 * Formula:
 *   provider_reward = base_compute + context_premium + streaming_bonus
 *                   + warm_bonus + qos_bonus + trust_bonus
 *                   + scarcity_bonus + sponsor_multiplier - penalties
 *
 * Provenance: Project COHERE Unified Complete §Provider monetization
 */

import { createLogger } from '../logger.js';

const log = createLogger('payout');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Inputs for computing provider reward */
export interface PayoutInput {
  /** Input tokens processed */
  inputTokens: number;
  /** Output tokens generated */
  outputTokens: number;
  /** Context window size used */
  contextSize: number;
  /** Whether response was streamed */
  streaming: boolean;
  /** Whether model weights were already loaded (warm) */
  warm: boolean;
  /** Uptime percentage over trailing 24h */
  uptimePercent: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** Provider's dispute rate (0 = perfect, 1 = all disputed) */
  disputeRate: number;
  /** Whether this model/region is scarce (underserved) */
  scarceModel: boolean;
  /** Whether job was sponsored (commons-funded) */
  sponsoredJob: boolean;
}

/** Breakdown of provider reward */
export interface PayoutBreakdown {
  /** Base compute: input/output token work */
  baseCompute: number;
  /** Premium for large context windows */
  contextPremium: number;
  /** Bonus for streaming (interactive) jobs */
  streamingBonus: number;
  /** Bonus for already-loaded model weights */
  warmBonus: number;
  /** Quality of service bonus (uptime + latency) */
  qosBonus: number;
  /** Trust bonus (low dispute rate + honest delivery) */
  trustBonus: number;
  /** Scarcity bonus (rare model or underserved region) */
  scarcityBonus: number;
  /** Multiplier for providers serving sponsored/commons work */
  sponsorMultiplier: number;
  /** Deductions for quality issues */
  penalties: number;
  /** Final reward */
  total: number;
}

/** Configurable payout rates */
export interface PayoutConfig {
  /** Base rate per 1K input tokens (USDC) */
  baseRateIn: number;
  /** Base rate per 1K output tokens (USDC) */
  baseRateOut: number;
  /** Context premium multiplier for windows > 32K */
  contextPremiumRate: number;
  /** Streaming bonus multiplier */
  streamingRate: number;
  /** Warm model bonus multiplier */
  warmRate: number;
  /** Maximum QoS bonus */
  maxQosBonus: number;
  /** Maximum trust bonus */
  maxTrustBonus: number;
  /** Scarcity premium multiplier */
  scarcityRate: number;
  /** Sponsor multiplier (extra for commons work) */
  sponsorRate: number;
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

export const DEFAULT_PAYOUT_CONFIG: PayoutConfig = {
  baseRateIn: 0.0004,     // $0.0004 per 1K input tokens
  baseRateOut: 0.0012,    // $0.0012 per 1K output tokens
  contextPremiumRate: 0.15, // 15% premium for large context
  streamingRate: 0.05,    // 5% bonus for streaming
  warmRate: 0.10,         // 10% bonus for warm weights
  maxQosBonus: 0.05,      // max 5% QoS bonus
  maxTrustBonus: 0.10,    // max 10% trust bonus
  scarcityRate: 0.20,     // 20% scarcity premium
  sponsorRate: 0.08,      // 8% sponsor multiplier
};

// ---------------------------------------------------------------------------
// Payout Calculator
// ---------------------------------------------------------------------------

/**
 * Compute provider reward using COHERE multi-factor payout equation.
 * Per unified COHERE paper p.45.
 */
export function computePayoutBreakdown(
  input: PayoutInput,
  config: PayoutConfig = DEFAULT_PAYOUT_CONFIG,
): PayoutBreakdown {
  // Base compute: token-proportional
  const baseCompute =
    (input.inputTokens / 1000) * config.baseRateIn +
    (input.outputTokens / 1000) * config.baseRateOut;

  // Context premium: reward large context handling
  const contextPremium = input.contextSize > 32768
    ? baseCompute * config.contextPremiumRate * Math.min(1, input.contextSize / 131072)
    : 0;

  // Streaming bonus: reward responsive interactive jobs
  const streamingBonus = input.streaming
    ? baseCompute * config.streamingRate
    : 0;

  // Warm bonus: reward already-loaded model weights (lower startup latency)
  const warmBonus = input.warm
    ? baseCompute * config.warmRate
    : 0;

  // QoS bonus: reward uptime and low latency
  const uptimeFactor = Math.max(0, (input.uptimePercent - 90) / 10); // 0-1 for 90-100%
  const latencyFactor = Math.max(0, 1 - input.avgLatencyMs / 5000); // 0-1 for <5s
  const qosBonus = baseCompute * config.maxQosBonus * (uptimeFactor * 0.5 + latencyFactor * 0.5);

  // Trust bonus: reward low dispute rate and honest delivery
  const trustFactor = Math.max(0, 1 - input.disputeRate * 5); // penalizes >20% dispute rate
  const trustBonus = baseCompute * config.maxTrustBonus * trustFactor;

  // Scarcity bonus: reward rare model or underserved region coverage
  const scarcityBonus = input.scarceModel
    ? baseCompute * config.scarcityRate
    : 0;

  // Sponsor multiplier: extra reward for providers serving subsidized work
  const sponsorMultiplier = input.sponsoredJob
    ? baseCompute * config.sponsorRate
    : 0;

  // Penalties: deductions for quality issues
  const penalties = input.disputeRate > 0.1
    ? baseCompute * input.disputeRate * 0.5
    : 0;

  const total = baseCompute + contextPremium + streamingBonus + warmBonus
    + qosBonus + trustBonus + scarcityBonus + sponsorMultiplier - penalties;

  return {
    baseCompute,
    contextPremium,
    streamingBonus,
    warmBonus,
    qosBonus,
    trustBonus,
    scarcityBonus,
    sponsorMultiplier,
    penalties,
    total: Math.max(0, total),
  };
}
