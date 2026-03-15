import { createLogger } from '../logger.js';

const log = createLogger('nkn');

export interface NknConfig {
  enabled: boolean;
  identifier: string; // prefix for the NKN address
  numSubClients: number; // number of concurrent sub-clients
}

export const DEFAULT_NKN_CONFIG: NknConfig = {
  enabled: false, // disabled by default — opt-in fallback
  identifier: 'nexus',
  numSubClients: 3,
};

export interface NknAddressInfo {
  address: string;
  publicKey: string;
  seed: string; // hex seed — NEVER share this
}

export class NknFallback {
  private client: any = null;
  private config: NknConfig;
  private addressInfo: NknAddressInfo | null = null;
  private onMessage: ((src: string, payload: string) => void) | null = null;

  constructor(config?: Partial<NknConfig>) {
    this.config = { ...DEFAULT_NKN_CONFIG, ...config };
  }

  // Generate or load an NKN address
  async connect(seed?: string): Promise<NknAddressInfo | null> {
    if (!this.config.enabled) return null;

    try {
      const nkn = await import('nkn-sdk');

      const clientOpts: any = {
        identifier: this.config.identifier,
        numSubClients: this.config.numSubClients,
      };
      if (seed) clientOpts.seed = seed;

      this.client = new nkn.MultiClient(clientOpts);

      // Wait for ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('NKN connect timeout')), 15000);
        this.client.onConnect(() => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.addressInfo = {
        address: this.client.addr,
        publicKey: this.client.getPublicKey(),
        seed: this.client.getSeed(),
      };

      log.info(`NKN connected: ${this.addressInfo.address}`);

      // Listen for messages
      this.client.onMessage(({ src, payload }: any) => {
        this.onMessage?.(src, typeof payload === 'string' ? payload : new TextDecoder().decode(payload));
      });

      return this.addressInfo;
    } catch (err) {
      log.warn(`NKN connection failed (fallback disabled): ${err}`);
      return null;
    }
  }

  // Send a message to an NKN address
  async send(to: string, message: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.send(to, message);
      return true;
    } catch (err) {
      log.debug(`NKN send failed: ${err}`);
      return false;
    }
  }

  // Set message handler
  setMessageHandler(handler: (src: string, payload: string) => void): void {
    this.onMessage = handler;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try { await this.client.close(); } catch { /* ignore */ }
      this.client = null;
      this.addressInfo = null;
      log.info('NKN disconnected');
    }
  }

  get address(): string | null {
    return this.addressInfo?.address ?? null;
  }

  get isConnected(): boolean {
    return this.client !== null;
  }
}
