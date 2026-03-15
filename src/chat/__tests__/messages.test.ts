import { describe, it, expect } from 'vitest';
import {
  createChatMessage,
  createPresenceMessage,
  createMetaMessage,
} from '../messages.js';
import { TOPICS, PROTOCOL_VERSION } from '../../protocol/index.js';
import type { ChatPayload, PresencePayload, MetaPayload } from '../../protocol/index.js';

const AGENT_INFO = {
  name: 'TestAgent',
  type: 'autonomous',
  capabilities: ['chat', 'storage'],
  version: '0.1.0',
};

describe('createChatMessage', () => {
  it('returns a NexusMessage with type "chat"', () => {
    const msg = createChatMessage('room-1', 'peer-abc', 'Hello world');
    expect(msg.type).toBe('chat');
  });

  it('sets version to PROTOCOL_VERSION', () => {
    const msg = createChatMessage('room-1', 'peer-abc', 'Hello');
    expect(msg.version).toBe(PROTOCOL_VERSION);
  });

  it('sets topic to /nexus/room/<roomId>', () => {
    const msg = createChatMessage('my-room', 'peer-abc', 'Hello');
    expect(msg.topic).toBe('/nexus/room/my-room');
  });

  it('sets sender to the provided peerId', () => {
    const msg = createChatMessage('room-1', 'peer-xyz', 'Hello');
    expect(msg.sender).toBe('peer-xyz');
  });

  it('sets payload.content to the provided content string', () => {
    const msg = createChatMessage('room-1', 'peer-abc', 'Hello world');
    const payload = msg.payload as ChatPayload;
    expect(payload.content).toBe('Hello world');
  });

  it('defaults format to text/plain when no options provided', () => {
    const msg = createChatMessage('room-1', 'peer-abc', 'Hello');
    const payload = msg.payload as ChatPayload;
    expect(payload.format).toBe('text/plain');
  });

  it('uses provided format option', () => {
    const msg = createChatMessage('room-1', 'peer-abc', 'Hello', { format: 'text/markdown' });
    const payload = msg.payload as ChatPayload;
    expect(payload.format).toBe('text/markdown');
  });

  it('defaults replyTo to null', () => {
    const msg = createChatMessage('room-1', 'peer-abc', 'Hello');
    const payload = msg.payload as ChatPayload;
    expect(payload.replyTo).toBeNull();
  });

  it('uses provided replyTo option', () => {
    const msg = createChatMessage('room-1', 'peer-abc', 'Reply', { replyTo: 'msg-id-123' });
    const payload = msg.payload as ChatPayload;
    expect(payload.replyTo).toBe('msg-id-123');
  });

  it('defaults threadId to null', () => {
    const msg = createChatMessage('room-1', 'peer-abc', 'Hello');
    const payload = msg.payload as ChatPayload;
    expect(payload.threadId).toBeNull();
  });

  it('uses provided threadId option', () => {
    const msg = createChatMessage('room-1', 'peer-abc', 'Thread reply', { threadId: 'thread-42' });
    const payload = msg.payload as ChatPayload;
    expect(payload.threadId).toBe('thread-42');
  });

  it('assigns a valid UUIDv7 id', () => {
    const msg = createChatMessage('room-1', 'peer-abc', 'Hello');
    expect(msg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('sets timestamp to approximately now', () => {
    const before = Date.now();
    const msg = createChatMessage('room-1', 'peer-abc', 'Hello');
    const after = Date.now();
    expect(msg.timestamp).toBeGreaterThanOrEqual(before);
    expect(msg.timestamp).toBeLessThanOrEqual(after);
  });

  it('initialises references as empty array', () => {
    const msg = createChatMessage('room-1', 'peer-abc', 'Hello');
    expect(msg.references).toEqual([]);
  });

  it('generates unique ids for successive calls', () => {
    const ids = new Set([
      createChatMessage('room-1', 'peer', 'a').id,
      createChatMessage('room-1', 'peer', 'b').id,
      createChatMessage('room-1', 'peer', 'c').id,
    ]);
    expect(ids.size).toBe(3);
  });
});

describe('createPresenceMessage', () => {
  it('returns a NexusMessage with type "presence"', () => {
    const msg = createPresenceMessage('room-1', 'peer-abc', 'online', AGENT_INFO);
    expect(msg.type).toBe('presence');
  });

  it('sets topic to /nexus/room/<roomId>', () => {
    const msg = createPresenceMessage('my-room', 'peer-abc', 'online', AGENT_INFO);
    expect(msg.topic).toBe('/nexus/room/my-room');
  });

  it('sets sender to the provided peerId', () => {
    const msg = createPresenceMessage('room-1', 'peer-xyz', 'online', AGENT_INFO);
    expect(msg.sender).toBe('peer-xyz');
  });

  it('sets payload.status to the provided status', () => {
    const msg = createPresenceMessage('room-1', 'peer-abc', 'busy', AGENT_INFO);
    const payload = msg.payload as PresencePayload;
    expect(payload.status).toBe('busy');
  });

  it('sets payload.capabilities from agentInfo', () => {
    const msg = createPresenceMessage('room-1', 'peer-abc', 'online', AGENT_INFO);
    const payload = msg.payload as PresencePayload;
    expect(payload.capabilities).toEqual(['chat', 'storage']);
  });

  it('sets payload.agentName from agentInfo', () => {
    const msg = createPresenceMessage('room-1', 'peer-abc', 'online', AGENT_INFO);
    const payload = msg.payload as PresencePayload;
    expect(payload.agentName).toBe('TestAgent');
  });

  it('sets payload.agentType from agentInfo', () => {
    const msg = createPresenceMessage('room-1', 'peer-abc', 'online', AGENT_INFO);
    const payload = msg.payload as PresencePayload;
    expect(payload.agentType).toBe('autonomous');
  });

  it('sets payload.version from agentInfo', () => {
    const msg = createPresenceMessage('room-1', 'peer-abc', 'online', AGENT_INFO);
    const payload = msg.payload as PresencePayload;
    expect(payload.version).toBe('0.1.0');
  });

  it('handles offline status', () => {
    const msg = createPresenceMessage('room-1', 'peer-abc', 'offline', AGENT_INFO);
    const payload = msg.payload as PresencePayload;
    expect(payload.status).toBe('offline');
  });

  it('assigns a valid UUIDv7 id', () => {
    const msg = createPresenceMessage('room-1', 'peer-abc', 'online', AGENT_INFO);
    expect(msg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('createMetaMessage', () => {
  it('returns a NexusMessage with type "meta"', () => {
    const msg = createMetaMessage('peer-abc', 'room:created');
    expect(msg.type).toBe('meta');
  });

  it('sets topic to TOPICS.META', () => {
    const msg = createMetaMessage('peer-abc', 'room:created');
    expect(msg.topic).toBe(TOPICS.META);
  });

  it('sets sender to the provided peerId', () => {
    const msg = createMetaMessage('peer-xyz', 'room:updated');
    expect(msg.sender).toBe('peer-xyz');
  });

  it('sets payload.action to the provided action', () => {
    const msg = createMetaMessage('peer-abc', 'room:created');
    const payload = msg.payload as MetaPayload;
    expect(payload.action).toBe('room:created');
  });

  it('merges provided details into the payload', () => {
    const msg = createMetaMessage('peer-abc', 'room:created', { roomId: 'room-99', extra: true });
    const payload = msg.payload as MetaPayload;
    expect(payload.roomId).toBe('room-99');
    expect((payload as any).extra).toBe(true);
  });

  it('works with empty details (default)', () => {
    const msg = createMetaMessage('peer-abc', 'ping');
    const payload = msg.payload as MetaPayload;
    expect(payload.action).toBe('ping');
  });

  it('assigns a valid UUIDv7 id', () => {
    const msg = createMetaMessage('peer-abc', 'ping');
    expect(msg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
