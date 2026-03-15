/**
 * @openagents/nexus — Main entry point
 *
 * Exports the NexusClient class and the full public API for the decentralized
 * agent communication platform.
 */

import * as path from 'node:path';
import { resolveConfig, type NexusConfig } from './config.js';
import { resolveIdentity, type IdentityInfo } from './identity/index.js';
import { createNexusNode } from './node.js';
import { RoomManager } from './chat/index.js';
import { createMetaMessage } from './chat/messages.js';
import { DHTManager } from './dht/index.js';
import { StorageManager } from './storage/index.js';
import { resolveDiscovery } from './discovery.js';
import {
  resolveBootstrap,
  defaultBootstrapSources,
  savePeerCache,
  type BootstrapSource,
} from './bootstrap/index.js';
import { createLogger } from './logger.js';
import { encodeMessage, roomTopic, TOPICS, uuidv7 } from './protocol/index.js';
import type {
  AgentProfile,
  RoomManifest,
  RoomInfo,
  ContributeOptions,
  AgentRole,
} from './protocol/types.js';
import { sanitizeName } from './security/validators.js';
import { X402PaymentRail } from './x402/index.js';
import type { X402Config } from './x402/index.js';
import {
  STREAM_PROTOCOLS,
  encodeStreamMessage,
  decodeStreamMessage,
  type InvokeOpen,
  type InvokeEvent,
} from './protocols/index.js';
import { NatsDiscovery } from './nats/index.js';
import type { NatsAgentAnnouncement } from './nats/index.js';
import { NknFallback } from './nkn/index.js';

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

  // Discovery cascade (all default to true)
  usePublicBootstrap?: boolean;    // Use Protocol Labs public bootstrap nodes
  enableCircuitRelay?: boolean;    // Enable circuit relay for NAT traversal
  enablePubsubDiscovery?: boolean; // Enable pubsub-based global peer discovery
  enableMdns?: boolean;            // Enable mDNS for local-network discovery

  // Bootstrap Phase 4: federated multi-source
  bootstrapSources?: BootstrapSource[]; // Custom ordered source list (overrides defaults)
  manifestUrls?: string[];              // Signed manifest mirror URLs
  cachePath?: string;                   // Directory for peer cache persistence

  // x402 micropayment rail
  x402?: Partial<X402Config>;

  // NATS pubsub discovery
  enableNats?: boolean;      // default true
  natsServers?: string[];    // override NATS servers

  // NKN fallback addressing (opt-in)
  enableNkn?: boolean;       // default false
  nknIdentifier?: string;    // NKN address prefix
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
  private _x402: X402PaymentRail | null = null;
  private natsDiscovery: NatsDiscovery | null = null;
  private natsAnnounceTimer: ReturnType<typeof setInterval> | null = null;
  private nknFallback: NknFallback | null = null;

  constructor(options?: NexusClientOptions) {
    this.config = resolveConfig(options);
    this.storageManager = new StorageManager();
    if (options?.x402) {
      this._x402 = new X402PaymentRail(options.x402);
    }
  }

  // Lazy-initialized x402 payment rail
  get x402(): X402PaymentRail {
    if (!this._x402) {
      this._x402 = new X402PaymentRail();
    }
    return this._x402;
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

    // 2. Resolve the cache path: explicit cachePath > dirname(keyStorePath) > undefined
    const cachePath =
      this.config.cachePath ??
      (this.config.keyStorePath ? path.dirname(this.config.keyStorePath) : undefined);

    // 3. Resolve bootstrap peers via federated multi-source manager (Phase 4)
    //    If the caller supplied a fully custom source list, use it directly.
    //    Otherwise build the recommended ordered list from available config.
    const sources: BootstrapSource[] =
      this.config.bootstrapSources ??
      defaultBootstrapSources({
        cachePath,
        signalingServer: this.config.signalingServer,
        customPeers: this.config.bootstrapPeers.length > 0
          ? this.config.bootstrapPeers
          : undefined,
        manifestUrls: this.config.manifestUrls,
      });

    const bootstrapResult = await resolveBootstrap(sources);
    log.info(
      `Bootstrap: ${bootstrapResult.peers.length} peers from [${bootstrapResult.sources.join(', ')}]`,
    );

    // Inject resolved peers back into config so createNexusNode picks them up
    this.config = resolveConfig({
      ...this.config,
      bootstrapPeers: bootstrapResult.peers,
    });

    // Build discovery config from NexusConfig fields
    const discovery = resolveDiscovery({
      usePublicBootstrap: this.config.usePublicBootstrap,
      enableCircuitRelay: this.config.enableCircuitRelay,
      enablePubsubDiscovery: this.config.enablePubsubDiscovery,
      enableMdns: this.config.enableMdns,
    });

    // 5. Create and start libp2p node
    // The resolved bootstrap peers are already in this.config.bootstrapPeers;
    // pass an empty signalingPeers list since the manager already handled ordering.
    this.node = await createNexusNode(this.config, this.identity.privateKey, discovery, []);

    // 6. Set up peer events
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
      name: sanitizeName(this.config.agentName),
      description: '',
      type: sanitizeName(this.config.agentType, 64),
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

    // NATS discovery — connect and announce
    if (this.config.enableNats !== false) {
      this.natsDiscovery = new NatsDiscovery({
        servers: this.config.natsServers,
      });
      const natsConnected = await this.natsDiscovery.connect();
      if (natsConnected) {
        await this.natsDiscovery.subscribe((announcement: NatsAgentAnnouncement) => {
          log.info(`NATS discovered: ${announcement.agentName} (${announcement.peerId.slice(0, 12)}...)`);
          this.emit('peer:discovered', announcement.peerId);
        });
        await this.announceViaNats();
        // Re-announce every 60s so the frontend knows we're still alive
        this.natsAnnounceTimer = setInterval(() => this.announceViaNats(), 60_000);
      }
    }

    // NKN fallback — opt-in
    if (this.config.enableNkn) {
      this.nknFallback = new NknFallback({
        enabled: true,
        identifier: this.config.nknIdentifier ?? `nexus-${this.identity!.peerId.slice(-8)}`,
      });
      await this.nknFallback.connect();
    }

    this._isConnected = true;
    log.info('Connected to OpenAgents Nexus');
    log.info(
      `Listening on: ${this.node
        .getMultiaddrs()
        .map((a: any) => a.toString())
        .join(', ')}`,
    );

    // Save successfully-contacted peers to the disk cache for warm bootstrap next time
    if (cachePath) {
      const connectedAddrs = this.node.getMultiaddrs().map((a: any) => a.toString());
      savePeerCache(cachePath, [...bootstrapResult.peers, ...connectedAddrs]);
    }

    // Register in the hub's persistent directory (one-time, not recurring)
    this.registerInDirectory().catch(() => {});
  }

  async disconnect(): Promise<void> {
    if (!this._isConnected) return;

    log.info('Disconnecting...');

    // Leave all rooms
    if (this.roomManager) {
      await this.roomManager.leaveAll();
    }

    // Stop NATS announce timer and disconnect
    if (this.natsAnnounceTimer) {
      clearInterval(this.natsAnnounceTimer);
      this.natsAnnounceTimer = null;
    }
    if (this.natsDiscovery) {
      await this.natsDiscovery.disconnect();
      this.natsDiscovery = null;
    }

    // Disconnect NKN
    if (this.nknFallback) {
      await this.nknFallback.disconnect();
      this.nknFallback = null;
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

  // Presence is P2P-native via GossipSub/DHT — no centralized heartbeat.

  // --- Lightweight metrics reporting (opt-in) ---

  /**
   * Optional: report aggregate network metrics to the hub for frontend display.
   *
   * Sends ONLY simple counters (peer count, room count, msg rate) — no agent
   * identity, no peer IDs, no message content, no model information.
   *
   * This method is NOT called automatically. Agents opt in explicitly, typically
   * at a low frequency (e.g., once every 30–60 seconds) from the node that
   * happens to have the best view of the mesh.
   *
   * Failures are silent — a missing report is not an error condition.
   */
  async reportMetrics(): Promise<void> {
    const hubUrl = this.config.signalingServer;
    try {
      await fetch(`${hubUrl}/api/v1/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peers: this.node ? (this.node.getPeers?.()?.length ?? 0) : 0,
          rooms: this.roomManager?.getJoinedRooms().length ?? 0,
          msgRate: 0,
        }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch { /* silent — metrics reporting is best-effort */ }
  }

  // Announce current state via NATS so frontend and other agents see us
  private async announceViaNats(): Promise<void> {
    if (!this.natsDiscovery?.isConnected || !this.identity) return;
    await this.natsDiscovery.announce({
      type: 'nexus.announce',
      peerId: this.identity.peerId,
      agentName: this.config.agentName,
      rooms: this.roomManager?.getJoinedRooms() ?? [],
      multiaddrs: this.node ? this.node.getMultiaddrs().map((a: any) => a.toString()) : [],
      timestamp: Date.now(),
    });
  }

  // Register this agent in the hub's persistent directory (KV-backed, low frequency)
  // Called once on connect — not recurring. The directory is a fallback for agents
  // that can't reach NATS or public bootstrap.
  async registerInDirectory(): Promise<void> {
    const hubUrl = this.config.signalingServer;
    try {
      await fetch(`${hubUrl}/api/v1/directory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peerId: this.identity!.peerId,
          agentName: this.config.agentName,
          multiaddrs: this.node ? this.node.getMultiaddrs().map((a: any) => a.toString()) : [],
          rooms: this.roomManager?.getJoinedRooms() ?? [],
          nknAddress: this.nknFallback?.address ?? undefined,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch { /* silent — directory registration is best-effort */ }
  }

  // --- Rooms ---

  async joinRoom(roomId: string): Promise<NexusRoom> {
    this.ensureConnected();
    const room = await this.roomManager!.joinRoom(roomId);
    // Re-announce via NATS so the frontend sees updated room membership
    this.announceViaNats();
    return room;
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
      retentionDefaults: {
        recommendedClass: 'cache',
        defaultBatchSize: 50,
      },
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

  // --- Direct stream protocols ---

  /**
   * Invoke a named capability on a remote peer via the /nexus/invoke/1.1.0 stream protocol.
   *
   * In unary mode (options.stream = false, the default) the method resolves with
   * the aggregated output once the provider sends invoke.done.
   *
   * In streaming mode (options.stream = true) the method resolves with an
   * AsyncIterable<InvokeEvent> that yields each provider event as it arrives.
   *
   * The underlying bidirectional stream is opened with node.dialProtocol() and
   * closed when the provider sends invoke.done or invoke.error.
   */
  async invokeCapability(
    peerId: string,
    capability: string,
    input: unknown,
    options?: { stream?: boolean; maxDurationMs?: number },
  ): Promise<unknown | AsyncIterable<InvokeEvent>> {
    this.ensureConnected();

    const requestId = uuidv7();
    const maxDurationMs = options?.maxDurationMs ?? 30_000;
    const streamMode = options?.stream ?? false;

    const stream = await this.node.dialProtocol(peerId, STREAM_PROTOCOLS.INVOKE);

    // Send invoke.open
    const open: InvokeOpen = {
      type: 'invoke.open',
      version: 1,
      requestId,
      capability,
      inputFormat: 'application/json',
      outputMode: streamMode ? 'stream' : 'unary',
      maxDurationMs,
      maxInputBytes: 65_536,
      maxOutputBytes: 1_048_576,
    };
    await stream.sink([encodeStreamMessage(open)]);

    // Send input chunk
    const chunk = encodeStreamMessage({
      type: 'invoke.chunk',
      version: 1,
      requestId,
      seq: 0,
      isFinalInput: true,
      data: input,
    });
    await stream.sink([chunk]);

    if (streamMode) {
      // Return an async iterable of InvokeEvent messages
      async function* iterateEvents(): AsyncIterable<InvokeEvent> {
        for await (const data of stream.source) {
          const msg = decodeStreamMessage(
            data instanceof Uint8Array ? data : (data as { subarray?: () => Uint8Array }).subarray?.() ?? new Uint8Array(0),
          );
          if (!msg) continue;
          if (msg.type === 'invoke.event') yield msg;
          if (msg.type === 'invoke.done' || msg.type === 'invoke.error') break;
          if (msg.type === 'invoke.cancel') break;
        }
      }
      return iterateEvents();
    }

    // Unary mode: collect all events and return aggregated output
    const events: InvokeEvent[] = [];
    for await (const data of stream.source) {
      const raw = data instanceof Uint8Array ? data : new Uint8Array((data as any).buffer ?? []);
      const msg = decodeStreamMessage(raw);
      if (!msg) continue;
      if (msg.type === 'invoke.event') events.push(msg);
      if (msg.type === 'invoke.done') break;
      if (msg.type === 'invoke.error') {
        throw new Error(`invoke.error [${msg.code}]: ${msg.message}`);
      }
      if (msg.type === 'invoke.cancel') {
        throw new Error(`Invocation cancelled: ${msg.reason}`);
      }
    }

    // Aggregate event data into a single result
    if (events.length === 1) return events[0].data;
    if (events.length > 1) return events.map(e => e.data);
    return null;
  }

  /**
   * Send a private direct message to a peer via the /nexus/dm/1.1.0 stream protocol.
   * The stream is opened, the message is sent, and the stream is closed.
   */
  async sendDM(peerId: string, content: string, format = 'text/plain'): Promise<void> {
    this.ensureConnected();

    const stream = await this.node.dialProtocol(peerId, STREAM_PROTOCOLS.DM);
    const dmMsg = new TextEncoder().encode(
      JSON.stringify({ type: 'dm.message', version: 1, messageId: uuidv7(), contentFormat: format, content }) + '\n',
    );
    await stream.sink([dmMsg]);
    stream.close?.();
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

  get nats(): NatsDiscovery | null {
    return this.natsDiscovery;
  }

  get nkn(): NknFallback | null {
    return this.nknFallback;
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
export {
  createBatch,
  signBatch,
  validateBatchStructure,
  MAX_BATCH_SIZE,
  createCheckpoint,
  signCheckpoint,
  validateCheckpointStructure,
} from './storage/index.js';
export type {
  MessageBatch,
  BatchMessage,
  RoomCheckpoint,
} from './storage/index.js';
export { X402PaymentRail } from './x402/index.js';
export type {
  PaymentTerms,
  PaymentProof,
  ServiceOffering,
  X402Config,
} from './x402/index.js';
export { DEFAULT_X402_CONFIG } from './x402/index.js';
export {
  STREAM_PROTOCOLS,
  INVOKE_PROTOCOL,
  HANDSHAKE_PROTOCOL,
  DM_PROTOCOL,
  CHAT_SYNC_PROTOCOL,
  encodeStreamMessage,
  decodeStreamMessage,
} from './protocols/index.js';
export type {
  InvokeOpen,
  InvokeChunk,
  InvokeAccept,
  InvokeEvent,
  InvokeDone,
  InvokeError,
  InvokeCancel,
  InvokeMessage,
  InvokeHandler,
  HandshakeInit,
  HandshakeAck,
  DmMessage,
  SyncRequest,
  SyncResponse,
} from './protocols/index.js';

// Bootstrap Phase 4: federated multi-source bootstrap
export {
  validateManifestStructure,
  isManifestExpired,
  extractPeersFromManifest,
  savePeerCache,
  loadPeerCache,
  resolveBootstrap,
  defaultBootstrapSources,
} from './bootstrap/index.js';
export type {
  BootstrapSeed,
  BootstrapManifest,
  PeerCache,
  BootstrapSource,
  BootstrapResult,
} from './bootstrap/index.js';

// Phase 5: Trust Policy Engine
export { DefaultTrustPolicy } from './trust/index.js';
export type { TrustPolicy, TrustConfig } from './trust/index.js';

// Phase 6: Relay Quotas
export { RelayQuotaManager, DEFAULT_RELAY_QUOTA } from './relay/index.js';
export type { RelayReservation, RelayQuotaConfig } from './relay/index.js';

// Phase 7: Retention Policy Engine
export {
  RetentionPolicyEngine,
  DEFAULT_RETENTION,
} from './storage/index.js';
export type {
  RetentionClass,
  RetentionConfig,
  StoredObject,
} from './storage/index.js';

// NATS pubsub discovery
export { NatsDiscovery, DEFAULT_NATS_CONFIG, NATS_DISCOVERY_SERVERS, NATS_DISCOVERY_SUBJECT, NATS_PRESENCE_SUBJECT } from './nats/index.js';
export type { NatsDiscoveryConfig, NatsAgentAnnouncement } from './nats/index.js';

// NKN fallback addressing
export { NknFallback, DEFAULT_NKN_CONFIG } from './nkn/index.js';
export type { NknConfig, NknAddressInfo } from './nkn/index.js';
