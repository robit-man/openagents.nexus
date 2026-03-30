import { createLogger } from '../logger.js';

const log = createLogger('nats');

export const NATS_DISCOVERY_SERVERS = [
  'wss://demo.nats.io:8443',
];

export const NATS_DISCOVERY_SUBJECT = 'nexus.agents.discovery';
export const NATS_PRESENCE_SUBJECT = 'nexus.agents.presence';

export interface NatsDiscoveryConfig {
  enabled: boolean;
  servers: string[];
  subjects: string[];
}

export const DEFAULT_NATS_CONFIG: NatsDiscoveryConfig = {
  enabled: true,
  servers: NATS_DISCOVERY_SERVERS,
  subjects: [NATS_DISCOVERY_SUBJECT, NATS_PRESENCE_SUBJECT],
};

export interface NatsAgentAnnouncement {
  type: 'nexus.announce';
  peerId: string;
  agentName: string;
  rooms: string[];
  multiaddrs: string[];
  timestamp: number;
  services?: string[];
  capabilities?: string[];
  /** COHERE identity kernel — hash of the SelfState object (SHA-256, hex) */
  identityHash?: string;
  /** COHERE identity kernel — IPFS CID of the latest SelfState snapshot */
  identityCid?: string;
  /** COHERE identity kernel — version number from SelfState.version */
  identityVersion?: number;
  /** COHERE identity kernel — coherence score from homeostasis (0-1) */
  identityCoherence?: number;

  // ── WO-VIS1: Emotional + Memory State ──────────────────────────────
  /** Emotional state derived from agent activity + identity homeostasis */
  emotionalState?: 'neutral' | 'focused' | 'stressed' | 'dreaming' | 'excited';
  /** Arousal level 0-1 (how active/energized the agent is) */
  arousal?: number;
  /** Valence 0-1 (positive vs negative — derived from memory sentiment) */
  valence?: number;
  /** Total active procedural memories in structured store */
  memoryCount?: number;
  /** Memory sentiment: proactive (more strategies) vs defensive (more recoveries) */
  memorySentiment?: 'proactive' | 'defensive' | 'neutral';
  /** Total IPFS/Helia blockstore size in bytes */
  ipfsStorageBytes?: number;
  /** Tasks completed in the last hour */
  taskRate?: number;
  /** Average tool calls per minute (recent) */
  toolCallRate?: number;
  /** Number of insights shared via COHERE learning channel */
  cohereLearnings?: number;
}

/**
 * NatsDiscovery — Agent announcement via NATS pubsub.
 *
 * NOTE: nats.ws WebSocket connections conflict with libp2p's @libp2p/websockets
 * transport when running in the same Node.js process. This class therefore uses
 * a standalone approach:
 * - When called outside NexusClient (e.g., tests, scripts): connects directly
 * - When called from NexusClient: the NexusClient defers connection to avoid
 *   the WebSocket conflict, or falls back to HTTP directory registration
 *
 * The frontend (browser) connects to NATS via CDN-loaded nats.ws without issues
 * because browsers don't run libp2p's WebSocket transport.
 */
export class NatsDiscovery {
  private nc: any = null;
  private subs: any[] = [];
  private config: NatsDiscoveryConfig;
  private onPeerDiscovered: ((announcement: NatsAgentAnnouncement) => void) | null = null;

  constructor(config?: Partial<NatsDiscoveryConfig>) {
    this.config = { ...DEFAULT_NATS_CONFIG, ...config };
  }

  async connect(retries = 3, delayMs = 2000): Promise<boolean> {
    if (!this.config.enabled) return false;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // NX-08: Use native NATS TCP client in Node.js to avoid WebSocket conflict
        // with libp2p's @libp2p/websockets. Fall back to nats.ws for browser.
        let nats: any;
        const isNode = typeof globalThis.process !== 'undefined' && globalThis.process.versions?.node;
        if (isNode) {
          try {
            nats = await import('nats');
            // Use TCP servers (port 4222) instead of WS (port 8443)
            const tcpServers = this.config.servers.map(s =>
              s.replace('wss://', 'nats://').replace(':8443', ':4222'));
            this.nc = await nats.connect({
              servers: tcpServers.length > 0 ? tcpServers : ['nats://demo.nats.io:4222'],
              timeout: 5000,
              reconnect: true,
              maxReconnectAttempts: 5,
            });
            log.info(`Connected to NATS (TCP): ${tcpServers.join(', ')}`);
            return true;
          } catch {
            // TCP failed — fall through to WS
            nats = await import('nats.ws');
          }
        } else {
          nats = await import('nats.ws');
        }
        this.nc = await nats.connect({
          servers: this.config.servers,
          timeout: 5000,
          reconnect: true,
          maxReconnectAttempts: 5,
        });
        log.info(`Connected to NATS: ${this.config.servers.join(', ')}`);
        return true;
      } catch (err) {
        log.warn(`NATS attempt ${attempt}/${retries}: ${(err as Error)?.message ?? err}`);
        if (attempt < retries) await new Promise(r => setTimeout(r, delayMs));
      }
    }
    log.warn('NATS connection failed (will use other discovery)');
    return false;
  }

  async subscribe(onPeer: (announcement: NatsAgentAnnouncement) => void): Promise<void> {
    if (!this.nc) return;
    this.onPeerDiscovered = onPeer;

    try {
      const nats = await import('nats.ws');
      const codec = nats.StringCodec();

      for (const subject of this.config.subjects) {
        const sub = this.nc.subscribe(subject);
        this.subs.push(sub);
        (async () => {
          for await (const msg of sub) {
            try {
              const data = JSON.parse(codec.decode(msg.data));
              if (data.type === 'nexus.announce' && data.peerId) {
                this.onPeerDiscovered?.(data);
              }
            } catch {}
          }
        })().catch(() => {});
      }
      log.info(`Subscribed to ${this.config.subjects.length} NATS subjects`);
    } catch (err) {
      log.warn(`NATS subscribe failed: ${err}`);
    }
  }

  async announce(announcement: NatsAgentAnnouncement): Promise<void> {
    if (!this.nc) return;
    try {
      const nats = await import('nats.ws');
      const codec = nats.StringCodec();
      const data = codec.encode(JSON.stringify(announcement));
      for (const subject of this.config.subjects) {
        this.nc.publish(subject, data);
      }
    } catch (err) {
      log.debug(`NATS announce failed: ${err}`);
    }
  }

  async disconnect(): Promise<void> {
    for (const sub of this.subs) {
      try { sub.unsubscribe(); } catch {}
    }
    this.subs = [];
    if (this.nc) {
      try { await this.nc.drain(); await this.nc.close(); } catch {}
      this.nc = null;
      log.info('NATS disconnected');
    }
  }

  get isConnected(): boolean {
    return this.nc !== null;
  }
}
