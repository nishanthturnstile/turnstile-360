import type { FastifyRequest } from 'fastify';
import { configurationActor } from './configuration-http.js';

function request(id: string, query: Record<string, unknown> = {}) {
  return {
    id,
    query,
    productUser: { identity: { user: { id: 'fixture-user' } } },
  } as unknown as FastifyRequest;
}

it('keeps the server request UUID for audit attribution', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const actor = configurationActor(request(id));
  expect(actor.requestId).toBe(id);
  expect(actor.userId).toBe('fixture-user');
});

it('replaces a non-UUID request id once and keeps it stable for the request', () => {
  const current = request('req-1');
  const first = configurationActor(current).requestId;
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(current.id).toBe(first);
  expect(configurationActor(current).requestId).toBe(first);
});

it('generates a distinct fallback id for each request', () => {
  expect(configurationActor(request('req-1')).requestId).not.toBe(
    configurationActor(request('req-2')).requestId,
  );
});

it('still rejects missing verified identity and caller-supplied query selectors', () => {
  expect(() =>
    configurationActor({ id: 'req-1', query: {} } as unknown as FastifyRequest),
  ).toThrow();
  expect(() => configurationActor(request('req-1', { tenantId: 'forged' }))).toThrow();
});
