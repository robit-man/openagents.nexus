/**
 * Individual room implementation
 *
 * Represents a single chat room backed by a GossipSub topic.
 * Handles message publishing, subscription, history retrieval,
 * and member tracking within a room.
 *
 * When a message arrives with non-empty `references` (CIDs), the optional
 * ContentPropagation instance is notified so it can auto-pin those CIDs —
 * implementing the viral content redundancy mechanism.
 */

import {
  encodeMessage,
  decodeMessage,
  roomTopic,
} from '../protocol/index.js';
import type { NexusMessage, ContentFormat } from '../protocol/index.js';
import { createChatMessage, createPresenceMessage } from './messages.js';
import type { AgentInfo } from './messages.js';
import type { ContentPropagation } from '../storage/propagation.js';
import { MAX_REFS_PER_MESSAGE } from '../storage/propagation.js';
import { validateNexusMessage } from '../security/validators.js';
import { createLogger } from '../logger.js';

const log = createLogger('chat:room');

const PRESENCE_INTERVAL_MS = 60_000;
const STALE_TIMEOUT_MS = PRESENCE_INTERVAL_MS * 2; // 120s — 2x heartbeat

export interface RoomMember {
  peerId: string;
  agentName: string;
  agentType: string;
  status: 'online' | 'idle' | 'busy' | 'offline';
  capabilities: string[];
  lastSeen: number;
}

export interface SendOptions {
  format?: ContentFormat;
  replyTo?: string | null;
  threadId?: string | null;
}

type RoomEventMap = {
  message: NexusMessage;
  presence: NexusMessage;
  sync: { loaded: number; total: number };
  'member:join': RoomMember;
  'member:leave': RoomMember;
};

type RoomEventListener<K extends keyof RoomEventMap> = (value: RoomEventMap[K]) => void;

export class NexusRoom {
  readonly roomId: string;
  readonly topic: string;

  private peerId: string;
  private pubsub: any;
  private agentInfo: AgentInfo;
  private propagation: ContentPropagation | null;
  private listeners = new Map<string, Set<(value: any) => void>>();
  private pubsubHandler: ((evt: any) => void) | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private staleEvictionTimer: ReturnType<typeof setInterval> | null = null;
  private joined = false;
  private memberMap = new Map<string, RoomMember>();

  constructor(
    roomId: string,
    peerId: string,
    pubsub: any,
    agentInfo: AgentInfo,
    propagation: ContentPropagation | null = null,
  ) {
    this.roomId = roomId;
    this.topic = roomTopic(roomId);
    this.peerId = peerId;
    this.pubsub = pubsub;
    this.agentInfo = agentInfo;
    this.propagation = propagation;
  }

  on<K extends keyof RoomEventMap>(event: K, listener: RoomEventListener<K>): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as (value: any) => void);
    return this;
  }

  off<K extends keyof RoomEventMap>(event: K, listener: RoomEventListener<K>): this {
    this.listeners.get(event)?.delete(listener as (value: any) => void);
    return this;
  }

  private emit<K extends keyof RoomEventMap>(event: K, value: RoomEventMap[K]): void {
    this.listeners.get(event)?.forEach(fn => fn(value));
  }

  async join(): Promise<void> {
    this.pubsub.subscribe(this.topic);

    // Register pubsub message handler
    this.pubsubHandler = (evt: any) => {
      const detail = evt?.detail;
      if (!detail) return;
      if (detail.topic !== this.topic) return;
      try {
        const raw = decodeMessage(detail.data);

        // Validate message structure; drop malformed messages
        const msg = validateNexusMessage(raw);
        if (!msg) {
          log.debug('Dropping invalid message from pubsub');
          return;
        }

        // Clamp references to MAX_REFS_PER_MESSAGE before passing to propagation
        const clampedRefs = msg.references
          ? msg.references.slice(0, MAX_REFS_PER_MESSAGE)
          : [];

        // Viral pinning: auto-pin any CIDs referenced in the message
        if (this.propagation && clampedRefs.length > 0) {
          this.propagation
            .onContentReceived(clampedRefs, msg.sender)
            .catch((err: unknown) => {
              log.debug(`Propagation error for ${msg.id}: ${err}`);
            });
        }

        if (msg.type === 'chat') {
          this.emit('message', msg);
        } else if (msg.type === 'presence') {
          this.emit('presence', msg);
          this.trackMemberPresence(msg);
        }
      } catch {
        // Silently ignore malformed messages
      }
    };
    this.pubsub.addEventListener('message', this.pubsubHandler);

    // Announce presence
    await this.publishPresence('online');

    // Start heartbeat
    this.heartbeatInterval = setInterval(async () => {
      await this.publishPresence('online');
    }, PRESENCE_INTERVAL_MS);

    // Start stale member eviction (check every 30s)
    this.staleEvictionTimer = setInterval(() => {
      this.evictStaleMembers();
    }, 30_000);

    this.joined = true;
    log.info(`Joined room: ${this.roomId}`);
  }

  async send(content: string, options: SendOptions = {}): Promise<string> {
    const msg = createChatMessage(this.roomId, this.peerId, content, {
      format: options.format,
      replyTo: options.replyTo,
      threadId: options.threadId,
    });
    await this.pubsub.publish(this.topic, encodeMessage(msg));
    return msg.id;
  }

  async leave(): Promise<void> {
    if (!this.joined) return;

    // Stop heartbeat
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Stop stale eviction
    if (this.staleEvictionTimer !== null) {
      clearInterval(this.staleEvictionTimer);
      this.staleEvictionTimer = null;
    }

    // Publish offline presence
    await this.publishPresence('offline');

    // Remove pubsub handler
    if (this.pubsubHandler !== null) {
      this.pubsub.removeEventListener('message', this.pubsubHandler);
      this.pubsubHandler = null;
    }

    this.pubsub.unsubscribe(this.topic);
    this.joined = false;
    log.info(`Left room: ${this.roomId}`);
  }

  private async publishPresence(status: 'online' | 'idle' | 'busy' | 'offline'): Promise<void> {
    const msg = createPresenceMessage(this.roomId, this.peerId, status, this.agentInfo);
    await this.pubsub.publish(this.topic, encodeMessage(msg));
  }

  // --- Member tracking ---

  private trackMemberPresence(msg: NexusMessage): void {
    const payload = msg.payload as any;
    if (!payload || !payload.status) return;

    const peerId = msg.sender;
    const existing = this.memberMap.get(peerId);

    if (payload.status === 'offline') {
      if (existing) {
        this.memberMap.delete(peerId);
        this.emit('member:leave', existing);
      }
      return;
    }

    const member: RoomMember = {
      peerId,
      agentName: payload.agentName ?? '',
      agentType: payload.agentType ?? '',
      status: payload.status,
      capabilities: payload.capabilities ?? [],
      lastSeen: msg.timestamp,
    };

    const isNew = !existing;
    this.memberMap.set(peerId, member);

    if (isNew) {
      this.emit('member:join', member);
    }
  }

  private evictStaleMembers(): void {
    const cutoff = Date.now() - STALE_TIMEOUT_MS;
    for (const [peerId, member] of this.memberMap) {
      if (member.lastSeen < cutoff) {
        this.memberMap.delete(peerId);
        this.emit('member:leave', member);
        log.debug(`Evicted stale member ${peerId.slice(0, 12)}... from ${this.roomId}`);
      }
    }
  }

  get members(): RoomMember[] {
    return Array.from(this.memberMap.values());
  }

  getMember(peerId: string): RoomMember | undefined {
    return this.memberMap.get(peerId);
  }

  findMemberByName(name: string): RoomMember | undefined {
    for (const member of this.memberMap.values()) {
      if (member.agentName === name) return member;
    }
    return undefined;
  }
}
