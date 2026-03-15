import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SignalingServer } from '../signaling/server.js';
import type { BootstrapResponse, NetworkResponse, RoomInfo } from '../protocol/types.js';

// Use a random high port to avoid collisions
let port = 49200 + Math.floor(Math.random() * 100);

function nextPort() {
  return ++port;
}

async function getJSON(url: string): Promise<{ status: number; body: unknown; contentType: string | null }> {
  const res = await fetch(url);
  const body = await res.json();
  return { status: res.status, body, contentType: res.headers.get('content-type') };
}

async function getText(url: string): Promise<{ status: number; body: string; contentType: string | null }> {
  const res = await fetch(url);
  const body = await res.text();
  return { status: res.status, body, contentType: res.headers.get('content-type') };
}

describe('SignalingServer', () => {
  let server: SignalingServer;
  let baseUrl: string;

  beforeEach(async () => {
    const p = nextPort();
    server = new SignalingServer({ port: p, host: '127.0.0.1' });
    await server.start();
    baseUrl = `http://127.0.0.1:${p}`;
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('start / stop', () => {
    it('starts without throwing', async () => {
      // server already started in beforeEach — just confirm it is reachable
      const res = await fetch(`${baseUrl}/`);
      expect(res.ok).toBe(true);
    });

    it('stops cleanly without throwing', async () => {
      await server.stop(); // second stop is handled in afterEach but should not throw
    });
  });

  describe('CORS headers', () => {
    it('sets Access-Control-Allow-Origin: * on GET responses', async () => {
      const res = await fetch(`${baseUrl}/api/v1/bootstrap`);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('responds 204 to OPTIONS preflight', async () => {
      const res = await fetch(`${baseUrl}/api/v1/bootstrap`, { method: 'OPTIONS' });
      expect(res.status).toBe(204);
    });

    it('sets CORS headers on OPTIONS response', async () => {
      const res = await fetch(`${baseUrl}/api/v1/bootstrap`, { method: 'OPTIONS' });
      expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    });
  });

  describe('GET /', () => {
    it('returns 200', async () => {
      const { status } = await getText(`${baseUrl}/`);
      expect(status).toBe(200);
    });

    it('returns text/plain content type', async () => {
      const { contentType } = await getText(`${baseUrl}/`);
      expect(contentType).toContain('text/plain');
    });

    it('mentions OpenAgents Nexus in body', async () => {
      const { body } = await getText(`${baseUrl}/`);
      expect(body).toContain('OpenAgents Nexus');
    });

    it('lists the API endpoints in the landing page', async () => {
      const { body } = await getText(`${baseUrl}/`);
      expect(body).toContain('/api/v1/bootstrap');
      expect(body).toContain('/api/v1/network');
      expect(body).toContain('/api/v1/rooms');
    });
  });

  describe('GET /api/v1/bootstrap', () => {
    it('returns 200', async () => {
      const { status } = await getJSON(`${baseUrl}/api/v1/bootstrap`);
      expect(status).toBe(200);
    });

    it('returns application/json content type', async () => {
      const { contentType } = await getJSON(`${baseUrl}/api/v1/bootstrap`);
      expect(contentType).toContain('application/json');
    });

    it('returns empty peers array by default', async () => {
      const { body } = await getJSON(`${baseUrl}/api/v1/bootstrap`);
      const resp = body as BootstrapResponse;
      expect(resp.peers).toEqual([]);
    });

    it('returns network object with protocolVersion 1', async () => {
      const { body } = await getJSON(`${baseUrl}/api/v1/bootstrap`);
      const resp = body as BootstrapResponse;
      expect(resp.network.protocolVersion).toBe(1);
    });

    it('returns peers after updateState is called', async () => {
      server.updateState({
        bootstrapPeers: [
          '/ip4/1.2.3.4/tcp/4001/p2p/QmFoo',
          '/ip4/5.6.7.8/tcp/4001/p2p/QmBar',
        ],
      });
      const { body } = await getJSON(`${baseUrl}/api/v1/bootstrap`);
      const resp = body as BootstrapResponse;
      expect(resp.peers).toHaveLength(2);
      expect(resp.peers[0]).toBe('/ip4/1.2.3.4/tcp/4001/p2p/QmFoo');
    });

    it('caps peers at 20', async () => {
      const peers = Array.from({ length: 30 }, (_, i) => `/ip4/1.2.3.${i}/tcp/4001/p2p/QmPeer${i}`);
      server.updateState({ bootstrapPeers: peers });
      const { body } = await getJSON(`${baseUrl}/api/v1/bootstrap`);
      const resp = body as BootstrapResponse;
      expect(resp.peers).toHaveLength(20);
    });

    it('reflects updated peerCount in network object', async () => {
      server.updateState({ peerCount: 42 });
      const { body } = await getJSON(`${baseUrl}/api/v1/bootstrap`);
      const resp = body as BootstrapResponse;
      expect(resp.network.peerCount).toBe(42);
    });

    it('reflects room count from known rooms', async () => {
      const rooms: RoomInfo[] = [
        { roomId: 'r1', name: 'Room 1', topic: '/nexus/room/r1', memberCount: 3, type: 'persistent', access: 'public', manifest: 'QmManifest1' },
      ];
      server.updateState({ knownRooms: rooms });
      const { body } = await getJSON(`${baseUrl}/api/v1/bootstrap`);
      const resp = body as BootstrapResponse;
      expect(resp.network.roomCount).toBe(1);
    });

    it('includes minClientVersion', async () => {
      const { body } = await getJSON(`${baseUrl}/api/v1/bootstrap`);
      const resp = body as BootstrapResponse;
      expect(resp.network.minClientVersion).toBe('0.1.0');
    });
  });

  describe('GET /api/v1/network', () => {
    it('returns 200', async () => {
      const { status } = await getJSON(`${baseUrl}/api/v1/network`);
      expect(status).toBe(200);
    });

    it('returns peerCount of 0 by default', async () => {
      const { body } = await getJSON(`${baseUrl}/api/v1/network`);
      const resp = body as NetworkResponse;
      expect(resp.peerCount).toBe(0);
    });

    it('returns roomCount of 0 by default', async () => {
      const { body } = await getJSON(`${baseUrl}/api/v1/network`);
      const resp = body as NetworkResponse;
      expect(resp.roomCount).toBe(0);
    });

    it('returns protocolVersion 1', async () => {
      const { body } = await getJSON(`${baseUrl}/api/v1/network`);
      const resp = body as NetworkResponse;
      expect(resp.protocolVersion).toBe(1);
    });

    it('returns non-negative uptime', async () => {
      const { body } = await getJSON(`${baseUrl}/api/v1/network`);
      const resp = body as NetworkResponse;
      expect(resp.uptime).toBeGreaterThanOrEqual(0);
    });

    it('returns rooms array', async () => {
      const { body } = await getJSON(`${baseUrl}/api/v1/network`);
      const resp = body as NetworkResponse;
      expect(Array.isArray(resp.rooms)).toBe(true);
    });

    it('reflects updated state', async () => {
      const rooms: RoomInfo[] = [
        { roomId: 'r1', name: 'Room 1', topic: '/nexus/room/r1', memberCount: 5, type: 'persistent', access: 'public', manifest: 'QmM1' },
        { roomId: 'r2', name: 'Room 2', topic: '/nexus/room/r2', memberCount: 2, type: 'ephemeral', access: 'public', manifest: 'QmM2' },
      ];
      server.updateState({ peerCount: 7, knownRooms: rooms });
      const { body } = await getJSON(`${baseUrl}/api/v1/network`);
      const resp = body as NetworkResponse;
      expect(resp.peerCount).toBe(7);
      expect(resp.roomCount).toBe(2);
      expect(resp.rooms).toHaveLength(2);
    });
  });

  describe('GET /api/v1/rooms', () => {
    it('returns 200', async () => {
      const { status } = await getJSON(`${baseUrl}/api/v1/rooms`);
      expect(status).toBe(200);
    });

    it('returns empty rooms array by default', async () => {
      const { body } = await getJSON(`${baseUrl}/api/v1/rooms`);
      const resp = body as { rooms: RoomInfo[] };
      expect(resp.rooms).toEqual([]);
    });

    it('returns rooms after updateState', async () => {
      const rooms: RoomInfo[] = [
        { roomId: 'general', name: 'General', topic: '/nexus/room/general', memberCount: 10, type: 'persistent', access: 'public', manifest: 'QmGM' },
      ];
      server.updateState({ knownRooms: rooms });
      const { body } = await getJSON(`${baseUrl}/api/v1/rooms`);
      const resp = body as { rooms: RoomInfo[] };
      expect(resp.rooms).toHaveLength(1);
      expect(resp.rooms[0].roomId).toBe('general');
    });
  });

  describe('unknown routes', () => {
    it('returns 404 for unknown paths', async () => {
      const res = await fetch(`${baseUrl}/not-a-real-path`);
      expect(res.status).toBe(404);
    });

    it('returns JSON error body for 404', async () => {
      const res = await fetch(`${baseUrl}/unknown`);
      const body = await res.json() as { error: string };
      expect(body.error).toBeDefined();
    });
  });

  describe('updateState', () => {
    it('only updates fields that are provided', async () => {
      server.updateState({ peerCount: 5 });
      server.updateState({ knownRooms: [] }); // does not touch peerCount
      const { body } = await getJSON(`${baseUrl}/api/v1/network`);
      const resp = body as NetworkResponse;
      expect(resp.peerCount).toBe(5);
    });
  });
});
