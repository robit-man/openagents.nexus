/**
 * Room member tracking tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NexusRoom } from '../room.js';
import type { RoomMember } from '../room.js';
import { createPresenceMessage } from '../messages.js';
import { encodeMessage, decodeMessage } from '../../protocol/index.js';

// Mock pubsub that stores handlers and can simulate messages
function createMockPubsub() {
  const handlers: Array<(evt: any) => void> = [];
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    publish: vi.fn(),
    addEventListener: vi.fn((_: string, handler: any) => handlers.push(handler)),
    removeEventListener: vi.fn((_: string, handler: any) => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }),
    // Test helper: simulate receiving a message
    simulateMessage(topic: string, msg: any) {
      const data = encodeMessage(msg);
      handlers.forEach(h => h({ detail: { topic, data } }));
    },
  };
}

describe('NexusRoom — member tracking', () => {
  let room: NexusRoom;
  let pubsub: ReturnType<typeof createMockPubsub>;
  const roomId = 'test-room';
  const myPeerId = 'my-peer-id';
  const agentInfo = { name: 'test', type: 'agent', capabilities: [], version: '1.0' };

  beforeEach(async () => {
    pubsub = createMockPubsub();
    room = new NexusRoom(roomId, myPeerId, pubsub, agentInfo);
    await room.join();
  });

  afterEach(async () => {
    await room.leave();
  });

  it('members starts empty', () => {
    expect(room.members).toEqual([]);
  });

  it('tracks a member from a presence event', () => {
    const presenceMsg = createPresenceMessage(roomId, 'peer-a', 'online', {
      name: 'Agent A',
      type: 'helper',
      capabilities: ['translate'],
      version: '1.0',
    });

    pubsub.simulateMessage(`/nexus/room/${roomId}`, presenceMsg);

    expect(room.members).toHaveLength(1);
    expect(room.members[0].peerId).toBe('peer-a');
    expect(room.members[0].agentName).toBe('Agent A');
    expect(room.members[0].status).toBe('online');
    expect(room.members[0].capabilities).toEqual(['translate']);
  });

  it('emits member:join on first presence', () => {
    const joinListener = vi.fn();
    room.on('member:join', joinListener);

    const presenceMsg = createPresenceMessage(roomId, 'peer-b', 'online', {
      name: 'Agent B', type: 'bot', capabilities: [], version: '1.0',
    });

    pubsub.simulateMessage(`/nexus/room/${roomId}`, presenceMsg);

    expect(joinListener).toHaveBeenCalledOnce();
    expect(joinListener.mock.calls[0][0].peerId).toBe('peer-b');
  });

  it('does not emit member:join on subsequent presence updates', () => {
    const joinListener = vi.fn();
    room.on('member:join', joinListener);

    const msg1 = createPresenceMessage(roomId, 'peer-c', 'online', {
      name: 'Agent C', type: 'bot', capabilities: [], version: '1.0',
    });
    const msg2 = createPresenceMessage(roomId, 'peer-c', 'busy', {
      name: 'Agent C', type: 'bot', capabilities: [], version: '1.0',
    });

    pubsub.simulateMessage(`/nexus/room/${roomId}`, msg1);
    pubsub.simulateMessage(`/nexus/room/${roomId}`, msg2);

    expect(joinListener).toHaveBeenCalledOnce();
    // Status should be updated
    expect(room.members[0].status).toBe('busy');
  });

  it('removes member on offline presence and emits member:leave', () => {
    const leaveListener = vi.fn();
    room.on('member:leave', leaveListener);

    // Join first
    const joinMsg = createPresenceMessage(roomId, 'peer-d', 'online', {
      name: 'Agent D', type: 'bot', capabilities: [], version: '1.0',
    });
    pubsub.simulateMessage(`/nexus/room/${roomId}`, joinMsg);
    expect(room.members).toHaveLength(1);

    // Leave
    const leaveMsg = createPresenceMessage(roomId, 'peer-d', 'offline', {
      name: 'Agent D', type: 'bot', capabilities: [], version: '1.0',
    });
    pubsub.simulateMessage(`/nexus/room/${roomId}`, leaveMsg);

    expect(room.members).toHaveLength(0);
    expect(leaveListener).toHaveBeenCalledOnce();
    expect(leaveListener.mock.calls[0][0].peerId).toBe('peer-d');
  });

  it('getMember returns a specific member', () => {
    const msg = createPresenceMessage(roomId, 'peer-e', 'online', {
      name: 'Agent E', type: 'bot', capabilities: [], version: '1.0',
    });
    pubsub.simulateMessage(`/nexus/room/${roomId}`, msg);

    const member = room.getMember('peer-e');
    expect(member).toBeTruthy();
    expect(member!.agentName).toBe('Agent E');
  });

  it('getMember returns undefined for unknown peer', () => {
    expect(room.getMember('unknown')).toBeUndefined();
  });

  it('findMemberByName finds a member', () => {
    const msg = createPresenceMessage(roomId, 'peer-f', 'online', {
      name: 'Alpha', type: 'bot', capabilities: [], version: '1.0',
    });
    pubsub.simulateMessage(`/nexus/room/${roomId}`, msg);

    const found = room.findMemberByName('Alpha');
    expect(found).toBeTruthy();
    expect(found!.peerId).toBe('peer-f');
  });

  it('findMemberByName returns undefined when not found', () => {
    expect(room.findMemberByName('Nonexistent')).toBeUndefined();
  });
});
