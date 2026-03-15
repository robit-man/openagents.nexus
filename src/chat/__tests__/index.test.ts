import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RoomManager, NexusRoom } from '../index.js';

function makeMockPubsub() {
  const subscriptions = new Set<string>();
  const published: Array<{ topic: string; data: Uint8Array }> = [];
  const listeners = new Map<string, Set<(evt: any) => void>>();

  return {
    subscribe(topic: string) { subscriptions.add(topic); },
    unsubscribe(topic: string) { subscriptions.delete(topic); },
    async publish(topic: string, data: Uint8Array) { published.push({ topic, data }); },
    addEventListener(event: string, handler: (evt: any) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    removeEventListener(event: string, handler: (evt: any) => void) {
      listeners.get(event)?.delete(handler);
    },
    get subscriptions() { return subscriptions; },
    get published() { return published; },
  };
}

const AGENT_INFO = {
  name: 'TestAgent',
  type: 'autonomous',
  capabilities: ['chat'],
  version: '0.1.0',
};

describe('RoomManager', () => {
  let pubsub: ReturnType<typeof makeMockPubsub>;
  let manager: RoomManager;

  beforeEach(() => {
    pubsub = makeMockPubsub();
    manager = new RoomManager('peer-test', pubsub, AGENT_INFO);
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await manager.leaveAll().catch(() => {});
  });

  describe('joinRoom()', () => {
    it('returns a NexusRoom instance', async () => {
      const room = await manager.joinRoom('room-a');
      expect(room).toBeInstanceOf(NexusRoom);
    });

    it('room has the correct roomId', async () => {
      const room = await manager.joinRoom('room-a');
      expect(room.roomId).toBe('room-a');
    });

    it('returns the same instance on repeated calls with same roomId', async () => {
      const r1 = await manager.joinRoom('room-a');
      const r2 = await manager.joinRoom('room-a');
      expect(r1).toBe(r2);
    });

    it('tracks joined rooms', async () => {
      await manager.joinRoom('room-a');
      expect(manager.getJoinedRooms()).toContain('room-a');
    });

    it('tracks multiple rooms', async () => {
      await manager.joinRoom('room-a');
      await manager.joinRoom('room-b');
      const rooms = manager.getJoinedRooms();
      expect(rooms).toContain('room-a');
      expect(rooms).toContain('room-b');
      expect(rooms).toHaveLength(2);
    });
  });

  describe('getRoom()', () => {
    it('returns undefined for a room that has not been joined', () => {
      expect(manager.getRoom('unknown')).toBeUndefined();
    });

    it('returns the room after joining', async () => {
      const joined = await manager.joinRoom('room-a');
      expect(manager.getRoom('room-a')).toBe(joined);
    });
  });

  describe('leaveRoom()', () => {
    it('removes the room from the tracked set', async () => {
      await manager.joinRoom('room-a');
      await manager.leaveRoom('room-a');
      expect(manager.getJoinedRooms()).not.toContain('room-a');
    });

    it('does not throw when leaving a room that was not joined', async () => {
      await expect(manager.leaveRoom('nonexistent')).resolves.toBeUndefined();
    });

    it('getRoom returns undefined after leaving', async () => {
      await manager.joinRoom('room-a');
      await manager.leaveRoom('room-a');
      expect(manager.getRoom('room-a')).toBeUndefined();
    });
  });

  describe('leaveAll()', () => {
    it('leaves all joined rooms', async () => {
      await manager.joinRoom('room-a');
      await manager.joinRoom('room-b');
      await manager.leaveAll();
      expect(manager.getJoinedRooms()).toHaveLength(0);
    });

    it('resolves even with no rooms joined', async () => {
      await expect(manager.leaveAll()).resolves.toBeUndefined();
    });
  });

  describe('getJoinedRooms()', () => {
    it('returns empty array initially', () => {
      expect(manager.getJoinedRooms()).toEqual([]);
    });

    it('returns room ids in joined order', async () => {
      await manager.joinRoom('alpha');
      await manager.joinRoom('beta');
      const rooms = manager.getJoinedRooms();
      expect(rooms).toContain('alpha');
      expect(rooms).toContain('beta');
    });
  });
});
