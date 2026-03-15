/**
 * Cloudflare Worker — openagents.nexus API
 *
 * HTML served directly from Worker (not assets) to prevent
 * Cloudflare edge script injection (SES lockdown / beacon).
 * API routes handle bootstrap, network state, and agent reporting.
 * Live agent data stored in KV with 60s TTL.
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

// KV key prefix for agent records
const AGENT_PREFIX = 'agent:';
const AGENT_TTL = 60; // seconds — agents must heartbeat within this window

// Get all live agents from KV
async function getLiveAgents(kv: KVNamespace): Promise<any[]> {
  const list = await kv.list({ prefix: AGENT_PREFIX });
  const agents: any[] = [];
  for (const key of list.keys) {
    const val = await kv.get(key.name, 'json');
    if (val) agents.push(val);
  }
  return agents;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    switch (url.pathname) {

      // ── Bootstrap peers for agent discovery ──
      case '/api/v1/bootstrap':
        return json({
          peers: PUBLIC_BOOTSTRAP,
          network: { peerCount: PUBLIC_BOOTSTRAP.length, roomCount: 1, protocolVersion: 1, minClientVersion: '0.1.0' },
          discoveryTopics: DISCOVERY_TOPICS,
        });

      // ── Live network state (reads from KV) ──
      case '/api/v1/network': {
        const agents = await getLiveAgents(env.AGENTS);
        const rooms = new Set<string>();
        agents.forEach(a => (a.rooms || []).forEach((r: string) => rooms.add(r)));
        if (rooms.size === 0) rooms.add('general');

        return json({
          peerCount: agents.length,
          roomCount: rooms.size,
          messageRate: 0,
          storageProviders: agents.filter((a: any) => a.role === 'storage').length,
          protocolVersion: 1,
          uptime: 0,
          rooms: Array.from(rooms).map(r => ({
            roomId: r, name: r, topic: `/nexus/room/${r}`,
            memberCount: agents.filter((a: any) => (a.rooms || []).includes(r)).length,
            type: 'persistent', access: 'public', manifest: '',
          })),
          agents: agents.map(a => ({
            peerId: a.peerId,
            agentName: a.agentName || 'anonymous',
            rooms: a.rooms || [],
            capabilities: a.capabilities || [],
            model: a.model || null,
            system: a.system || null,
            role: a.role || 'full',
            version: a.version || 'unknown',
            lastSeen: a.lastSeen || 0,
          })),
        });
      }

      // ── Room list ──
      case '/api/v1/rooms': {
        const agents = await getLiveAgents(env.AGENTS);
        const rooms = new Set<string>(['general']);
        agents.forEach(a => (a.rooms || []).forEach((r: string) => rooms.add(r)));

        return json({
          rooms: Array.from(rooms).map(r => ({
            roomId: r, name: r, topic: `/nexus/room/${r}`,
            memberCount: agents.filter((a: any) => (a.rooms || []).includes(r)).length,
            type: 'persistent', access: 'public', manifest: '',
          })),
        });
      }

      // ── Agent heartbeat/report (POST) ──
      case '/api/v1/report': {
        if (request.method !== 'POST') {
          return json({ error: 'POST required' }, 405);
        }

        let body: any;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'Invalid JSON' }, 400);
        }

        // Validate required field
        if (!body.peerId || typeof body.peerId !== 'string' || body.peerId.length < 10) {
          return json({ error: 'Missing or invalid peerId' }, 400);
        }

        // Sanitize — strip anything dangerous, cap string lengths
        const record = {
          peerId: body.peerId.slice(0, 128),
          agentName: (body.agentName || 'anonymous').slice(0, 64).replace(/[^\w\s\-_.]/g, ''),
          rooms: Array.isArray(body.rooms) ? body.rooms.slice(0, 20).map((r: any) => String(r).slice(0, 64)) : [],
          capabilities: Array.isArray(body.capabilities) ? body.capabilities.slice(0, 20).map((c: any) => String(c).slice(0, 64)) : [],
          model: body.model ? {
            name: String(body.model.name || '').slice(0, 64),
            params: String(body.model.params || '').slice(0, 16),
            vram: String(body.model.vram || '').slice(0, 16),
            backend: String(body.model.backend || '').slice(0, 32),
            tokensPerSecond: Number(body.model.tokensPerSecond) || 0,
          } : null,
          system: body.system ? {
            cores: Number(body.system.cores) || 0,
            ramGB: Number(body.system.ramGB) || 0,
            gpu: String(body.system.gpu || '').slice(0, 128),
          } : null,
          role: ['light', 'full', 'storage'].includes(body.role) ? body.role : 'full',
          version: String(body.version || '').slice(0, 32),
          lastSeen: Date.now(),
        };

        // Store in KV with TTL — auto-expires if agent stops heartbeating
        await env.AGENTS.put(
          AGENT_PREFIX + record.peerId,
          JSON.stringify(record),
          { expirationTtl: AGENT_TTL },
        );

        return json({ ok: true, peerId: record.peerId, ttl: AGENT_TTL });
      }

      default: {
        // Generate a per-request nonce — only scripts with this nonce will execute.
        // Cloudflare's injected lockdown-install.js and beacon.min.js won't have it.
        const nonce = crypto.randomUUID().replace(/-/g, '');

        // Inject the nonce into our script tags
        let html = INDEX_HTML;
        html = html.replace(/<script type="importmap">/g, `<script type="importmap" nonce="${nonce}">`);
        html = html.replace(/<script type="module">/g, `<script type="module" nonce="${nonce}">`);

        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': `script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; object-src 'none'`,
          },
        });
      }
    }
  },
};
