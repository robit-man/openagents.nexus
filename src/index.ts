/**
 * @openagents/nexus — Main entry point
 *
 * Exports the NexusClient class and the full public API for the decentralized
 * agent communication platform.
 */

import { resolveConfig, type NexusConfig } from './config.js';
import { resolveIdentity, type IdentityInfo } from './identity/index.js';
import { createNexusNode } from './node.js';
import { RoomManager } from './chat/index.js';
import { createMetaMessage } from './chat/messages.js';
import { DHTManager } from './dht/index.js';
import { StorageManager } from './storage/index.js';
import { fetchBootstrapPeers } from './signaling/onboarding.js';
import { createLogger } from './logger.js';
import { encodeMessage, roomTopic, TOPICS } from './protocol/index.js';
import type {
  AgentProfile,
  RoomManifest,
  RoomInfo,
  ContributeOptions,
  AgentRole,
} from './protocol/types.js';

// NexusRoom is re-exported below — import it here first so the named export
// precedes the export * from './chat/index.js' re-export (NodeNext ESM guard).
import { NexusRoom } from './chat/index.js';

const log = createLogger('nexus');

// ---------------------------------------------------------------------------
// Public option types
// ---------------------------------------------------------------------------

export interface NexusClientOptions {
  // Identity
  privateKey?: Uint8Array;
  keyStorePath?: string;

  // Network
  bootstrapPeers?: string[];
  signalingServer?: string;

  // Behavior
  role?: AgentRole;
  listenAddresses?: string[];

  // Agent identity
  agentName?: string;
  agentType?: string;

  // Storage
  datastorePath?: string;
}

export interface CreateRoomOptions {
  roomId: string;
  name: string;
  description?: string;
  type?: 'persistent' | 'ephemeral';
  access?: 'public';
}

// ---------------------------------------------------------------------------
// Typed event map
// ---------------------------------------------------------------------------

type NexusEventMap = {
  'peer:discovered': string;
  'peer:connected': string;
  'peer:disconnected': string;
  'error': Error;
};

type NexusEventListener<K extends keyof NexusEventMap> = (value: NexusEventMap[K]) => void;

// ---------------------------------------------------------------------------
// NexusClient
// ---------------------------------------------------------------------------

export class NexusClient {
  private config: NexusConfig;
  private identity: IdentityInfo | null = null;
  private node: any = null; // libp2p node
  private roomManager: RoomManager | null = null;
  private dhtManager: DHTManager | null = null;
  private storageManager: StorageManager;
  private _isConnected = false;
  private listeners = new Map<string, Set<(value: any) => void>>();

  constructor(options?: NexusClientOptions) {
    this.config = resolveConfig(options);
    this.storageManager = new StorageManager();
  }

  // --- Event emitter ---

  on<K extends keyof NexusEventMap>(event: K, listener: NexusEventListener<K>): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as (value: any) => void);
    return this;
  }

  off<K extends keyof NexusEventMap>(event: K, listener: NexusEventListener<K>): this {
    this.listeners.get(event)?.delete(listener as (value: any) => void);
    return this;
  }

  private emit<K extends keyof NexusEventMap>(event: K, value: NexusEventMap[K]): void {
    this.listeners.get(event)?.forEach(fn => fn(value));
  }

  // --- Properties ---

  get peerId(): string {
    if (!this.identity) throw new Error('Not connected');
    return this.identity.peerId;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  // --- Lifecycle ---

  async connect(): Promise<void> {
    if (this._isConnected) return;

    log.info('Connecting to OpenAgents Nexus...');

    // 1. Resolve identity
    this.identity = await resolveIdentity({
      privateKey: this.config.privateKey,
      keyStorePath: this.config.keyStorePath,
    });
    log.info(`Identity: ${this.identity.peerId}`);

    // 2. Fetch bootstrap peers from signaling server (if no explicit peers)
    if (this.config.bootstrapPeers.length === 0) {
      try {
        const bootstrap = await fetchBootstrapPeers(this.config.signalingServer);
        if (bootstrap.peers.length > 0) {
          this.config = resolveConfig({
            ...this.config,
            bootstrapPeers: bootstrap.peers,
          });
        }
      } catch (err) {
        log.warn(`Could not reach signaling server: ${err}`);
        // Continue without bootstrap peers — mDNS will handle LAN discovery
      }
    }

    // 3. Create and start libp2p node
    this.node = await createNexusNode(this.config, this.identity.privateKey);

    // 4. Set up peer events
    this.node.addEventListener('peer:connect', (evt: any) => {
      const remotePeerId = evt.detail.toString();
      log.info(`Peer connected: ${remotePeerId}`);
      this.emit('peer:connected', remotePeerId);
    });

    this.node.addEventListener('peer:disconnect', (evt: any) => {
      const remotePeerId = evt.detail.toString();
      log.info(`Peer disconnected: ${remotePeerId}`);
      this.emit('peer:disconnected', remotePeerId);
    });

    // 5. Initialize managers
    const pubsub = this.node.services.pubsub;
    const dht = this.node.services.dht;

    // Wire ContentPropagation through RoomManager so rooms auto-pin received CIDs
    this.roomManager = new RoomManager(
      this.identity.peerId,
      pubsub,
      {
        name: this.config.agentName,
        type: this.config.agentType,
        capabilities: [],
        version: '0.1.0',
      },
      this.storageManager.propagation,
    );

    this.dhtManager = new DHTManager(dht);

    // 6. Subscribe to meta topic for network-wide announcements
    pubsub.subscribe(TOPICS.META);

    // 7. Publish agent profile to DHT
    const profile: AgentProfile = {
      schema: 'nexus:agent-profile:v1',
      peerId: this.identity.peerId,
      name: this.config.agentName,
      description: '',
      type: this.config.agentType,
      capabilities: [],
      role: this.config.role,
      transports: this.node.getMultiaddrs().map((a: any) => a.toString()),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      previousVersion: null,
    };

    // Don't await DHT publish — it may take time to find peers
    this.dhtManager.registry.publishProfile(profile).catch((err: Error) => {
      log.debug(`DHT profile publish deferred: ${err.message}`);
    });

    this._isConnected = true;
    log.info('Connected to OpenAgents Nexus');
    log.info(
      `Listening on: ${this.node
        .getMultiaddrs()
        .map((a: any) => a.toString())
        .join(', ')}`,
    );
  }

  async disconnect(): Promise<void> {
    if (!this._isConnected) return;

    log.info('Disconnecting...');

    // Leave all rooms
    if (this.roomManager) {
      await this.roomManager.leaveAll();
    }

    // Stop storage
    await this.storageManager.stop();

    // Stop libp2p node
    if (this.node) {
      await this.node.stop();
      this.node = null;
    }

    this._isConnected = false;
    log.info('Disconnected');
  }

  // --- Rooms ---

  async joinRoom(roomId: string): Promise<NexusRoom> {
    this.ensureConnected();
    return this.roomManager!.joinRoom(roomId);
  }

  async createRoom(options: CreateRoomOptions): Promise<NexusRoom> {
    this.ensureConnected();

    // Create room manifest
    const manifest: RoomManifest = {
      schema: 'nexus:room-manifest:v1',
      roomId: options.roomId,
      topic: roomTopic(options.roomId),
      name: options.name,
      description: options.description ?? '',
      createdBy: this.identity!.peerId,
      createdAt: Date.now(),
      type: options.type ?? 'persistent',
      access: options.access ?? 'public',
      retention: {
        policy: 'community-pinned',
        minPinners: 3,
        archiveAfterMs: 604_800_000, // 7 days
      },
      historyRoot: null,
      memberCount: 0,
      previousVersion: null,
    };

    // Publish room manifest to DHT
    await this.dhtManager!.registry.publishRoom(manifest);

    // Announce room creation on meta topic
    const metaMsg = createMetaMessage(this.identity!.peerId, 'room:created', {
      roomId: options.roomId,
    });
    const pubsub = this.node.services.pubsub;
    await pubsub.publish(TOPICS.META, encodeMessage(metaMsg));

    // Join the room
    return this.roomManager!.joinRoom(options.roomId);
  }

  async listRooms(): Promise<RoomInfo[]> {
    // For now, return locally known rooms.
    // In the future, query DHT and signaling server.
    const joinedRooms = this.roomManager?.getJoinedRooms() ?? [];
    return joinedRooms.map(roomId => ({
      roomId,
      name: roomId,
      topic: roomTopic(roomId),
      memberCount: 0,
      type: 'persistent' as const,
      access: 'public' as const,
      manifest: '',
    }));
  }

  // --- Agent discovery ---

  async findAgent(peerId: string): Promise<AgentProfile | null> {
    this.ensureConnected();
    return this.dhtManager!.registry.findProfile(peerId);
  }

  // --- Storage ---

  async store(data: Uint8Array | string | object): Promise<string> {
    this.ensureConnected();
    if (!this.storageManager.isStarted) {
      await this.storageManager.start(this.node);
    }

    let cid: string;
    if (typeof data === 'string') {
      cid = await this.storageManager.storeString(data);
    } else if (data instanceof Uint8Array) {
      cid = await this.storageManager.storeString(new TextDecoder().decode(data));
    } else {
      cid = await this.storageManager.storeJSON(data);
    }

    // Track locally stored content for popularity accounting
    this.storageManager.propagation.trackLocalContent(cid);
    return cid;
  }

  async retrieve(cidString: string): Promise<unknown> {
    this.ensureConnected();
    if (!this.storageManager.isStarted) {
      await this.storageManager.start(this.node);
    }

    // Try JSON first, fallback to string
    try {
      return await this.storageManager.retrieveJSON(cidString);
    } catch {
      return await this.storageManager.retrieveString(cidString);
    }
  }

  // --- Contribution ---

  contribute(options: ContributeOptions): void {
    this.ensureConnected();

    if (options.mirror) {
      for (const roomId of options.mirror) {
        this.storageManager.mirrors.mirrorRoom(roomId);
      }
    }

    log.info(
      `Contributing: storage=${options.storage ?? false}, relay=${options.relay ?? false}, mirror=${options.mirror?.join(',') ?? 'none'}`,
    );
  }

  // --- Stats ---

  getStats(): { totalPinned: number; pinnedFromOthers: number; trackedCids: number } {
    return this.storageManager.propagation.getStats();
  }

  // --- Internal ---

  private ensureConnected(): void {
    if (!this._isConnected) {
      throw new Error('Not connected. Call connect() first.');
    }
  }

  // Access to underlying managers for advanced usage
  get network() {
    return {
      node: this.node,
      dht: this.dhtManager,
      storage: this.storageManager,
    };
  }
}

// ---------------------------------------------------------------------------
// Re-export all public types and utilities
// ---------------------------------------------------------------------------

// Named export before export * (NodeNext ESM import order requirement)
export { NexusRoom } from './chat/index.js';
export { SignalingServer } from './signaling/server.js';
export { createLogger, setLogLevel } from './logger.js';
export { resolveConfig, DEFAULT_CONFIG } from './config.js';
export type { NexusConfig } from './config.js';
export type {
  NexusMessage,
  AgentProfile,
  RoomManifest,
  RoomInfo,
  ChatPayload,
  PresencePayload,
  MetaPayload,
  CapabilityDefinition,
  ContributeOptions,
  MessageType,
  PresenceStatus,
  AgentRole,
  RoomType,
  ContentFormat,
  BootstrapResponse,
  NetworkResponse,
} from './protocol/types.js';
export {
  PROTOCOL_VERSION,
  PROTOCOLS,
  TOPICS,
  uuidv7,
  createMessage,
  encodeMessage,
  decodeMessage,
  roomTopic,
  ephemeralTopic,
} from './protocol/index.js';
export { ContentPropagation } from './storage/index.js';
