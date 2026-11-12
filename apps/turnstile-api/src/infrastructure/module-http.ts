import type { FastifyInstance } from 'fastify';
/** Covers guard failures and unregistered module routes as well as successful handlers. */
export function registerModuleHttp(server: FastifyInstance) {
  server.addHook('onSend', async (request, reply, payload) => {
    if (/^\/api\/modules(?:\/|$)/.test(request.url.split('?')[0] ?? '')) {
      reply.header('cache-control', 'private, no-store');
      reply.header('referrer-policy', 'no-referrer');
    }
    return payload;
  });
}
