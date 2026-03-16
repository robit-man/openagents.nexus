/**
 * Chat room management
 *
 * Manages the lifecycle of chat rooms built on GossipSub topics.
 * Handles room creation, joining, leaving, and listing active rooms.
 */

import { NexusRoom } from './room.js';
import type { AgentInfo } from './messages.js';
import type { ContentPropagation } from '../storage/propagation.js';
import { createLogger } from '../logger.js';

const log = createLogger('chat');

export class RoomManager {
  private rooms = new Map<string, NexusRoom>();
  private peerId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pubsub: any;
  private agentInfo: AgentInfo;
  private propagation: ContentPropagation | null;

  constructor(
    peerId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pubsub: any,
    agentInfo: AgentInfo,
    propagation: ContentPropagation | null = null,
  ) {
    this.peerId = peerId;
    this.pubsub = pubsub;
    this.agentInfo = agentInfo;
    this.propagation = propagation;
  }

  async joinRoom(roomId: string): Promise<NexusRoom> {
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId)!;
    }

    const room = new NexusRoom(
      roomId,
      this.peerId,
      this.pubsub,
      this.agentInfo,
      this.propagation,
    );
    await room.join();
    this.rooms.set(roomId, room);
    log.info(`Joined room: ${roomId}`);
    return room;
  }

  async leaveRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (room) {
      await room.leave();
      this.rooms.delete(roomId);
      log.info(`Left room: ${roomId}`);
    }
  }

  async leaveAll(): Promise<void> {
    const promises = Array.from(this.rooms.keys()).map(id => this.leaveRoom(id));
    await Promise.all(promises);
  }

  getRoom(roomId: string): NexusRoom | undefined {
    return this.rooms.get(roomId);
  }

  getJoinedRooms(): string[] {
    return Array.from(this.rooms.keys());
  }
}

export { NexusRoom } from './room.js';
export type { RoomMember } from './room.js';
export { createChatMessage, createPresenceMessage, createMetaMessage } from './messages.js';
