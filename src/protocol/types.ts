// Protocol version
export const PROTOCOL_VERSION = 1 as const;

// Custom protocol identifiers
export const PROTOCOLS = {
  DHT: '/nexus/kad/1.1.0',
  SYNC: '/nexus/sync/1.0.0', // legacy, keep for compat
  HANDSHAKE: '/nexus/handshake/1.1.0',
  DM: '/nexus/dm/1.1.0',
  CAPABILITY_INVOKE: '/nexus/invoke/1.1.0',
  CHAT_SYNC: '/nexus/chat-sync/1.1.0',
} as const;

// GossipSub topic prefixes
export const TOPICS = {
  META: '/nexus/meta',
  ROOM_PREFIX: '/nexus/room/',
  EPHEMERAL_PREFIX: '/nexus/ephemeral/',
  CAPABILITY_PREFIX: '/nexus/capability/',
} as const;

// Message types
export type MessageType = 'chat' | 'presence' | 'meta' | 'capability' | 'sync';

// Presence statuses
export type PresenceStatus = 'online' | 'idle' | 'busy' | 'offline';

// Agent roles
export type AgentRole = 'light' | 'full' | 'storage';

// Room types
export type RoomType = 'persistent' | 'ephemeral';

// Room access
export type RoomAccess = 'public' | 'token-gated';

// Content formats
export type ContentFormat = 'text/plain' | 'text/markdown' | 'application/json';

// The core NexusMessage envelope - every message through GossipSub uses this
export interface NexusMessage {
  version: typeof PROTOCOL_VERSION;
  type: MessageType;
  id: string; // UUIDv7
  timestamp: number; // unix ms
  sender: string; // PeerId
  topic: string;
  payload: ChatPayload | PresencePayload | MetaPayload | CapabilityPayload | SyncPayload;
  references: string[]; // CIDs
}

// Type-specific payloads
export interface ChatPayload {
  content: string;
  format: ContentFormat;
  replyTo: string | null;
  threadId: string | null;
}

export interface PresencePayload {
  status: PresenceStatus;
  capabilities: string[];
  agentName: string;
  agentType: string;
  version: string;
}

export interface MetaPayload {
  action: string; // e.g. 'room:created', 'room:updated'
  roomId?: string;
  roomManifest?: string; // CID
  [key: string]: unknown;
}

export interface CapabilityPayload {
  capabilities: CapabilityDefinition[];
}

export interface CapabilityDefinition {
  name: string;
  protocol: string;
  description: string;
  pricing: string;
  rateLimit: string;
}

export interface SyncPayload {
  action: 'request' | 'response';
  since?: number;
  limit?: number;
  // historyRoot REMOVED — history is addressed via checkpoint pointers in DHT
  messageCount?: number;
  oldestTimestamp?: number;
  newestTimestamp?: number;
}

// Agent profile stored in DHT and IPFS
export interface AgentProfile {
  schema: 'nexus:agent-profile:v1';
  peerId: string;
  name: string;
  description: string;
  type: string;
  capabilities: CapabilityDefinition[];
  role: AgentRole;
  transports: string[];
  createdAt: number;
  updatedAt: number;
  previousVersion: string | null;
}

// Room manifest stored in DHT and IPFS
export interface RoomManifest {
  schema: 'nexus:room-manifest:v1';
  roomId: string;
  topic: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: number;
  type: RoomType;
  access: RoomAccess;
  retentionDefaults: {
    recommendedClass: 'ephemeral' | 'cache' | 'retained';
    defaultBatchSize: number;
  };
  // historyRoot REMOVED — replaced by checkpoint pointers in DHT
  memberCount: number;
  previousVersion: string | null;
}

// Handshake protocol messages
export interface HandshakeInit {
  protocolVersion: typeof PROTOCOL_VERSION;
  agentName: string;
  agentType: string;
  capabilities: string[];
  rooms: string[];
  role: AgentRole;
  clientVersion: string;
}

export interface HandshakeAck {
  protocolVersion: typeof PROTOCOL_VERSION;
  agentName: string;
  agentType: string;
  capabilities: string[];
  rooms: string[];
  role: AgentRole;
  clientVersion: string;
}

// ── COHERE Part II: Privacy Scoping (Plane 4, T2.4) ──
// Per unified COHERE paper p.49: memory objects have visibility scope
export type MemoryScope = 'public' | 'guild' | 'paid-cluster' | 'private';

// ── COHERE Part II: Memory Object Model (Plane 4, T2.3) ──
// Per unified COHERE paper p.49: shared memory/brain-state plane
export type MemoryObjectType = 'episode' | 'summary' | 'procedure' | 'belief' | 'policy' | 'relationship' | 'checkpoint' | 'tombstone';

export interface SharedMemoryObject {
  id: string;
  cid?: string;              // content-addressed reference
  author_peer_id: string;
  visibility: MemoryScope;
  scope: MemoryScope;
  timestamp: string;          // ISO-8601
  parent_ids: string[];       // lineage DAG
  confidence: number;         // 0-1
  provenance_refs: string[];  // job:uuid, obs:id
  quality_score: number;      // 0-1
  cost_to_store: number;      // estimated storage cost
  ttl: string;                // e.g., "90d"
  supersedes: string[];       // IDs this object replaces
  signature: string;          // Ed25519 signature
}

// ── COHERE Part II: Memory Delta (Plane 4, T2.3) ──
// Per unified COHERE paper p.54: POST /v1/memory/delta
export interface MemoryDelta {
  delta_id: string;
  scope: MemoryScope;
  type: MemoryObjectType;
  parents: string[];          // CID references
  payload_ref: string;        // CID of new object
  confidence: number;
  provenance_refs: string[];
  supersedes: string[];
  ttl_days: number;
  signature: string;
}

// ── COHERE Part II: Epoch Checkpoint (Plane 4, T2.3) ──
// Per unified COHERE paper p.55: POST /v1/memory/checkpoint
export interface EpochCheckpoint {
  epoch: number;
  root_cid: string;
  accepted_deltas: string[];
  pruned_deltas: string[];
  policy_version: string;
  witnesses: string[];        // peer IDs that signed
  signature: string;
}

// ── COHERE Part II: Capability Advertisement (Plane 2, T1.1) ──
// Per unified COHERE paper p.52: POST /v1/capacity/announce
export interface CapacityAnnouncement {
  peer_id: string;
  region: string;
  models: Array<{
    name: string;
    context: number;
    modalities: string[];
    warm: boolean;
    max_concurrency: number;
    price_in: number;          // per 1K input tokens
    price_out: number;         // per 1K output tokens
  }>;
  supports: {
    chat: boolean;
    embed: boolean;
    tools: boolean;
    stream: boolean;
  };
  free_pool_opt_in: boolean;
  signature: string;
}

// ── COHERE Part II: Settlement Receipt (Plane 3, T1.4) ──
// Per unified COHERE paper p.54: POST /v1/settlement/receipt
export interface SettlementReceipt {
  job_id: string;
  provider_peer_id: string;
  usage_final: {
    input_tokens: number;
    output_tokens: number;
  };
  latency_ms: number;
  quality_flags: string[];
  provider_reward: number;
  commons_contribution: number;
  signature: string;
}

// ── COHERE Part II: Funding Source (Plane 3, T2.2) ──
// Per unified COHERE paper p.53: POST /v1/job/assign
export type FundingSource = 'paid' | 'sponsor' | 'provider-credit' | 'mixed';

// Capability invocation
export interface InvocationRequest {
  requestId: string;
  capability: string;
  input: unknown;
  maxWaitMs: number;
}

export interface InvocationResponse {
  requestId: string;
  status: 'success' | 'error';
  output?: unknown;
  error?: string;
  processingMs: number;
}

// Signaling server API responses
export interface BootstrapResponse {
  peers: string[];
  network: {
    peerCount: number;
    roomCount: number;
    protocolVersion: number;
    minClientVersion: string;
  };
}

export interface NetworkResponse {
  peerCount: number;
  roomCount: number;
  messageRate: number;
  storageProviders: number;
  protocolVersion: number;
  uptime: number;
  rooms: RoomInfo[];
}

export interface RoomInfo {
  roomId: string;
  name: string;
  topic: string;
  memberCount: number;
  type: RoomType;
  access: RoomAccess;
  manifest: string;
}

// Contribution options
export interface ContributeOptions {
  storage?: boolean;
  relay?: boolean;
  mirror?: string[]; // room IDs to mirror
}

// Events
export interface NexusEvents {
  'peer:discovered': (profile: AgentProfile) => void;
  'peer:connected': (peerId: string) => void;
  'peer:disconnected': (peerId: string) => void;
  'error': (error: Error) => void;
}

export interface RoomEvents {
  'message': (msg: NexusMessage) => void;
  'presence': (presence: NexusMessage) => void;
  'sync': (progress: { loaded: number; total: number }) => void;
}
