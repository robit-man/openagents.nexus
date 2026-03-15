/**
 * Agent capability registry
 *
 * Stores and queries agent capabilities in the DHT.
 * Enables discovery of agents by what they can do (e.g., "code-review",
 * "translation", "summarization") rather than just by peer ID.
 */

import { createLogger } from '../logger.js';
import type { AgentProfile, RoomManifest } from '../protocol/types.js';
import { validateAgentProfile, validateRoomManifest } from '../security/validators.js';

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(dht: any) {
    this.dht = dht;
  }

  // Publish agent profile to DHT
  async publishProfile(profile: AgentProfile): Promise<void> {
    const key = new TextEncoder().encode(KEYS.agent(profile.peerId));
    const value = new TextEncoder().encode(JSON.stringify(profile));

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
          const data = new TextDecoder().decode(event.value);
          const parsed = validateAgentProfile(JSON.parse(data));
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
    const value = new TextEncoder().encode(JSON.stringify(manifest));

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
          const data = new TextDecoder().decode(event.value);
          const parsed = validateRoomManifest(JSON.parse(data));
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
