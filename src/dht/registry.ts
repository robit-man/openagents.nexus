/**
 * Agent capability registry
 *
 * Stores and queries agent capabilities in the DHT.
 * Enables discovery of agents by what they can do (e.g., "code-review",
 * "translation", "summarization") rather than just by peer ID.
 *
 * When a PrivateKey is provided at construction time every mutable record
 * (profile, room manifest) is wrapped in a signed PointerEnvelope before
 * being stored, and validated on read.  The registry falls back to raw JSON
 * when no key is supplied (backward-compatible mode).
 */

import { createLogger } from '../logger.js';
import type { AgentProfile, RoomManifest } from '../protocol/types.js';
import { validateAgentProfile, validateRoomManifest } from '../security/validators.js';
import type { PrivateKey } from '@libp2p/interface';
import type { PointerEnvelope } from '../protocol/pointer-envelope.js';
import { POINTER_TTLS } from '../protocol/pointer-envelope.js';
import { signEnvelope, validateEnvelope } from '../protocol/signing.js';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';

const log = createLogger('dht:registry');

// Key patterns for DHT records
const KEYS = {
  agent: (peerId: string) => `/nexus/agent/${peerId}`,
  room: (roomId: string) => `/nexus/room/${roomId}`,
  capability: (name: string) => `/nexus/capability/${name}`,
  pin: (cid: string) => `/nexus/pin/${cid}`,
} as const;

export class DHTRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dht: any;
  private privateKey: PrivateKey | undefined;
  private peerId: string | undefined;

  /** Monotonically increasing sequence numbers keyed by `kind:issuerId`. */
  private seqCounters = new Map<string, number>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(dht: any, privateKey?: PrivateKey) {
    this.dht = dht;
    this.privateKey = privateKey;
    if (privateKey) {
      this.peerId = peerIdFromPrivateKey(privateKey).toString();
    }
  }

  // ---- internal helpers ----

  /** Return the next sequence number for `kind`. */
  private nextSeq(kind: PointerEnvelope['kind']): number {
    const key = `${kind}:${this.peerId ?? ''}`;
    const next = (this.seqCounters.get(key) ?? 0) + 1;
    this.seqCounters.set(key, next);
    return next;
  }

  /**
   * Build, sign, and encode a PointerEnvelope around `cid`.
   * The `cid` field carries the JSON-serialized payload as an inline summary.
   */
  private async buildEnvelope(
    kind: PointerEnvelope['kind'],
    cid: string,
  ): Promise<Uint8Array> {
    if (!this.privateKey || !this.peerId) {
      throw new Error('No private key configured for signing');
    }

    const now = Date.now();
    const ttl = POINTER_TTLS[kind];
    const base: Omit<PointerEnvelope, 'sig'> = {
      schema: 'nexus:pointer-envelope:v1',
      kind,
      issuer: this.peerId,
      cid,
      seq: this.nextSeq(kind),
      issuedAt: now,
      expiresAt: now + ttl,
    };

    const signed = await signEnvelope(base, this.privateKey);
    return new TextEncoder().encode(JSON.stringify(signed));
  }

  /**
   * Decode and validate a stored value.
   * Returns the PointerEnvelope if it is a valid signed envelope, null otherwise.
   * If the stored bytes are raw (no envelope schema), returns null with a warning.
   */
  private async decodeEnvelope(data: Uint8Array): Promise<PointerEnvelope | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(data));
    } catch {
      log.warn('Stored DHT value is not valid JSON');
      return null;
    }

    const obj = parsed as Record<string, unknown>;
    if (obj.schema !== 'nexus:pointer-envelope:v1') {
      // Legacy raw record — caller will handle via old path
      return null;
    }

    const envelope = parsed as PointerEnvelope;
    const result = await validateEnvelope(envelope);
    if (!result.valid) {
      log.warn(`Invalid envelope: ${result.reason}`);
      return null;
    }

    return envelope;
  }

  // ---- public API ----

  // Publish agent profile to DHT
  async publishProfile(profile: AgentProfile): Promise<void> {
    const key = new TextEncoder().encode(KEYS.agent(profile.peerId));

    // Inline the serialized profile as the CID field for small records.
    // Full nodes would store the actual data in IPFS and put the real CID here.
    const inlineCid = JSON.stringify(profile);

    const value = this.privateKey
      ? await this.buildEnvelope('profile-pointer', inlineCid)
      : new TextEncoder().encode(inlineCid);

    try {
      for await (const _ of this.dht.put(key, value)) {
        // drain the iterator
      }
      log.info(`Published profile for ${profile.peerId}`);
    } catch (err) {
      log.error(`Failed to publish profile: ${err}`);
      throw err;
    }
  }

  // Lookup agent profile from DHT
  async findProfile(peerId: string): Promise<AgentProfile | null> {
    const key = new TextEncoder().encode(KEYS.agent(peerId));

    try {
      for await (const event of this.dht.get(key)) {
        if (event.name === 'VALUE') {
          // Try to decode as a signed envelope first
          const envelope = await this.decodeEnvelope(event.value);
          if (envelope !== null) {
            // cid holds the inline serialized profile
            const parsed = validateAgentProfile(JSON.parse(envelope.cid));
            if (!parsed) {
              log.warn(`Invalid agent profile schema for ${peerId}`);
              return null;
            }
            return parsed;
          }

          // Fall through to legacy raw JSON path (no envelope)
          const data = new TextDecoder().decode(event.value);
          let rawObj: unknown;
          try {
            rawObj = JSON.parse(data);
          } catch {
            log.warn(`Stored profile for ${peerId} is not valid JSON`);
            return null;
          }
          const parsed = validateAgentProfile(rawObj);
          if (!parsed) {
            log.warn(`Invalid agent profile schema for ${peerId}`);
            return null;
          }
          return parsed;
        }
      }
    } catch (err) {
      log.debug(`Profile not found for ${peerId}: ${err}`);
    }
    return null;
  }

  // Publish room manifest to DHT
  async publishRoom(manifest: RoomManifest): Promise<void> {
    const key = new TextEncoder().encode(KEYS.room(manifest.roomId));
    const inlineCid = JSON.stringify(manifest);

    const value = this.privateKey
      ? await this.buildEnvelope('room-pointer', inlineCid)
      : new TextEncoder().encode(inlineCid);

    try {
      for await (const _ of this.dht.put(key, value)) {
        // drain
      }
      log.info(`Published room manifest: ${manifest.roomId}`);
    } catch (err) {
      log.error(`Failed to publish room: ${err}`);
      throw err;
    }
  }

  // Lookup room from DHT
  async findRoom(roomId: string): Promise<RoomManifest | null> {
    const key = new TextEncoder().encode(KEYS.room(roomId));

    try {
      for await (const event of this.dht.get(key)) {
        if (event.name === 'VALUE') {
          // Try to decode as a signed envelope first
          const envelope = await this.decodeEnvelope(event.value);
          if (envelope !== null) {
            const parsed = validateRoomManifest(JSON.parse(envelope.cid));
            if (!parsed) {
              log.warn(`Invalid room manifest schema for ${roomId}`);
              return null;
            }
            return parsed;
          }

          // Fall through to legacy raw JSON path
          const data = new TextDecoder().decode(event.value);
          let rawObj: unknown;
          try {
            rawObj = JSON.parse(data);
          } catch {
            log.warn(`Stored room manifest for ${roomId} is not valid JSON`);
            return null;
          }
          const parsed = validateRoomManifest(rawObj);
          if (!parsed) {
            log.warn(`Invalid room manifest schema for ${roomId}`);
            return null;
          }
          return parsed;
        }
      }
    } catch (err) {
      log.debug(`Room not found: ${roomId}: ${err}`);
    }
    return null;
  }

  // Advertise a capability (best-effort: swallows errors)
  async advertiseCapability(name: string, peerId: string): Promise<void> {
    const key = new TextEncoder().encode(KEYS.capability(name));
    const value = new TextEncoder().encode(
      JSON.stringify({ provider: peerId, timestamp: Date.now() }),
    );

    try {
      for await (const _ of this.dht.put(key, value)) {
        // drain
      }
      log.info(`Advertised capability: ${name}`);
    } catch (err) {
      log.error(`Failed to advertise capability: ${err}`);
      // Swallow — capability advertising is best-effort
    }
  }
}

export { KEYS as DHT_KEYS };
