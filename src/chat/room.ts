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

export interface SendOptions {
  format?: ContentFormat;
  replyTo?: string | null;
  threadId?: string | null;
}

type RoomEventMap = {
  message: NexusMessage;
  presence: NexusMessage;
  sync: { loaded: number; total: number };
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
  private joined = false;

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
}
