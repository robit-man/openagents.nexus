/**
 * Cloudflare Worker — openagents.nexus API
 *
 * KV is used ONLY for low-frequency persistent directory snapshots:
 * - Known agent addresses (written max once/minute, read on every bootstrap)
 * - Network state snapshot (peer count, rooms — updated infrequently)
 *
 * KV is NOT used for:
 * - Heartbeats, presence, live state, message content, session state
 *
 * Live discovery happens via NATS pubsub (browser + agents connect directly).
 * In-memory metrics track aggregate counters between KV snapshots.
 */

import { INDEX_HTML } from './html.js';

interface Env {
  AGENTS: KVNamespace;
}

const PUBLIC_BOOTSTRAP = [
  '/dns4/am6.bootstrap.libp2p.io/tcp/443/wss/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dns4/sg1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
  '/dns4/sv15.bootstrap.libp2p.io/tcp/443/wss/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dns4/ams-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLer265NRgSp2LA3dPaeykiS1J6DifTC88f5uVQKNAd',
  '/dns4/sfo-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLju6m7xTh3DuokvT3886QRYqxAzb1kShaanJgW36yx',
  '/dns4/lon-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLMeWqB7YGVLJN3pNLQpmmEk35v6wYtsMGLzSr5QBU3',
  '/dns4/sfo-2.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLnSGccFuZQJzRadHn95W2CrSFmZuTdDWP8HXaHca9z',
  '/dns4/sfo-3.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLPppuBtQSGwKDZT2M73ULpjvfd3aZ6ha4oFGL1KrGM',
  '/dns4/sgp-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLSafTMBsPKadTEgaXctDQVcqN88CNLHXMkTNwMKPnu',
  '/dns4/nyc-1.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLueR4xBeUbY9WZ9xGUUxunbKWcrNFTDAadQJmocnWm',
  '/dns4/nyc-2.bootstrap.libp2p.io/tcp/443/wss/p2p/QmSoLV4Bbm51jM9C4gDYZQ9Cy3U6aXMJDAbzgu2fzaDs64',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
  '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
];

const DISCOVERY_TOPICS = [
  '_nexus._peer-discovery._p2p._pubsub',
  'nexus:agents:discovery:v1',
  '_open-agents._nexus._discovery',
];

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS },
  });
}

// In-memory metrics — fast path, no KV writes
let metrics = {
  totalPeers: 0,
  totalRooms: 0,
  messageRate: 0,
  lastReport: 0,
  reportCount: 0,
};

// Rate limit: max 1 KV write per 60 seconds for directory snapshots
let lastDirectoryWrite = 0;
const DIRECTORY_WRITE_INTERVAL = 60_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    switch (url.pathname) {

      // ── Bootstrap: hardcoded peers + any known agent addresses from KV ──
      case '/api/v1/bootstrap': {
        let knownAgents: string[] = [];
        try {
          const stored = await env.AGENTS.get('known-agents', 'json') as any;
          if (stored?.addresses) knownAgents = stored.addresses;
        } catch { /* KV miss is fine */ }

        // Merge: hardcoded public bootstrap + persisted known agents
        const allPeers = [...new Set([...PUBLIC_BOOTSTRAP, ...knownAgents])];

        return json({
          peers: allPeers,
          network: {
            peerCount: metrics.totalPeers || knownAgents.length,
            roomCount: metrics.totalRooms || 1,
            protocolVersion: 1,
            minClientVersion: '1.1.0',
          },
          discoveryTopics: DISCOVERY_TOPICS,
          nats: { servers: ['wss://demo.nats.io:8443'], subjects: ['nexus.agents.discovery', 'nexus.agents.presence'] },
        });
      }

      // ── Network state: in-memory metrics + KV snapshot ──
      case '/api/v1/network': {
        let snapshot: any = null;
        try {
          snapshot = await env.AGENTS.get('network-snapshot', 'json');
        } catch { /* miss is fine */ }

        return json({
          peerCount: metrics.totalPeers || snapshot?.peerCount || 0,
          roomCount: metrics.totalRooms || snapshot?.roomCount || 1,
          messageRate: metrics.messageRate,
          storageProviders: 0,
          protocolVersion: 1,
          uptime: metrics.lastReport > 0 ? Math.floor((Date.now() - metrics.lastReport) / 1000) : 0,
          rooms: snapshot?.rooms || [{ roomId: 'general', name: 'general', topic: '/nexus/room/general', memberCount: 0, type: 'persistent', access: 'public', manifest: '' }],
          knownAgents: snapshot?.knownAgents || [],
        });
      }

      // ── Room list ──
      case '/api/v1/rooms': {
        let snapshot: any = null;
        try { snapshot = await env.AGENTS.get('network-snapshot', 'json'); } catch {}

        return json({
          rooms: snapshot?.rooms || [{ roomId: 'general', name: 'general', topic: '/nexus/room/general', memberCount: 0, type: 'persistent', access: 'public', manifest: '' }],
        });
      }

      // ── Lightweight aggregate metrics (in-memory, no KV write) ──
      case '/api/v1/metrics': {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

        let body: any;
        try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

        metrics.totalPeers = Math.max(0, Number(body.peers) || 0);
        metrics.totalRooms = Math.max(0, Number(body.rooms) || 0);
        metrics.messageRate = Math.max(0, Number(body.msgRate) || 0);
        metrics.lastReport = Date.now();
        metrics.reportCount++;

        return json({ ok: true });
      }

      // ── Directory snapshot: low-frequency KV write of known addresses ──
      // Agents POST their address here. Max 1 KV write per 60 seconds.
      // Payload: { peerId, agentName, multiaddrs, rooms, nknAddress? }
      case '/api/v1/directory': {
        if (request.method === 'GET') {
          // Read the directory
          try {
            const dir = await env.AGENTS.get('known-agents', 'json');
            return json(dir || { addresses: [], agents: [], updatedAt: 0 });
          } catch {
            return json({ addresses: [], agents: [], updatedAt: 0 });
          }
        }

        if (request.method !== 'POST') return json({ error: 'GET or POST' }, 405);

        let body: any;
        try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

        if (!body.peerId || typeof body.peerId !== 'string') {
          return json({ error: 'peerId required' }, 400);
        }

        // Rate limit KV writes
        const now = Date.now();
        if (now - lastDirectoryWrite < DIRECTORY_WRITE_INTERVAL) {
          // Accept the data but skip the KV write — in-memory only
          return json({ ok: true, persisted: false, reason: 'rate-limited', nextWriteIn: DIRECTORY_WRITE_INTERVAL - (now - lastDirectoryWrite) });
        }

        // Read existing directory
        let existing: any;
        try {
          existing = await env.AGENTS.get('known-agents', 'json') || { addresses: [], agents: [] };
        } catch {
          existing = { addresses: [], agents: [] };
        }

        // Build agent entry (minimal — no model info, no GPU, just addresses)
        const entry = {
          peerId: String(body.peerId).slice(0, 128),
          agentName: String(body.agentName || 'anon').slice(0, 64),
          multiaddrs: Array.isArray(body.multiaddrs) ? body.multiaddrs.slice(0, 10).map((a: any) => String(a).slice(0, 256)) : [],
          rooms: Array.isArray(body.rooms) ? body.rooms.slice(0, 10).map((r: any) => String(r).slice(0, 64)) : [],
          nknAddress: body.nknAddress ? String(body.nknAddress).slice(0, 256) : undefined,
          lastSeen: now,
        };

        // Upsert: replace existing entry for this peerId or add new
        const agents = (existing.agents || []).filter((a: any) => a.peerId !== entry.peerId);
        agents.push(entry);

        // Cap at 100 agents, drop oldest
        agents.sort((a: any, b: any) => (b.lastSeen || 0) - (a.lastSeen || 0));
        const capped = agents.slice(0, 100);

        // Extract all multiaddrs for the bootstrap endpoint
        const allAddrs = capped.flatMap((a: any) => a.multiaddrs || []);

        const directory = {
          addresses: allAddrs,
          agents: capped,
          updatedAt: now,
        };

        // Write to KV — this is the only write, max once per 60s
        await env.AGENTS.put('known-agents', JSON.stringify(directory));

        // Also snapshot network state
        await env.AGENTS.put('network-snapshot', JSON.stringify({
          peerCount: capped.length,
          roomCount: new Set(capped.flatMap((a: any) => a.rooms || [])).size || 1,
          rooms: Array.from(new Set(capped.flatMap((a: any) => a.rooms || ['general']))).map(r => ({
            roomId: r, name: r, topic: `/nexus/room/${r}`,
            memberCount: capped.filter((a: any) => (a.rooms || []).includes(r)).length,
            type: 'persistent', access: 'public', manifest: '',
          })),
          knownAgents: capped.map((a: any) => ({
            peerId: a.peerId,
            agentName: a.agentName,
            rooms: a.rooms,
            nknAddress: a.nknAddress,
          })),
          updatedAt: now,
        }));

        lastDirectoryWrite = now;
        return json({ ok: true, persisted: true, agentsInDirectory: capped.length });
      }

      default: {
        const nonce = crypto.randomUUID().replace(/-/g, '');
        let html = INDEX_HTML;
        html = html.replace(/<script type="importmap">/g, `<script type="importmap" nonce="${nonce}">`);
        html = html.replace(/<script type="module">/g, `<script type="module" nonce="${nonce}">`);

        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': `script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; connect-src 'self' https://cdn.jsdelivr.net wss://demo.nats.io:8443; object-src 'none'`,
          },
        });
      }
    }
  },
};
