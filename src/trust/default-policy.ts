import type { TrustPolicy } from './policy.js';
import { createLogger } from '../logger.js';

const log = createLogger('trust');

export interface TrustConfig {
  allowlist?: string[];       // PeerIds always allowed
  denylist?: string[];        // PeerIds always blocked
  maxUnknownPeers?: number;   // limit connections from unknown peers
  roomDenylist?: string[];    // room IDs to refuse
}

export class DefaultTrustPolicy implements TrustPolicy {
  private allowSet: Set<string>;
  private denySet: Set<string>;
  private roomDenySet: Set<string>;

  constructor(config: TrustConfig = {}) {
    this.allowSet = new Set(config.allowlist ?? []);
    this.denySet = new Set(config.denylist ?? []);
    this.roomDenySet = new Set(config.roomDenylist ?? []);
  }

  allowPeer(peerId: string): boolean {
    if (this.denySet.has(peerId)) {
      log.warn(`Peer denied: ${peerId.slice(0, 12)}...`);
      return false;
    }
    // If allowlist is non-empty, only allow listed peers
    if (this.allowSet.size > 0 && !this.allowSet.has(peerId)) {
      return false;
    }
    return true;
  }

  allowRoom(roomId: string, peerId: string): boolean {
    if (!this.allowPeer(peerId)) return false;
    if (this.roomDenySet.has(roomId)) return false;
    return true;
  }

  allowCapability(peerId: string, capability: string): boolean {
    return this.allowPeer(peerId);
  }

  allowRelay(peerId: string): boolean {
    return this.allowPeer(peerId);
  }

  // Dynamic mutation
  addToAllowlist(peerId: string): void { this.allowSet.add(peerId); }
  removeFromAllowlist(peerId: string): void { this.allowSet.delete(peerId); }
  addToDenylist(peerId: string): void { this.denySet.add(peerId); }
  removeFromDenylist(peerId: string): void { this.denySet.delete(peerId); }
  denyRoom(roomId: string): void { this.roomDenySet.add(roomId); }
  allowRoomId(roomId: string): void { this.roomDenySet.delete(roomId); }
}
