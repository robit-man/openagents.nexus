import { createLogger } from '../logger.js';

const log = createLogger('storage:retention');

export type RetentionClass = 'ephemeral' | 'cache' | 'retained' | 'mirrored' | 'archival';

export interface RetentionConfig {
  maxTotalBytes: number;                            // default 500MB
  maxPerRoomBytes: number;                          // default 100MB
  ttlByClass: Record<RetentionClass, number>;       // ms
  allowedMirrorRooms: string[];                     // room IDs to mirror
  gcIntervalMs: number;                             // default 60000
}

export const DEFAULT_RETENTION: RetentionConfig = {
  maxTotalBytes: 500 * 1024 * 1024,
  maxPerRoomBytes: 100 * 1024 * 1024,
  ttlByClass: {
    ephemeral: 60 * 60 * 1000,            // 1h
    cache: 24 * 60 * 60 * 1000,           // 24h
    retained: 7 * 24 * 60 * 60 * 1000,   // 7d
    mirrored: 30 * 24 * 60 * 60 * 1000,  // 30d
    archival: Infinity,
  },
  allowedMirrorRooms: [],
  gcIntervalMs: 60_000,
};

export interface StoredObject {
  cid: string;
  roomId?: string;
  retentionClass: RetentionClass;
  storedAt: number;
  sizeBytes: number;
}

export class RetentionPolicyEngine {
  private config: RetentionConfig;
  private objects = new Map<string, StoredObject>(); // cid -> StoredObject

  constructor(config?: Partial<RetentionConfig>) {
    this.config = { ...DEFAULT_RETENTION, ...config };
  }

  // Check if an object should be accepted based on retention policy
  shouldAccept(obj: StoredObject): { accept: boolean; reason?: string } {
    // Check total budget
    const totalSize = this.getTotalSize();
    if (totalSize + obj.sizeBytes > this.config.maxTotalBytes) {
      return { accept: false, reason: 'Total storage budget exceeded' };
    }

    // Check per-room budget
    if (obj.roomId) {
      const roomSize = this.getRoomSize(obj.roomId);
      if (roomSize + obj.sizeBytes > this.config.maxPerRoomBytes) {
        return { accept: false, reason: 'Per-room storage budget exceeded' };
      }
    }

    // Check mirror room allowlist
    if (obj.retentionClass === 'mirrored' && obj.roomId) {
      if (
        this.config.allowedMirrorRooms.length > 0 &&
        !this.config.allowedMirrorRooms.includes(obj.roomId)
      ) {
        return { accept: false, reason: 'Room not in mirror allowlist' };
      }
    }

    return { accept: true };
  }

  // Track a stored object
  track(obj: StoredObject): void {
    this.objects.set(obj.cid, obj);
  }

  // Remove tracking
  untrack(cid: string): void {
    this.objects.delete(cid);
  }

  // Get objects that should be garbage collected
  getExpired(): string[] {
    const now = Date.now();
    const expired: string[] = [];
    for (const [cid, obj] of this.objects) {
      const ttl = this.config.ttlByClass[obj.retentionClass];
      if (ttl !== Infinity && now - obj.storedAt > ttl) {
        expired.push(cid);
      }
    }
    return expired;
  }

  // Run GC — returns CIDs that were removed
  gc(): string[] {
    const expired = this.getExpired();
    for (const cid of expired) {
      this.objects.delete(cid);
    }
    if (expired.length > 0) {
      log.info(`GC removed ${expired.length} expired objects`);
    }
    return expired;
  }

  getTotalSize(): number {
    let total = 0;
    for (const obj of this.objects.values()) total += obj.sizeBytes;
    return total;
  }

  getRoomSize(roomId: string): number {
    let total = 0;
    for (const obj of this.objects.values()) {
      if (obj.roomId === roomId) total += obj.sizeBytes;
    }
    return total;
  }

  getTrackedCount(): number {
    return this.objects.size;
  }
}
