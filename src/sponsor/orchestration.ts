/**
 * sponsor/orchestration.ts — COHERE Plane 5: Human Orchestration Types
 *
 * Defines the human roles, governance structures, and policy interfaces
 * that keep the intelligence commons human-steered per unified COHERE
 * paper (p.51).
 *
 * The commons remains human-shaped only if human roles are first-class.
 *
 * Provenance: Project COHERE Unified Complete §Human orchestration layer
 */

// ---------------------------------------------------------------------------
// Human Roles (p.51)
// ---------------------------------------------------------------------------

/** All human roles in the COHERE network */
export type HumanRole =
  | 'user'               // consumes inference
  | 'provider'           // hosts models and serves inference
  | 'curator'            // reviews and accepts public memory proposals
  | 'sponsor'            // funds the free-tier subsidy pool
  | 'witness'            // signs checkpoints and attestations
  | 'dispute-reviewer'   // adjudicates quality disputes
  | 'protocol-operator'; // manages protocol-level policy

/** A participant in the network with their roles */
export interface NetworkParticipant {
  peerId: string;
  name: string;
  roles: HumanRole[];
  /** Trust score based on contribution history */
  trustScore: number;
  /** Total value contributed (for reputation) */
  totalContributed: number;
  /** When they joined */
  joinedAt: string;
  /** Last active */
  lastActiveAt: string;
}

// ---------------------------------------------------------------------------
// Supply Orchestration (p.51)
// ---------------------------------------------------------------------------

/** Provider decides what to offer */
export interface ProviderPolicy {
  peerId: string;
  /** Which models to host */
  hostedModels: string[];
  /** What capacity is sellable (vs. reserved for local use) */
  sellableCapacityPercent: number;
  /** What capacity is donated (contributed to sponsor pool) */
  donatedCapacityPercent: number;
  /** Acceptable privacy classes */
  acceptablePrivacyClasses: ('standard' | 'sensitive')[];
  /** Min/max price bounds (USDC per 1K tokens) */
  minPricePerKTokens: number;
  maxPricePerKTokens: number;
  /** Whether to opt into the sponsor/free pool */
  sponsorPoolOptIn: boolean;
}

// ---------------------------------------------------------------------------
// Memory Orchestration (p.51)
// ---------------------------------------------------------------------------

/** Curator decides what public memory to accept */
export interface CurationPolicy {
  /** Minimum confidence score for automatic acceptance */
  autoAcceptConfidence: number;
  /** Minimum witness count for checkpoint signing */
  minWitnessCount: number;
  /** Categories this curator manages */
  managedCategories: string[];
  /** Maximum delta size (bytes) for auto-review */
  maxAutoReviewSize: number;
}

/** A memory proposal awaiting curation */
export interface MemoryProposal {
  deltaId: string;
  proposerPeerId: string;
  type: string;
  content: string;
  confidence: number;
  /** Curator votes: accept/reject with reasons */
  votes: Array<{
    curatorPeerId: string;
    decision: 'accept' | 'reject';
    reason: string;
    timestamp: string;
  }>;
  status: 'pending' | 'accepted' | 'rejected';
  proposedAt: string;
  resolvedAt?: string;
}

// ---------------------------------------------------------------------------
// Economic Orchestration (p.51)
// ---------------------------------------------------------------------------

/** Sponsor decides how to allocate funds */
export interface SponsorPolicy {
  sponsorPeerId: string;
  /** Total committed funds */
  committedFunds: number;
  /** Allocation per request class */
  classAllocations: Record<string, number>;
  /** Region-specific support */
  regionSupport: string[];
  /** Commons-vs-margin preference (0 = all commons, 1 = all margin) */
  commonsVsMargin: number;
  /** Whether to publicize sponsorship */
  publicAttribution: boolean;
}

// ---------------------------------------------------------------------------
// Dispute Resolution (p.51)
// ---------------------------------------------------------------------------

export type DisputeStatus = 'filed' | 'under-review' | 'resolved' | 'escalated';
export type DisputeVerdict = 'provider-fault' | 'consumer-fault' | 'no-fault' | 'unclear';

export interface DisputeCase {
  disputeId: string;
  /** Who filed the dispute */
  filedBy: string;
  /** Who is the dispute against */
  against: string;
  /** The job that is disputed */
  jobId: string;
  /** Nature of the dispute */
  reason: 'quality' | 'non-delivery' | 'overcharge' | 'tampering' | 'abuse';
  /** Evidence provided */
  evidence: string;
  /** Current status */
  status: DisputeStatus;
  /** Reviewer assignments */
  reviewers: string[];
  /** Verdict (when resolved) */
  verdict?: DisputeVerdict;
  /** Resolution actions */
  resolution?: string;
  /** Timestamps */
  filedAt: string;
  resolvedAt?: string;
}

// ---------------------------------------------------------------------------
// Identity Anchoring (p.51-52)
// ---------------------------------------------------------------------------

/** Every user keeps a home node with these roots */
export interface HomeNodeIdentity {
  peerId: string;
  /** Private memory root (local, never shared) */
  privateMemoryRoot: string;
  /** Local policy root (sharing rules, privacy config) */
  localPolicyRoot: string;
  /** Voice/persona defaults */
  voicePersonaDefaults: {
    tone: string;
    prosody: string;
    interruptionPolicy: string;
  };
  /** Local model preference order */
  modelPreferenceOrder: string[];
  /** Personal routing preferences */
  routingPreferences: {
    preferLocal: boolean;
    maxLatencyMs: number;
    maxPricePerKTokens: number;
    trustedProviders: string[];
  };
}
