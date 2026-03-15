// Protocol version
export const PROTOCOL_VERSION = 1 as const;

// Custom protocol identifiers
export const PROTOCOLS = {
  DHT: '/nexus/kad/1.0.0',
  SYNC: '/nexus/sync/1.0.0',
  HANDSHAKE: '/nexus/handshake/1.0.0',
  DM: '/nexus/dm/1.0.0',
  CAPABILITY_INVOKE: '/nexus/capability/invoke/1.0.0',
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
export type RoomAccess = 'public';

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
  historyRoot?: string; // CID
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
  retention: {
    policy: 'community-pinned';
    minPinners: number;
    archiveAfterMs: number;
  };
  historyRoot: string | null; // CID
  memberCount: number;
  previousVersion: string | null;
}

// Message page for DAG-based chat history
export interface MessagePage {
  schema: 'nexus:message-page:v1';
  roomId: string;
  pageIndex: number;
  count: number;
  timestamp: {
    first: number;
    last: number;
  };
  messages: StoredMessage[];
  prev: { '/': string } | null; // IPLD link
}

export interface StoredMessage {
  id: string;
  timestamp: number;
  sender: string;
  payload: ChatPayload;
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
