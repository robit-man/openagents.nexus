/**
 * Message types and serialization
 *
 * Defines the message format for chat communication:
 * - Text messages, structured data, file references
 * - Serialization/deserialization (JSON + binary for efficiency)
 * - Message signing and verification
 */

import {
  createMessage,
  roomTopic,
  TOPICS,
} from '../protocol/index.js';
import type {
  NexusMessage,
  ContentFormat,
  PresenceStatus,
} from '../protocol/index.js';

export interface ChatMessageOptions {
  format?: ContentFormat;
  replyTo?: string | null;
  threadId?: string | null;
}

export function createChatMessage(
  roomId: string,
  peerId: string,
  content: string,
  options: ChatMessageOptions = {},
): NexusMessage {
  return createMessage(
    'chat',
    roomTopic(roomId),
    peerId,
    {
      content,
      format: options.format ?? 'text/plain',
      replyTo: options.replyTo ?? null,
      threadId: options.threadId ?? null,
    },
  );
}

export interface AgentInfo {
  name: string;
  type: string;
  capabilities: string[];
  version: string;
}

export function createPresenceMessage(
  roomId: string,
  peerId: string,
  status: PresenceStatus,
  agentInfo: AgentInfo,
): NexusMessage {
  return createMessage(
    'presence',
    roomTopic(roomId),
    peerId,
    {
      status,
      capabilities: agentInfo.capabilities,
      agentName: agentInfo.name,
      agentType: agentInfo.type,
      version: agentInfo.version,
    },
  );
}

export interface MetaDetails {
  roomId?: string;
  roomManifest?: string;
  [key: string]: unknown;
}

export function createMetaMessage(
  peerId: string,
  action: string,
  details: MetaDetails = {},
): NexusMessage {
  return createMessage(
    'meta',
    TOPICS.META,
    peerId,
    {
      action,
      ...details,
    },
  );
}
