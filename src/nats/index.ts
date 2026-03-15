import { createLogger } from '../logger.js';

const log = createLogger('nats');

// Public NATS servers agents can connect to for discovery
export const NATS_DISCOVERY_SERVERS = [
  'wss://demo.nats.io:8443',
];

// Subject for nexus agent discovery
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

// Agent announcement published via NATS
export interface NatsAgentAnnouncement {
  type: 'nexus.announce';
  peerId: string;
  agentName: string;
  rooms: string[];
  multiaddrs: string[];
  timestamp: number;
}

export class NatsDiscovery {
  private nc: any = null; // NATS connection
  private subs: any[] = [];
  private config: NatsDiscoveryConfig;
  private onPeerDiscovered: ((announcement: NatsAgentAnnouncement) => void) | null = null;

  constructor(config?: Partial<NatsDiscoveryConfig>) {
    this.config = { ...DEFAULT_NATS_CONFIG, ...config };
  }

  async connect(): Promise<boolean> {
    if (!this.config.enabled) return false;

    try {
      // Dynamic import — nats.ws may not be available in all environments
      const nats = await import('nats.ws');
      this.nc = await nats.connect({
        servers: this.config.servers,
        timeout: 5000,
        reconnect: true,
        maxReconnectAttempts: 3,
      });
      log.info(`Connected to NATS: ${this.config.servers.join(', ')}`);
      return true;
    } catch (err) {
      log.warn(`NATS connection failed (will use other discovery): ${err}`);
      return false;
    }
  }

  // Subscribe to discovery announcements
  async subscribe(onPeer: (announcement: NatsAgentAnnouncement) => void): Promise<void> {
    if (!this.nc) return;
    this.onPeerDiscovered = onPeer;

    try {
      const codec = (await import('nats.ws')).StringCodec();

      for (const subject of this.config.subjects) {
        const sub = this.nc.subscribe(subject);
        this.subs.push(sub);

        // Process messages async
        (async () => {
          for await (const msg of sub) {
            try {
              const data = JSON.parse(codec.decode(msg.data));
              if (data.type === 'nexus.announce' && data.peerId) {
                this.onPeerDiscovered?.(data);
              }
            } catch { /* ignore malformed messages */ }
          }
        })().catch(() => {});
      }

      log.info(`Subscribed to ${this.config.subjects.length} NATS subjects`);
    } catch (err) {
      log.warn(`NATS subscribe failed: ${err}`);
    }
  }

  // Publish our presence
  async announce(announcement: NatsAgentAnnouncement): Promise<void> {
    if (!this.nc) return;

    try {
      const codec = (await import('nats.ws')).StringCodec();
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
      try { sub.unsubscribe(); } catch { /* ignore */ }
    }
    this.subs = [];

    if (this.nc) {
      try {
        await this.nc.drain();
        await this.nc.close();
      } catch { /* ignore */ }
      this.nc = null;
      log.info('NATS disconnected');
    }
  }

  get isConnected(): boolean {
    return this.nc !== null;
  }
}
