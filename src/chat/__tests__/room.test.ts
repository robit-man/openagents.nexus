import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NexusRoom } from '../room.js';
import { encodeMessage, createMessage } from '../../protocol/index.js';
import type { NexusMessage, ChatPayload, PresencePayload } from '../../protocol/index.js';

// ---- Mock pubsub factory ----
function makeMockPubsub() {
  const listeners = new Map<string, Set<(evt: any) => void>>();
  const published: Array<{ topic: string; data: Uint8Array }> = [];
  const subscriptions = new Set<string>();

  return {
    // pubsub API
    subscribe(topic: string) {
      subscriptions.add(topic);
    },
    unsubscribe(topic: string) {
      subscriptions.delete(topic);
    },
    async publish(topic: string, data: Uint8Array) {
      published.push({ topic, data });
    },
    addEventListener(event: string, handler: (evt: any) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    removeEventListener(event: string, handler: (evt: any) => void) {
      listeners.get(event)?.delete(handler);
    },
    // Test helpers
    emit(event: string, payload: any) {
      listeners.get(event)?.forEach(fn => fn(payload));
    },
    get published() {
      return published;
    },
    get subscriptions() {
      return subscriptions;
    },
    clearPublished() {
      published.length = 0;
    },
  };
}

const PEER_ID = 'QmTestPeer1234';
const AGENT_INFO = {
  name: 'TestAgent',
  type: 'autonomous',
  capabilities: ['chat'],
  version: '0.1.0',
};

describe('NexusRoom', () => {
  let pubsub: ReturnType<typeof makeMockPubsub>;
  let room: NexusRoom;

  beforeEach(() => {
    pubsub = makeMockPubsub();
    room = new NexusRoom('test-room', PEER_ID, pubsub, AGENT_INFO);
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Leave silently after each test (may already be left)
    try {
      await room.leave();
    } catch {
      // ignore
    }
  });

  describe('constructor', () => {
    it('exposes roomId property', () => {
      expect(room.roomId).toBe('test-room');
    });

    it('exposes topic as /nexus/room/<roomId>', () => {
      expect(room.topic).toBe('/nexus/room/test-room');
    });
  });

  describe('join()', () => {
    it('subscribes to the room topic', async () => {
      await room.join();
      expect(pubsub.subscriptions.has('/nexus/room/test-room')).toBe(true);
    });

    it('publishes an online presence message on join', async () => {
      await room.join();
      expect(pubsub.published.length).toBeGreaterThan(0);
      const presenceMsg = JSON.parse(
        new TextDecoder().decode(pubsub.published[0].data),
      ) as NexusMessage;
      expect(presenceMsg.type).toBe('presence');
      expect((presenceMsg.payload as PresencePayload).status).toBe('online');
    });

    it('publishes presence on the correct topic', async () => {
      await room.join();
      expect(pubsub.published[0].topic).toBe('/nexus/room/test-room');
    });

    it('registers a message event listener on pubsub', async () => {
      // After join, dispatching a message event should reach the handler
      await room.join();
      let received = false;
      room.on('message', () => { received = true; });

      const chatMsg = createMessage('chat', '/nexus/room/test-room', 'other-peer', {
        content: 'hi',
        format: 'text/plain',
        replyTo: null,
        threadId: null,
      });
      pubsub.emit('message', { detail: { topic: '/nexus/room/test-room', data: encodeMessage(chatMsg) } });
      expect(received).toBe(true);
    });
  });

  describe('send()', () => {
    beforeEach(async () => {
      await room.join();
      pubsub.clearPublished(); // clear the join presence
    });

    it('returns the message id string', async () => {
      const id = await room.send('Hello!');
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('publishes to the correct GossipSub topic', async () => {
      await room.send('Hello!');
      expect(pubsub.published[0].topic).toBe('/nexus/room/test-room');
    });

    it('publishes a valid chat NexusMessage', async () => {
      await room.send('Hello!');
      const decoded = JSON.parse(
        new TextDecoder().decode(pubsub.published[0].data),
      ) as NexusMessage;
      expect(decoded.type).toBe('chat');
      expect((decoded.payload as ChatPayload).content).toBe('Hello!');
    });

    it('sets sender to peerId', async () => {
      await room.send('Hi');
      const decoded = JSON.parse(
        new TextDecoder().decode(pubsub.published[0].data),
      ) as NexusMessage;
      expect(decoded.sender).toBe(PEER_ID);
    });

    it('uses default format text/plain', async () => {
      await room.send('Hi');
      const decoded = JSON.parse(new TextDecoder().decode(pubsub.published[0].data)) as NexusMessage;
      expect((decoded.payload as ChatPayload).format).toBe('text/plain');
    });

    it('uses provided format option', async () => {
      await room.send('**bold**', { format: 'text/markdown' });
      const decoded = JSON.parse(new TextDecoder().decode(pubsub.published[0].data)) as NexusMessage;
      expect((decoded.payload as ChatPayload).format).toBe('text/markdown');
    });

    it('sets replyTo when provided', async () => {
      await room.send('Reply', { replyTo: 'orig-msg-id' });
      const decoded = JSON.parse(new TextDecoder().decode(pubsub.published[0].data)) as NexusMessage;
      expect((decoded.payload as ChatPayload).replyTo).toBe('orig-msg-id');
    });

    it('sets threadId when provided', async () => {
      await room.send('Thread', { threadId: 'thread-1' });
      const decoded = JSON.parse(new TextDecoder().decode(pubsub.published[0].data)) as NexusMessage;
      expect((decoded.payload as ChatPayload).threadId).toBe('thread-1');
    });
  });

  describe('message routing', () => {
    beforeEach(async () => {
      await room.join();
    });

    it('emits "message" event for chat messages on the correct topic', async () => {
      const received: NexusMessage[] = [];
      room.on('message', msg => received.push(msg));

      const chatMsg = createMessage('chat', '/nexus/room/test-room', 'peer-other', {
        content: 'hey',
        format: 'text/plain',
        replyTo: null,
        threadId: null,
      });
      pubsub.emit('message', { detail: { topic: '/nexus/room/test-room', data: encodeMessage(chatMsg) } });

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('chat');
    });

    it('emits "presence" event for presence messages', async () => {
      const presences: NexusMessage[] = [];
      room.on('presence', msg => presences.push(msg));

      const presMsg = createMessage('presence', '/nexus/room/test-room', 'peer-other', {
        status: 'online',
        capabilities: [],
        agentName: 'Other',
        agentType: 'autonomous',
        version: '0.1.0',
      });
      pubsub.emit('message', { detail: { topic: '/nexus/room/test-room', data: encodeMessage(presMsg) } });

      expect(presences).toHaveLength(1);
      expect(presences[0].type).toBe('presence');
    });

    it('ignores messages from a different topic', async () => {
      const received: NexusMessage[] = [];
      room.on('message', msg => received.push(msg));

      const chatMsg = createMessage('chat', '/nexus/room/other-room', 'peer-other', {
        content: 'not for us',
        format: 'text/plain',
        replyTo: null,
        threadId: null,
      });
      // Dispatch on a different topic
      pubsub.emit('message', { detail: { topic: '/nexus/room/other-room', data: encodeMessage(chatMsg) } });

      expect(received).toHaveLength(0);
    });

    it('silently ignores malformed message data', async () => {
      const received: NexusMessage[] = [];
      room.on('message', msg => received.push(msg));

      pubsub.emit('message', { detail: { topic: '/nexus/room/test-room', data: new Uint8Array([1, 2, 3]) } });

      expect(received).toHaveLength(0);
    });
  });

  describe('presence heartbeat', () => {
    it('sends periodic presence every 60 seconds', async () => {
      await room.join();
      pubsub.clearPublished();

      vi.advanceTimersByTime(60_000);
      // Wait for the async presence send to settle
      await Promise.resolve();
      await Promise.resolve();

      expect(pubsub.published.length).toBeGreaterThanOrEqual(1);
      const decoded = JSON.parse(new TextDecoder().decode(pubsub.published[0].data)) as NexusMessage;
      expect(decoded.type).toBe('presence');
    });

    it('sends two heartbeats after 120 seconds', async () => {
      await room.join();
      pubsub.clearPublished();

      vi.advanceTimersByTime(120_000);
      await Promise.resolve();
      await Promise.resolve();

      expect(pubsub.published.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('leave()', () => {
    it('unsubscribes from the room topic', async () => {
      await room.join();
      await room.leave();
      expect(pubsub.subscriptions.has('/nexus/room/test-room')).toBe(false);
    });

    it('publishes an offline presence message on leave', async () => {
      await room.join();
      pubsub.clearPublished();
      await room.leave();

      const offlineMsg = pubsub.published.find(p => {
        try {
          const decoded = JSON.parse(new TextDecoder().decode(p.data)) as NexusMessage;
          return decoded.type === 'presence' && (decoded.payload as PresencePayload).status === 'offline';
        } catch {
          return false;
        }
      });
      expect(offlineMsg).toBeDefined();
    });

    it('stops the presence heartbeat interval after leave', async () => {
      await room.join();
      await room.leave();
      pubsub.clearPublished();

      vi.advanceTimersByTime(120_000);
      await Promise.resolve();
      await Promise.resolve();

      // No new presence messages should have been published
      const presenceMsgs = pubsub.published.filter(p => {
        try {
          const decoded = JSON.parse(new TextDecoder().decode(p.data)) as NexusMessage;
          return decoded.type === 'presence';
        } catch {
          return false;
        }
      });
      expect(presenceMsgs).toHaveLength(0);
    });

    it('removes the pubsub message event listener on leave', async () => {
      await room.join();
      await room.leave();

      const received: NexusMessage[] = [];
      room.on('message', msg => received.push(msg));

      const chatMsg = createMessage('chat', '/nexus/room/test-room', 'peer-other', {
        content: 'should not arrive',
        format: 'text/plain',
        replyTo: null,
        threadId: null,
      });
      pubsub.emit('message', { detail: { topic: '/nexus/room/test-room', data: encodeMessage(chatMsg) } });

      expect(received).toHaveLength(0);
    });
  });
});
