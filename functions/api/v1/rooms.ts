/**
 * Cloudflare Pages Function: GET /api/v1/rooms
 * Returns available rooms.
 */

interface Env {}

export const onRequestGet: PagesFunction<Env> = async () => {
  const response = {
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
      'Cache-Control': 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
