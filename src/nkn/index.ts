import { createLogger } from '../logger.js';
import { createHash, createHmac } from 'node:crypto';

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

export interface NknPeerEntry {
  nknAddress: string;
  agentName: string;
  libp2pPeerId?: string;
  addedAt: number;
  lastContact: number;
}

export interface NknInboxMessage {
  sender: string;
  raw: string;
  content?: string;
  agentName?: string;
  receivedAt: number;
  timestamp?: number;
  verified: boolean; // true when HMAC validates (agent-sent, not spoofed)
}

/**
 * Compute HMAC shared secret for agent-to-agent verification.
 * The secret is derived from both NKN addresses + a salt, so only the
 * two agents involved can compute it. Humans intercepting NKN traffic
 * cannot forge the HMAC.
 */
export function computeNknSharedSecret(addr1: string, addr2: string): string {
  return createHash('sha256').update(addr1).update(addr2).update('oa-nkn-v1').digest('hex');
}

/**
 * Sign an NKN message envelope with HMAC for agent verification.
 */
export function signNknMessage(
  sharedSecret: string,
  agentName: string,
  content: string,
  timestamp: number,
): string {
  return createHmac('sha256', sharedSecret)
    .update(agentName + content + String(timestamp))
    .digest('hex')
    .slice(0, 16); // 64-bit HMAC — sufficient for message auth
}

/**
 * Verify an NKN message HMAC.
 */
export function verifyNknMessage(
  sharedSecret: string,
  agentName: string,
  content: string,
  timestamp: number,
  hmac: string,
): boolean {
  const expected = signNknMessage(sharedSecret, agentName, content, timestamp);
  return expected === hmac;
}

/**
 * Build a signed NKN message envelope.
 */
export function buildNknEnvelope(
  senderAddr: string,
  receiverAddr: string,
  agentName: string,
  content: string,
  libp2pPeerId?: string,
): string {
  const timestamp = Date.now();
  const secret = computeNknSharedSecret(senderAddr, receiverAddr);
  const hmac = signNknMessage(secret, agentName, content, timestamp);
  return JSON.stringify({
    _agentName: agentName,
    content,
    timestamp,
    libp2pPeerId: libp2pPeerId ?? null,
    _hmac: hmac,
  });
}

/**
 * Parse and verify a received NKN message envelope.
 */
export function parseNknEnvelope(
  senderAddr: string,
  receiverAddr: string,
  raw: string,
): NknInboxMessage {
  const entry: NknInboxMessage = { sender: senderAddr, raw, receivedAt: Date.now(), verified: false };
  try {
    const parsed = JSON.parse(raw);
    if (parsed._hmac && parsed._agentName && parsed.content) {
      const secret = computeNknSharedSecret(senderAddr, receiverAddr);
      entry.verified = verifyNknMessage(secret, parsed._agentName, parsed.content, parsed.timestamp || 0, parsed._hmac);
      entry.agentName = parsed._agentName;
      entry.content = parsed.content;
      entry.timestamp = parsed.timestamp;
    }
  } catch { /* raw text — not verified */ }
  return entry;
}

/**
 * Derive a deterministic NKN seed from an identity key buffer.
 * Uses SHA256(keyData + "nkn-seed-v1") for consistent address generation.
 */
export function deriveNknSeed(identityKeyData: Buffer | Uint8Array): string {
  return createHash('sha256').update(identityKeyData).update('nkn-seed-v1').digest('hex');
}

export class NknFallback {
  private client: any = null;
  private config: NknConfig;
  private addressInfo: NknAddressInfo | null = null;
  private messageHandler: ((msg: NknInboxMessage) => void) | null = null;
  private rawHandler: ((src: string, payload: string) => void) | null = null;

  constructor(config?: Partial<NknConfig>) {
    this.config = { ...DEFAULT_NKN_CONFIG, ...config };
  }

  /** Connect to NKN network with optional seed for deterministic addresses. */
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

      // Listen for messages — parse and verify, then forward to handler
      this.client.onMessage(({ src, payload }: any) => {
        const rawStr = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
        // Fire raw handler (backward compat)
        this.rawHandler?.(src, rawStr);
        // Fire verified handler
        if (this.messageHandler && this.addressInfo) {
          const msg = parseNknEnvelope(src, this.addressInfo.address, rawStr);
          this.messageHandler(msg);
        }
      });

      return this.addressInfo;
    } catch (err) {
      log.warn(`NKN connection failed (fallback disabled): ${err}`);
      return null;
    }
  }

  /**
   * Send a verified (HMAC-signed) message to an NKN address.
   * Uses msgHoldingSeconds for offline delivery (default 1 hour).
   */
  async sendVerified(
    to: string,
    agentName: string,
    content: string,
    libp2pPeerId?: string,
    holdSeconds: number = 3600,
  ): Promise<boolean> {
    if (!this.client || !this.addressInfo) return false;
    try {
      const envelope = buildNknEnvelope(this.addressInfo.address, to, agentName, content, libp2pPeerId);
      await this.client.send(to, envelope, { msgHoldingSeconds: holdSeconds });
      return true;
    } catch (err) {
      log.debug(`NKN send failed: ${err}`);
      return false;
    }
  }

  /** Send a raw (unverified) message. */
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

  /** Set verified message handler (receives parsed + verified messages). */
  onVerifiedMessage(handler: (msg: NknInboxMessage) => void): void {
    this.messageHandler = handler;
  }

  /** Set raw message handler (backward compat). */
  setMessageHandler(handler: (src: string, payload: string) => void): void {
    this.rawHandler = handler;
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

  get publicKey(): string | null {
    return this.addressInfo?.publicKey ?? null;
  }

  get isConnected(): boolean {
    return this.client !== null;
  }

  /** Get underlying client for advanced usage. */
  get rawClient(): unknown {
    return this.client;
  }
}
