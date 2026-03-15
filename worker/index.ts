/**
 * Cloudflare Worker — openagents.nexus API
 *
 * HTML served directly from Worker (not assets) to prevent
 * Cloudflare edge script injection (SES lockdown / beacon).
 * API routes handle bootstrap and network state.
 *
 * Phase 8: All metrics are in-memory only — no KV, no PII, no agent identity.
 * Nodes POST lightweight aggregate counters (peer count, room count, msg rate)
 * via /api/v1/metrics. Counters reset on Worker restart — that is acceptable.
 */

import { INDEX_HTML } from './html.js';

// No Env bindings — KV removed in Phase 8
interface Env {}

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

// ── In-memory aggregate metrics — NOT persisted, resets on Worker restart ──
// Nodes POST simple counters here. No PII, no identity, no message content.
let metrics = {
  totalPeers: 0,
  totalRooms: 0,
  messageRate: 0,
  lastReport: 0,
  reportCount: 0,
};

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
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

      // ── Live network state (reads from in-memory metrics) ──
      case '/api/v1/network': {
        return json({
          peerCount: metrics.totalPeers,
          roomCount: metrics.totalRooms || 1,
          messageRate: metrics.messageRate,
          storageProviders: 0,
          protocolVersion: 1,
          uptime: metrics.lastReport > 0 ? Math.floor((Date.now() - metrics.lastReport) / 1000) : 0,
          rooms: [{ roomId: 'general', name: 'general', topic: '/nexus/room/general', memberCount: metrics.totalPeers, type: 'persistent', access: 'public', manifest: '' }],
          // NO agents array — individual agent data is P2P only
        });
      }

      // ── Room list (static — no KV) ──
      case '/api/v1/rooms': {
        return json({
          rooms: [{ roomId: 'general', name: 'general', topic: '/nexus/room/general', memberCount: metrics.totalPeers, type: 'persistent', access: 'public', manifest: '' }],
        });
      }

      // ── Lightweight aggregate metrics report from any node ──
      // Accepts: { peers: number, rooms: number, msgRate: number }
      // Does NOT accept: agent names, peer IDs, message content, model info
      case '/api/v1/metrics': {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

        let body: any;
        try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

        // Accept only simple counters — no PII, no identity
        metrics.totalPeers = Math.max(0, Number(body.peers) || 0);
        metrics.totalRooms = Math.max(0, Number(body.rooms) || 0);
        metrics.messageRate = Math.max(0, Number(body.msgRate) || 0);
        metrics.lastReport = Date.now();
        metrics.reportCount++;

        return json({ ok: true });
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
