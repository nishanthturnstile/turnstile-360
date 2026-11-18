import { HttpException } from '@nestjs/common';
import {
  DOCUMENTS_LIMITS,
  documentsErrorSchema,
  V3_PERMISSIONS,
} from '@thaarei/turnstile-contracts/documents';
import Fastify from 'fastify';
import { accessWireContext, registerAccessContractHttp } from './access-contract.js';
import { documentsHttpFailure, registerDocumentsHttp } from './documents-http.js';

describe('Documents production parser hooks and request-local compatibility', () => {
  it('isolates negotiated concurrent contexts and keeps exact legacy catalogue/session projections', async () => {
    const app = Fastify();
    registerAccessContractHttp(app);
    app.get('/api/people/catalog', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        catalogVersion: 3,
        permissions: V3_PERMISSIONS.map((id) => ({ id })),
        version: accessWireContext.getStore()?.version,
      };
    });
    app.get('/api/auth/session', async () => ({
      access: { catalogVersion: 2 },
      version: accessWireContext.getStore()?.version,
    }));
    try {
      const [old, current] = await Promise.all([
        app.inject('/api/people/catalog'),
        app.inject({ url: '/api/people/catalog', headers: { 'x-turnstile-access-contract': '3' } }),
      ]);
      expect(old.json().catalogVersion).toBe(2);
      expect(old.json().version).toBe(2);
      expect(old.json().permissions).toHaveLength(V3_PERMISSIONS.length - 9);
      expect(current.json().catalogVersion).toBe(3);
      expect(current.json().version).toBe(3);
      expect(current.json().permissions).toHaveLength(V3_PERMISSIONS.length);
      expect(
        (
          await app.inject({
            url: '/api/auth/session',
            headers: { 'x-turnstile-access-contract': '3' },
          })
        ).json().access.catalogVersion,
      ).toBe(3);
      expect(accessWireContext.getStore()).toBeUndefined();
    } finally {
      await app.close();
    }
  });
  it('admits a full manifest through the actual scoped parser and rejects oversize/media/schema errors without changing unrelated limits', async () => {
    const app = Fastify({ bodyLimit: 16384 });
    registerDocumentsHttp(app);
    app.setErrorHandler((error, request, reply) => {
      const status =
        error instanceof HttpException
          ? error.getStatus()
          : error &&
              typeof error === 'object' &&
              'statusCode' in error &&
              typeof error.statusCode === 'number'
            ? error.statusCode
            : 503;
      reply
        .code(status)
        .send(
          documentsHttpFailure(
            error instanceof HttpException ? error.getResponse() : undefined,
            status,
            request.id,
          ),
        );
    });
    app.post('/api/documents/operations', async () => ({ accepted: true })); // Isolate the production parser hooks.
    app.post('/api/unrelated', async () => ({ accepted: true }));
    const payload = {
      mode: 'ordinary',
      command: {
        kind: 'batch.create',
        payload: {
          items: Array.from({ length: 100 }, (_, i) => ({
            itemId: `item_${i}`,
            operation: 'create',
            descriptor: {
              title: 'Fixture',
              fileName: 'fixture.txt',
              size: 8,
              contentType: 'text/plain',
              profile: 'secure-only',
              metadata: { note: 'x'.repeat(2000) },
            },
          })),
        },
      },
    };
    try {
      expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(16384);
      expect(
        (await app.inject({ method: 'POST', url: '/api/documents/operations', payload }))
          .statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ method: 'POST', url: '/api/unrelated', payload })).statusCode,
      ).toBe(413);
      for (const [headers, body, status, code] of [
        [
          { 'content-type': 'application/json' },
          'x'.repeat(DOCUMENTS_LIMITS.batchEnvelopeBytes + 1),
          413,
          'DOCUMENTS_TOO_LARGE',
        ],
        [{ 'content-type': 'text/plain' }, 'text', 415, 'DOCUMENTS_MEDIA_TYPE_UNSUPPORTED'],
        [
          { 'content-type': 'application/json' },
          JSON.stringify({ command: { kind: 'arbitrary.proxy' } }),
          400,
          'DOCUMENTS_INVALID',
        ],
      ] as const) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/documents/operations',
          headers,
          payload: body,
        });
        expect(response.statusCode).toBe(status);
        expect(documentsErrorSchema.parse(response.json()).code).toBe(code);
      }
    } finally {
      await app.close();
    }
  });
});
