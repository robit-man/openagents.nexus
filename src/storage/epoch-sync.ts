/**
 * epoch-sync.ts — COHERE Plane 4: Epoch Synchronization Runtime
 *
 * Orchestrates the epoch-based memory convergence cycle per unified COHERE
 * paper (p.49). Instead of synchronizing every mutation instantly, the network
 * uses epochs — batched rounds of propose/score/adopt/checkpoint/prune.
 *
 * Epoch phases:
 *   1. propose — nodes publish candidate memory deltas
 *   2. score — peers, guild curators, or evaluators score proposals
 *   3. adopt — accepted deltas are merged into the current graph
 *   4. checkpoint — a new signed root is published
 *   5. prune — stale or low-value deltas are tombstoned
 *
 * Provenance: Project COHERE Unified Complete §Epoch synchronization model (p.49)
 */

import { createLogger } from '../logger.js';
import type { MemoryDelta, EpochCheckpoint, MemoryScope } from '../protocol/types.js';

const log = createLogger('epoch-sync');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EpochPhase = 'propose' | 'score' | 'adopt' | 'checkpoint' | 'prune' | 'idle';

export interface DeltaProposal {
  delta: MemoryDelta;
  /** Scores from evaluators (peer_id → score 0-1) */
  scores: Map<string, number>;
  /** Whether this proposal has been adopted */
  adopted: boolean;
  /** Whether this proposal has been pruned */
  pruned: boolean;
  proposedAt: number;
}

export interface EpochState {
  /** Current epoch number */
  epoch: number;
  /** Current phase */
  phase: EpochPhase;
  /** Proposals in this epoch */
  proposals: DeltaProposal[];
  /** Accepted delta IDs */
  acceptedDeltaIds: string[];
  /** Pruned delta IDs */
  prunedDeltaIds: string[];
  /** When this epoch started */
  startedAt: number;
  /** When last checkpoint was published */
  lastCheckpointAt: number;
}

export interface EpochSyncConfig {
  /** Minimum time between epochs (ms) — default 5 minutes */
  minEpochIntervalMs: number;
  /** Minimum score for adoption (0-1) — default 0.5 */
  adoptionThreshold: number;
  /** Minimum number of scorers required — default 1 */
  minScorers: number;
  /** Maximum proposals per epoch — default 100 */
  maxProposalsPerEpoch: number;
  /** TTL for unscored proposals (ms) — default 1 hour */
  unscoredTtlMs: number;
}

export const DEFAULT_EPOCH_CONFIG: EpochSyncConfig = {
  minEpochIntervalMs: 5 * 60 * 1000,  // 5 minutes
  adoptionThreshold: 0.5,
  minScorers: 1,
  maxProposalsPerEpoch: 100,
  unscoredTtlMs: 60 * 60 * 1000,  // 1 hour
};

// ---------------------------------------------------------------------------
// EpochSyncOrchestrator
// ---------------------------------------------------------------------------

export class EpochSyncOrchestrator {
  private state: EpochState;
  private config: EpochSyncConfig;
  private checkpointHistory: EpochCheckpoint[] = [];

  constructor(config: Partial<EpochSyncConfig> = {}) {
    this.config = { ...DEFAULT_EPOCH_CONFIG, ...config };
    this.state = {
      epoch: 0,
      phase: 'idle',
      proposals: [],
      acceptedDeltaIds: [],
      prunedDeltaIds: [],
      startedAt: Date.now(),
      lastCheckpointAt: 0,
    };
  }

  /** Get current epoch state */
  getState(): Readonly<EpochState> {
    return { ...this.state };
  }

  /** Get checkpoint history */
  getCheckpoints(): readonly EpochCheckpoint[] {
    return this.checkpointHistory;
  }

  // ── Phase 1: Propose ──

  /**
   * Submit a memory delta proposal for the current epoch.
   * Proposals are collected until the scoring phase begins.
   */
  propose(delta: MemoryDelta): boolean {
    if (this.state.proposals.length >= this.config.maxProposalsPerEpoch) {
      log.warn(`Epoch ${this.state.epoch}: proposal limit reached (${this.config.maxProposalsPerEpoch})`);
      return false;
    }

    this.state.proposals.push({
      delta,
      scores: new Map(),
      adopted: false,
      pruned: false,
      proposedAt: Date.now(),
    });

    if (this.state.phase === 'idle') {
      this.state.phase = 'propose';
    }

    log.info(`Epoch ${this.state.epoch}: proposal ${delta.delta_id} (type=${delta.type}, scope=${delta.scope})`);
    return true;
  }

  // ── Phase 2: Score ──

  /**
   * Score a proposal. Called by peers, curators, or evaluators.
   * Score is 0-1 where 0 = reject and 1 = strongly accept.
   */
  score(deltaId: string, scorerPeerId: string, score: number): boolean {
    const proposal = this.state.proposals.find(p => p.delta.delta_id === deltaId);
    if (!proposal) return false;

    proposal.scores.set(scorerPeerId, Math.max(0, Math.min(1, score)));
    this.state.phase = 'score';

    log.info(`Epoch ${this.state.epoch}: scored ${deltaId} by ${scorerPeerId.slice(0, 8)} = ${score.toFixed(2)}`);
    return true;
  }

  // ── Phase 3-5: Advance Epoch ──

  /**
   * Advance the epoch: adopt scored proposals, checkpoint, and prune.
   * Should be called periodically (e.g., every minEpochIntervalMs).
   * Returns the checkpoint if one was created, or null.
   */
  advanceEpoch(localPeerId: string): EpochCheckpoint | null {
    const now = Date.now();
    if (now - this.state.lastCheckpointAt < this.config.minEpochIntervalMs) {
      return null; // Too soon
    }

    if (this.state.proposals.length === 0) {
      return null; // Nothing to process
    }

    // Phase 3: Adopt — accept proposals with sufficient scores
    const accepted: string[] = [];
    const pruned: string[] = [];

    for (const proposal of this.state.proposals) {
      const scores = Array.from(proposal.scores.values());

      if (scores.length < this.config.minScorers) {
        // Not enough scorers — check if expired
        if (now - proposal.proposedAt > this.config.unscoredTtlMs) {
          proposal.pruned = true;
          pruned.push(proposal.delta.delta_id);
        }
        continue;
      }

      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

      if (avgScore >= this.config.adoptionThreshold) {
        proposal.adopted = true;
        accepted.push(proposal.delta.delta_id);
      } else {
        proposal.pruned = true;
        pruned.push(proposal.delta.delta_id);
      }
    }

    // Phase 4: Checkpoint
    this.state.epoch++;
    const checkpoint: EpochCheckpoint = {
      epoch: this.state.epoch,
      root_cid: `cid:epoch-${this.state.epoch}-${Date.now().toString(36)}`,
      accepted_deltas: accepted,
      pruned_deltas: pruned,
      policy_version: "v1.0.0",
      witnesses: [localPeerId],
      signature: "", // Would be Ed25519 signed in production
    };

    this.checkpointHistory.push(checkpoint);
    if (this.checkpointHistory.length > 100) {
      this.checkpointHistory = this.checkpointHistory.slice(-100);
    }

    // Phase 5: Prune — clear processed proposals
    this.state.proposals = this.state.proposals.filter(p => !p.adopted && !p.pruned);
    this.state.acceptedDeltaIds.push(...accepted);
    this.state.prunedDeltaIds.push(...pruned);
    this.state.lastCheckpointAt = now;
    this.state.phase = this.state.proposals.length > 0 ? 'propose' : 'idle';

    log.info(`Epoch ${this.state.epoch}: checkpoint — accepted=${accepted.length}, pruned=${pruned.length}`);
    return checkpoint;
  }

  /** Get adoption statistics */
  getStats(): {
    epoch: number;
    phase: EpochPhase;
    pendingProposals: number;
    totalAccepted: number;
    totalPruned: number;
    checkpoints: number;
  } {
    return {
      epoch: this.state.epoch,
      phase: this.state.phase,
      pendingProposals: this.state.proposals.length,
      totalAccepted: this.state.acceptedDeltaIds.length,
      totalPruned: this.state.prunedDeltaIds.length,
      checkpoints: this.checkpointHistory.length,
    };
  }
}
