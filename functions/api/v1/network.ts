/**
 * Cloudflare Pages Function: GET /api/v1/network
 * Returns network statistics.
 */

interface Env {}

export const onRequestGet: PagesFunction<Env> = async () => {
  const response = {
    peerCount: 0,
    roomCount: 1,
    messageRate: 0,
    storageProviders: 0,
    protocolVersion: 1,
    uptime: 0,
    rooms: [
      {
        roomId: 'general',
        name: 'General Discussion',
        topic: '/nexus/room/general',
        memberCount: 0,
        type: 'persistent',
        access: 'public',
        manifest: '',
      },
    ],
  };

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=30',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
