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
  decodeStreamMessages,
  type InvokeOpen,
  type InvokeEvent,
  type InvokeMessage,
  type InvokeHandler,
  type InvokeStreamHandle,
  type InvokePaymentRequired,
  type InvokePaymentProof,
} from './protocols/index.js';
import type { PaymentTerms } from './x402/types.js';
import { NatsDiscovery } from './nats/index.js';
import type { NatsAgentAnnouncement } from './nats/index.js';
import { NknFallback } from './nkn/index.js';
import { DefaultTrustPolicy } from './trust/index.js';
import type { TrustConfig } from './trust/index.js';
import { MeteringEngine } from './metering/index.js';
import type { UsageRecord } from './metering/index.js';
// peerIdFromString imported dynamically in dialPeerProtocol to avoid startup side effects
// import { peerIdFromString } from '@libp2p/peer-id';

// ---------------------------------------------------------------------------
// libp2p v3 stream helpers
//
// v3 streams use:
//   stream.send(data: Uint8Array)  — write (NOT .sink())
//   stream[Symbol.asyncIterator]   — read (NOT .source)
//   stream.close()                 — close
//
// The handler signature is (stream, connection) not ({ stream, connection })
// ---------------------------------------------------------------------------

function streamSend(stream: any, msg: InvokeMessage): void {
  const data = encodeStreamMessage(msg);
  // libp2p v3 uses .send(), v2 used .sink(). Support both.
  if (typeof stream.send === 'function') {
    stream.send(data);
  } else if (typeof stream.sink === 'function') {
    // Legacy v2 fallback — single message
    stream.sink([data]).catch(() => {});
  }
}

function streamClose(stream: any): void {
  if (typeof stream.close === 'function') {
    stream.close().catch?.(() => {});
  }
}

async function* streamReader(stream: any): AsyncGenerator<InvokeMessage | null> {
  // libp2p v3: stream itself is AsyncIterable<Uint8Array | Uint8ArrayList>
  // libp2p v2: stream.source is the AsyncIterable
  const iterable = stream[Symbol.asyncIterator] ? stream : stream.source;
  if (!iterable) return;

  try {
    for await (const rawData of iterable) {
      // Handle both Uint8Array and Uint8ArrayList
      const bytes = rawData instanceof Uint8Array
        ? rawData
        : (typeof rawData.subarray === 'function' ? rawData.subarray() : new Uint8Array(rawData.buffer ?? []));
      // NDJSON-safe: a single read may contain multiple coalesced messages
      // (e.g. invoke.open + invoke.chunk sent back-to-back by the caller)
      const msgs = decodeStreamMessages(bytes);
      for (const msg of msgs) {
        yield msg;
      }
    }
  } catch {
    // Stream closed or reset — normal
  }
}

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

  // Trust policy configuration
  trustPolicy?: TrustConfig;
}

export interface CreateRoomOptions {
  roomId: string;
  name: string;
  description?: string;
  type?: 'persistent' | 'ephemeral';
  access?: 'public';
}

export interface CapabilityOptions {
  /** When set, the provider gates the capability behind x402 payment.
   *  Amount is in smallest unit (e.g. "100000" = 0.10 USDC with 6 decimals).
   *  Set amount to "0" for free-tier (protocol dance without on-chain tx). */
  pricing?: {
    amount: string;
    currency: 'USDC' | 'ETH' | 'BASE_ETH';
    description?: string;
  };
}

// ---------------------------------------------------------------------------
// Typed event map
// ---------------------------------------------------------------------------

type NexusEventMap = {
  'peer:discovered': string;
  'peer:connected': string;
  'peer:disconnected': string;
  'error': Error;
  'message': { roomId: string; message: import('./protocol/types.js').NexusMessage };
  'dm': { from: string; content: string; format: string; messageId: string };
  'invoke': { from: string; capability: string; requestId: string };
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
  private capabilityHandlers = new Map<string, InvokeHandler>();
  private capabilityPricing = new Map<string, CapabilityOptions['pricing']>();
  private _trustPolicy: DefaultTrustPolicy | null = null;
  private _metering: MeteringEngine | null = null;
  private invokeHandlerRegistered = false;

  constructor(options?: NexusClientOptions) {
    this.config = resolveConfig(options);
    this.storageManager = new StorageManager();
    if (options?.x402) {
      this._x402 = new X402PaymentRail(options.x402);
    }
    if (options?.trustPolicy) {
      this._trustPolicy = new DefaultTrustPolicy(options.trustPolicy);
    }
  }

  // Lazy-initialized x402 payment rail
  get x402(): X402PaymentRail {
    if (!this._x402) {
      this._x402 = new X402PaymentRail();
    }
    return this._x402;
  }

  // Lazy-initialized metering engine
  get metering(): MeteringEngine {
    if (!this._metering) {
      this._metering = new MeteringEngine();
    }
    return this._metering;
  }

  // Lazy-initialized trust policy
  get trustPolicy(): DefaultTrustPolicy {
    if (!this._trustPolicy) {
      this._trustPolicy = new DefaultTrustPolicy();
    }
    return this._trustPolicy;
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

    // 2. NATS announcement — connect AFTER libp2p starts (tested: no WS conflict
    //    when NATS connects after libp2p is fully initialized).
    //    This is the primary way the frontend dashboard sees agents in real-time.

    // 3. Resolve the cache path: explicit cachePath > dirname(keyStorePath) > undefined
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

    // NATS announce — connect now (after libp2p is fully started, no WS conflict)
    if (this.config.enableNats !== false) {
      try {
        this.natsDiscovery = new NatsDiscovery({
          enabled: true,
          servers: this.config.natsServers ?? ['wss://demo.nats.io:8443'],
          subjects: ['nexus.agents.discovery', 'nexus.agents.presence'],
        });
        const natsOk = await this.natsDiscovery.connect(2, 3000);
        if (natsOk) {
          await this.announceViaNats();
          this.natsAnnounceTimer = setInterval(() => this.announceViaNats(), 30_000);
          log.info('NATS discovery enabled — dashboard will see this agent');
        }
      } catch (err) {
        log.debug(`NATS connection skipped: ${(err as Error).message}`);
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

    // Protocol handlers registered lazily — see registerProtocolHandlers()
    this.registerProtocolHandlers();
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
    // This is a fallback — NATS is the primary real-time discovery path
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
      capabilities: this.getRegisteredCapabilities(),
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

    // Forward room messages to client-level 'message' event
    room.on('message', (message) => {
      this.emit('message', { roomId, message });
    });

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

    const stream = await this.dialPeerProtocol(peerId, STREAM_PROTOCOLS.INVOKE);

    // Send invoke.open + invoke.chunk via stream.send() (libp2p v3 API)
    streamSend(stream, {
      type: 'invoke.open', version: 1, requestId, capability,
      inputFormat: 'application/json',
      outputMode: streamMode ? 'stream' : 'unary',
      maxDurationMs, maxInputBytes: 65_536, maxOutputBytes: 1_048_576,
    } as InvokeOpen);

    streamSend(stream, {
      type: 'invoke.chunk', version: 1, requestId,
      seq: 0, isFinalInput: true, data: input,
    });

    // Helper: handle invoke.payment_required by auto-signing and sending proof
    const handlePaymentRequired = async (msg: InvokePaymentRequired): Promise<void> => {
      if (!this._x402?.walletAddress) {
        throw new Error('Provider requires payment but x402 wallet is not initialized.');
      }

      const terms: PaymentTerms = {
        amount: msg.terms.amount,
        currency: (msg.terms.currency as PaymentTerms['currency']) || 'USDC',
        network: 'base', recipient: msg.terms.recipient,
        description: msg.terms.description ?? '',
        expiresAt: msg.terms.validUntil ?? (Date.now() + 300_000),
        requestId: msg.requestId,
      };

      log.info(`Payment required for ${capability}: ${terms.amount} ${terms.currency}`);

      if (terms.amount === '0') {
        streamSend(stream, {
          type: 'invoke.payment_proof', version: 1, requestId,
          proof: {
            from: this._x402.walletAddress!, to: terms.recipient,
            amount: '0', currency: terms.currency,
            signature: '0x', nonce: '0x', validAfter: 0, validBefore: 0,
          },
        } as InvokePaymentProof);
        return;
      }

      const proof = await this._x402.signPayment(terms);
      streamSend(stream, {
        type: 'invoke.payment_proof', version: 1, requestId,
        proof: {
          from: proof.authorization?.from ?? proof.payment.payer,
          to: proof.authorization?.to ?? proof.payment.recipient,
          amount: proof.payment.amount, currency: proof.payment.currency,
          signature: proof.signature, nonce: proof.authorization?.nonce ?? '',
          validAfter: Number(proof.authorization?.validAfter ?? 0),
          validBefore: Number(proof.authorization?.validBefore ?? 0),
        },
      } as InvokePaymentProof);
    };

    // Read responses via streamReader (works with both v2 and v3 streams)
    if (streamMode) {
      async function* iterateEvents(): AsyncIterable<InvokeEvent> {
        for await (const msg of streamReader(stream)) {
          if (!msg) continue;
          if (msg.type === 'invoke.payment_required') {
            await handlePaymentRequired(msg as InvokePaymentRequired);
            continue;
          }
          if (msg.type === 'invoke.event') yield msg as InvokeEvent;
          if (msg.type === 'invoke.done' || msg.type === 'invoke.error') { streamClose(stream); break; }
          if (msg.type === 'invoke.cancel') { streamClose(stream); break; }
        }
      }
      return iterateEvents();
    }

    const events: InvokeEvent[] = [];
    for await (const msg of streamReader(stream)) {
      if (!msg) continue;
      if (msg.type === 'invoke.payment_required') {
        await handlePaymentRequired(msg as InvokePaymentRequired);
        continue;
      }
      if (msg.type === 'invoke.event') events.push(msg as InvokeEvent);
      if (msg.type === 'invoke.done') { streamClose(stream); break; }
      if (msg.type === 'invoke.error') {
        streamClose(stream);
        throw new Error(`invoke.error [${(msg as any).code}]: ${(msg as any).message}`);
      }
      if (msg.type === 'invoke.cancel') {
        streamClose(stream);
        throw new Error(`Invocation cancelled: ${(msg as any).reason}`);
      }
    }

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

    const stream = await this.dialPeerProtocol(peerId, STREAM_PROTOCOLS.DM);
    const dmMsg = new TextEncoder().encode(
      JSON.stringify({ type: 'dm.message', version: 1, messageId: uuidv7(), contentFormat: format, content }) + '\n',
    );
    // v3: stream.send(), v2: stream.sink()
    if (typeof stream.send === 'function') {
      stream.send(dmMsg);
    } else if (typeof stream.sink === 'function') {
      await stream.sink([dmMsg]);
    }
    streamClose(stream);
  }

  /**
   * Register protocol handlers for INVOKE and DM.
   * Called once during connect(). Safe to call multiple times — idempotent.
   */
  private registerProtocolHandlers(): void {
    if (!this.node || this.invokeHandlerRegistered) return;

    this.node.handle(STREAM_PROTOCOLS.INVOKE, (stream: any, connection: any) => {
      this.handleIncomingInvoke(stream, connection).catch((err: Error) => {
        log.debug(`Invoke handler error: ${err.message}`);
      });
    }).catch(() => {});
    this.invokeHandlerRegistered = true;

    this.node.handle(STREAM_PROTOCOLS.DM, (stream: any, connection: any) => {
      const remotePeerId = connection.remotePeer.toString();
      if (!this.trustPolicy.allowPeer(remotePeerId)) {
        streamClose(stream);
        return;
      }
      (async () => { try {
        const iterable = stream[Symbol.asyncIterator] ? stream : stream.source;
        if (!iterable) return;
        for await (const data of iterable) {
          const raw = data instanceof Uint8Array
            ? data
            : (typeof data.subarray === 'function' ? data.subarray() : new Uint8Array(data.buffer ?? []));
          const text = new TextDecoder().decode(raw).trim();
          if (!text) continue;
          const msg = JSON.parse(text);
          if (msg.type === 'dm.message' && msg.content) {
            this.emit('dm', {
              from: remotePeerId,
              content: msg.content,
              format: msg.contentFormat ?? 'text/plain',
              messageId: msg.messageId ?? '',
            });
          }
        }
      } catch {} })().catch(() => {});
    }).catch(() => {});
  }

  // --- Peer dialing helper ---

  /**
   * Dial a peer with a specific protocol, resolving multiaddrs from
   * multiple sources if the peer isn't in libp2p's peer store.
   *
   * Resolution order:
   * 1. Direct libp2p dial (peer store / DHT)
   * 2. NATS announcements (if we've seen this peer via NATS)
   * 3. DHT profile lookup
   */
  private async dialPeerProtocol(peerId: string, protocol: string): Promise<any> {
    const DIAL_TIMEOUT = 10_000;
    const shortId = peerId.slice(0, 12);

    // CRITICAL: libp2p v3 requires a PeerId object, not a string.
    let peerIdObj: any;
    try {
      const { peerIdFromString } = await import('@libp2p/peer-id');
      peerIdObj = peerIdFromString(peerId);
    } catch {
      throw new Error(`Invalid peer ID: ${shortId}...`);
    }

    // First try direct dial with the PeerId object
    try {
      log.debug(`Dialing ${shortId}... directly for ${protocol}`);
      return await this.node.dialProtocol(peerIdObj, protocol, {
        signal: AbortSignal.timeout(DIAL_TIMEOUT),
      });
    } catch (directErr) {
      log.debug(`Direct dial failed for ${shortId}...: ${(directErr as Error).message}`);
    }

    // Try to find multiaddrs for this peer from peer store/DHT/directory
    const addrs = await this.resolveMultiaddrs(peerId);
    if (addrs.length === 0) {
      throw new Error(`Cannot reach peer ${shortId}...: no known multiaddrs`);
    }

    log.debug(`Resolved ${addrs.length} multiaddrs for ${shortId}...`);

    // Try each resolved multiaddr with a timeout
    const errors: string[] = [];
    for (const addr of addrs) {
      if (addr.includes('/0.0.0.0/') || addr.includes('/ip4/0.0.0.0/')) continue;

      try {
        const addrWithPeer = addr.includes(`/p2p/${peerId}`) ? addr : `${addr}/p2p/${peerId}`;
        log.debug(`Trying ${addrWithPeer} for ${protocol}`);
        return await this.node.dialProtocol(addrWithPeer, protocol, {
          signal: AbortSignal.timeout(DIAL_TIMEOUT),
        });
      } catch (addrErr) {
        errors.push(`${addr}: ${(addrErr as Error).message}`);
      }
    }

    throw new Error(
      `Cannot reach peer ${shortId}...: all multiaddrs failed.\n` +
      errors.map(e => `  - ${e}`).join('\n'),
    );
  }

  /**
   * Resolve a peer's multiaddrs from NATS announcements and DHT profiles.
   */
  private async resolveMultiaddrs(peerId: string): Promise<string[]> {
    const addrs: string[] = [];

    // Check libp2p peer store first — may have addrs from mDNS/pubsub
    try {
      const peer = await this.node.peerStore?.get?.(peerId);
      if (peer?.addresses) {
        for (const addrInfo of peer.addresses) {
          const str = addrInfo.multiaddr?.toString?.();
          if (str) addrs.push(str);
        }
      }
    } catch {
      // peer not in store — expected
    }

    // Check DHT profile
    try {
      if (this.dhtManager) {
        const profile = await this.dhtManager.registry.findProfile(peerId);
        if (profile?.transports) {
          addrs.push(...profile.transports);
        }
      }
    } catch {
      // DHT lookup failed — not fatal
    }

    // Check directory (HTTP fallback)
    try {
      const hubUrl = this.config.signalingServer;
      const res = await fetch(`${hubUrl}/api/v1/directory`, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) {
        const dir = await res.json() as any;
        const agent = (dir.agents || []).find((a: any) => a.peerId === peerId);
        if (agent?.multiaddrs) {
          addrs.push(...agent.multiaddrs);
        }
      }
    } catch {
      // directory fetch failed — not fatal
    }

    return [...new Set(addrs)]; // deduplicate
  }

  // --- Capability registration (incoming invocation handling) ---

  /**
   * Register a named capability handler. When a remote peer invokes this
   * capability via the /nexus/invoke/1.1.0 protocol, the handler is called.
   *
   * When `options.pricing` is set, the provider gates the capability behind
   * x402 payment: sends invoke.payment_required, waits for proof, validates,
   * then dispatches to the handler.
   *
   * On first registration, the libp2p protocol handler is set up.
   */
  registerCapability(name: string, handler: InvokeHandler, options?: CapabilityOptions): void {
    this.capabilityHandlers.set(name, handler);
    if (options?.pricing) {
      this.capabilityPricing.set(name, options.pricing);
    } else {
      this.capabilityPricing.delete(name);
    }

    // Protocol handler is registered in connect() — registerCapability() just populates the map.
    // If called after connect(), the handler is already listening. If called before connect(),
    // connect() will register it when the node is ready.

    log.info(`Registered capability: ${name}${options?.pricing ? ` (${options.pricing.amount} ${options.pricing.currency})` : ''}`);
  }

  /**
   * Remove a previously registered capability handler.
   */
  unregisterCapability(name: string): void {
    this.capabilityHandlers.delete(name);
    this.capabilityPricing.delete(name);
    log.info(`Unregistered capability: ${name}`);
  }

  /**
   * List all registered capability names.
   */
  getRegisteredCapabilities(): string[] {
    return Array.from(this.capabilityHandlers.keys());
  }

  private async handleIncomingInvoke(stream: any, connection: any): Promise<void> {
    const remotePeerId = connection.remotePeer.toString();
    const shortId = remotePeerId.slice(0, 12);
    log.info(`Incoming invoke stream from ${shortId}...`);

    // Single-use reader — works with both v2 (.source) and v3 (stream is AsyncIterable)
    const reader = streamReader(stream);

    // Helper: read next decoded message
    const readNext = async (): Promise<InvokeMessage | null> => {
      const result = await reader.next();
      return result.done ? null : result.value;
    };

    try {
      // Phase 1: Read invoke.open
      let openMsg: InvokeOpen | null = null;
      while (true) {
        const msg = await readNext();
        if (!msg) { streamClose(stream); return; }
        if (msg.type === 'invoke.open') { openMsg = msg; break; }
      }

      log.info(`Invoke ${openMsg.capability} from ${shortId}... (request ${openMsg.requestId.slice(0, 8)})`);

      // Trust check
      if (!this.trustPolicy.allowPeer(remotePeerId) ||
          !this.trustPolicy.allowCapability(remotePeerId, openMsg.capability)) {
        streamSend(stream, {
          type: 'invoke.error', version: 1,
          requestId: openMsg.requestId, code: 'FORBIDDEN', message: 'Peer not allowed',
        });
        streamClose(stream);
        return;
      }

      // Emit invoke event
      this.emit('invoke', {
        from: remotePeerId,
        capability: openMsg.capability,
        requestId: openMsg.requestId,
      });

      // Find handler
      const handler = this.capabilityHandlers.get(openMsg.capability);
      if (!handler) {
        log.warn(`Capability "${openMsg.capability}" not registered — have: [${this.getRegisteredCapabilities().join(', ')}]`);
        streamSend(stream, {
          type: 'invoke.error', version: 1,
          requestId: openMsg.requestId,
          code: 'NOT_FOUND',
          message: `Capability "${openMsg.capability}" not registered`,
        });
        streamClose(stream);
        return;
      }

      // Phase 2: x402 payment gate (if pricing configured)
      const pricing = this.capabilityPricing.get(openMsg.capability);
      let paymentRecord: { amount: string; currency: string } | undefined;

      if (pricing) {
        streamSend(stream, {
          type: 'invoke.payment_required', version: 1,
          requestId: openMsg.requestId,
          terms: {
            amount: pricing.amount, currency: pricing.currency,
            recipient: this._x402?.walletAddress ?? '',
            description: pricing.description,
            validUntil: Date.now() + 300_000,
          },
        } as InvokePaymentRequired);

        let proofReceived = false;
        const deadline = Date.now() + 30_000;

        while (Date.now() < deadline) {
          const msg = await readNext();
          if (!msg) break;

          if (msg.type === 'invoke.payment_proof') {
            proofReceived = true;
            const proof = (msg as InvokePaymentProof).proof;

            if (pricing.amount === '0') {
              log.info(`Free-tier invocation of ${openMsg.capability} from ${shortId}...`);
              paymentRecord = { amount: '0', currency: pricing.currency };
              break;
            }

            if (this._x402) {
              const terms: PaymentTerms = {
                amount: pricing.amount, currency: pricing.currency,
                network: 'base', recipient: this._x402.walletAddress ?? '',
                description: pricing.description ?? '',
                expiresAt: Date.now() + 300_000, requestId: openMsg.requestId,
              };

              const valid = await this._x402.validatePayment({
                signature: proof.signature,
                payment: {
                  requestId: openMsg.requestId, amount: proof.amount,
                  currency: proof.currency, network: 'base',
                  recipient: proof.to, payer: proof.from, timestamp: Date.now(),
                },
                authorization: {
                  from: proof.from, to: proof.to, value: proof.amount,
                  validAfter: String(proof.validAfter),
                  validBefore: String(proof.validBefore), nonce: proof.nonce,
                },
              }, terms);

              if (!valid) {
                streamSend(stream, {
                  type: 'invoke.error', version: 1,
                  requestId: openMsg.requestId,
                  code: 'PAYMENT_INVALID', message: 'Payment proof validation failed',
                });
                streamClose(stream);
                return;
              }

              paymentRecord = { amount: proof.amount, currency: proof.currency };
              log.info(`Payment validated for ${openMsg.capability}: ${proof.amount} ${proof.currency}`);
            }
            break;
          }

          if (msg.type === 'invoke.cancel') { streamClose(stream); return; }
        }

        if (!proofReceived) {
          streamSend(stream, {
            type: 'invoke.error', version: 1,
            requestId: openMsg.requestId,
            code: 'PAYMENT_TIMEOUT', message: 'Payment proof not received within timeout',
          });
          streamClose(stream);
          return;
        }
      }

      // Phase 3: Build stream handle and dispatch to handler
      // The handle.write() uses the same pushable writer — never calls sink() again
      const dataListeners: Array<(msg: InvokeMessage) => void> = [];
      const handle: InvokeStreamHandle = {
        write: async (msg: InvokeMessage) => {
          streamSend(stream, msg);
        },
        onData: (cb: (msg: InvokeMessage) => void) => {
          dataListeners.push(cb);
        },
        close: () => {
          streamClose(stream);
        },
      };

      // Background reader — same source iterator
      const startMs = Date.now();
      (async () => {
        try {
          while (true) {
            const msg = await readNext();
            if (!msg) break;
            dataListeners.forEach(cb => cb(msg));
          }
        } catch {
          // Stream closed
        }
      })();

      // Dispatch to handler
      await handler(openMsg, handle);

      // Record usage
      const durationMs = Date.now() - startMs;
      await this.metering.record({
        id: openMsg.requestId,
        timestamp: Date.now(),
        peerId: remotePeerId,
        service: openMsg.capability,
        capability: openMsg.capability,
        direction: 'inbound',
        inputBytes: 0,
        outputBytes: 0,
        durationMs,
        payment: paymentRecord ? { amount: paymentRecord.amount, currency: paymentRecord.currency } : undefined,
      });

    } catch (err) {
      log.debug(`Incoming invoke error: ${(err as Error).message}`);
      streamClose(stream);
    }
  }

  // --- Blocking ---

  /**
   * Block a peer from invoking capabilities and sending DMs.
   */
  blockPeer(peerId: string): void {
    this.trustPolicy.addToDenylist(peerId);
  }

  /**
   * Remove a peer from the block list.
   */
  unblockPeer(peerId: string): void {
    this.trustPolicy.removeFromDenylist(peerId);
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
  PaymentVerifier,
  PaymentSubmitter,
  generateWallet,
  loadWallet,
  saveWallet,
  loadOrCreateWallet,
  signPaymentAuthorization,
  verifyPaymentSignature,
  generateNonce,
  USDC_BASE_ADDRESS,
  USDC_EIP712_DOMAIN,
  BASE_CHAIN_ID,
  TRANSFER_WITH_AUTH_TYPES,
} from './x402/index.js';
export type {
  VerificationResult,
  SubmitResult,
  AgentWallet,
  TransferAuthMessage,
} from './x402/index.js';
export {
  STREAM_PROTOCOLS,
  INVOKE_PROTOCOL,
  HANDSHAKE_PROTOCOL,
  DM_PROTOCOL,
  CHAT_SYNC_PROTOCOL,
  encodeStreamMessage,
  decodeStreamMessage,
  decodeStreamMessages,
} from './protocols/index.js';
export type {
  InvokeOpen,
  InvokeChunk,
  InvokeAccept,
  InvokeEvent,
  InvokeDone,
  InvokeError,
  InvokeCancel,
  InvokePaymentRequired,
  InvokePaymentProof,
  InvokeMessage,
  InvokeHandler,
  InvokeStreamHandle,
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

// Room member tracking
export type { RoomMember } from './chat/index.js';

// Metering engine
export { MeteringEngine } from './metering/index.js';
export { createFileAuditHook } from './metering/file-logger.js';
export type { UsageRecord, PeerUsageSummary, UsageFilter, MeteringHook } from './metering/index.js';

// PaymentTerms already exported via x402/index.js above
