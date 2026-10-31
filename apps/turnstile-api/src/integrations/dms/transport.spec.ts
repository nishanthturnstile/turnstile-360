import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import {
  ClientCredentialsTokenProvider,
  DmsClient,
  type MachineTokenProvider,
} from '@thaarei/dms-client';

const token = (sequence = 1) => ({
  access_token: `header.payload${sequence}.signature`,
  token_type: 'Bearer',
  expires_in: 300,
  scope: 'dms:capabilities:read',
});
const capabilities = {
  contractVersion: 1,
  applicationId: randomUUID(),
  tenantId: randomUUID(),
  operations: ['application-enrollment', 'capabilities:read'],
  formats: [],
  profiles: [],
  languages: [],
  limits: { accessTokenSeconds: 300, idempotencyWindowSeconds: 86400 },
};

describe('DMS machine transport security and retry boundary', () => {
  it('coalesces acquisition/early renewal and prevents a late rejection from evicting a newer cached token', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-31T00:00:00Z'));
      let calls = 0;
      const transport = vi.fn<typeof fetch>(async (url, options) => {
        calls++;
        expect(url).toBe('https://identity.example.test/identity/oauth2/token');
        expect(options?.redirect).toBe('error');
        expect(options?.credentials).toBe('omit');
        const body = new URLSearchParams(String(options?.body));
        expect(Object.fromEntries(body)).toEqual({
          grant_type: 'client_credentials',
          scope: 'dms:capabilities:read',
          resource: 'https://dms.example.test/v1',
        });
        expect(new Headers(options?.headers).get('authorization')?.startsWith('Basic ')).toBe(true);
        return Response.json(token(calls));
      });
      const options = {
        issuerUrl: 'https://identity.example.test/identity',
        resource: 'https://dms.example.test/v1',
        clientId: 'machine-client',
        clientSecret: 'fixture-credential',
        scopes: ['dms:capabilities:read'] as const,
        transport,
      };
      const provider = new ClientCredentialsTokenProvider(options);
      const first = await Promise.all(Array.from({ length: 10 }, () => provider.getToken()));
      expect(calls).toBe(1);
      expect(first.every((entry) => entry === first[0])).toBe(true);
      vi.setSystemTime(Date.now() + 271000);
      const renewed = await Promise.all(Array.from({ length: 10 }, () => provider.getToken()));
      expect(calls).toBe(2);
      provider.invalidate(first[0] as NonNullable<(typeof first)[0]>);
      expect(await provider.getToken()).toBe(renewed[0]);
      // Separate identities do not share a cached credential.
      await new ClientCredentialsTokenProvider({
        ...options,
        clientId: 'another-client',
      }).getToken();
      expect(calls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renews once only for an explicit expired-token read and never retries policy, outage or enrollment failures', async () => {
    const provider: MachineTokenProvider = {
      getToken: vi.fn(async () => ({
        accessToken: token().access_token,
        expiresAt: Date.now() + 300000,
      })),
      invalidate: vi.fn(),
    };
    let status = 401;
    let code = 'MACHINE_TOKEN_EXPIRED';
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json(
        status === 200
          ? capabilities
          : { code, requestId: randomUUID(), retryable: status === 503 },
        { status },
      ),
    );
    const client = new DmsClient({
      baseUrl: 'https://dms.example.test/v1',
      tokenProvider: provider,
      transport,
    });
    await expect(client.capabilities()).rejects.toMatchObject({ code: 'DMS_MACHINE_AUTH_FAILED' });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(provider.invalidate).toHaveBeenCalledTimes(1);
    transport.mockClear();
    transport.mockImplementationOnce(async () =>
      Response.json({ code, requestId: randomUUID(), retryable: false }, { status: 401 }),
    );
    status = 200;
    expect(await client.capabilities()).toEqual(capabilities);
    expect(transport).toHaveBeenCalledTimes(2);
    for (const [nextStatus, nextCode, expected] of [
      [401, 'INVALID_MACHINE_TOKEN', 'DMS_MACHINE_AUTH_FAILED'],
      [403, 'SCOPE_DENIED', 'DMS_ACCESS_DENIED'],
      [503, 'DMS_UNAVAILABLE', 'DMS_UNAVAILABLE'],
    ] as const) {
      transport.mockClear();
      status = nextStatus;
      code = nextCode;
      await expect(client.capabilities()).rejects.toMatchObject({ code: expected });
      expect(transport).toHaveBeenCalledTimes(1);
    }
    transport.mockClear();
    status = 401;
    code = 'MACHINE_TOKEN_EXPIRED';
    await expect(
      client.enroll({
        request: { name: 'Fixture' },
        idempotencyKey: randomUUID(),
        enrollmentKey: `the_${randomUUID()}.${'a'.repeat(43)}`,
      }),
    ).rejects.toMatchObject({ code: 'DMS_ENROLLMENT_FAILED' });
    expect(transport).toHaveBeenCalledTimes(1);
    transport.mockClear();
    status = 409;
    code = 'ENROLLMENT_IN_PROGRESS';
    await expect(
      client.enroll({
        request: { name: 'Fixture' },
        idempotencyKey: randomUUID(),
        enrollmentKey: `the_${randomUUID()}.${'a'.repeat(43)}`,
      }),
    ).rejects.toMatchObject({
      code: 'DMS_ENROLLMENT_FAILED',
      domainCode: 'ENROLLMENT_IN_PROGRESS',
      retryable: true,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    status = 200;
    expect(await client.capabilities()).toEqual(capabilities);
  });

  it('blocks HTTP redirects, bounds stalled responses and rejects oversized or invalid success bodies', async () => {
    let mode = 'redirect';
    let calls = 0;
    const server = createServer((_request, response) => {
      calls++;
      if (mode === 'redirect') response.writeHead(302, { location: '/credential-leak' }).end();
      if (mode === 'large')
        response.writeHead(200, { 'content-type': 'application/json' }).end('x'.repeat(17000));
      if (mode === 'invalid')
        response.writeHead(200, { 'content-type': 'application/json' }).end('{"unexpected":true}');
      if (mode === 'stall')
        response.writeHead(200, { 'content-type': 'application/json' }).flushHeaders();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture');
      const client = new DmsClient({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        allowInsecureHttp: true,
        timeoutMs: 100,
        tokenProvider: {
          getToken: async () => ({
            accessToken: token().access_token,
            expiresAt: Date.now() + 300000,
          }),
          invalidate: () => {},
        },
      });
      await expect(client.capabilities()).rejects.toMatchObject({ code: 'DMS_UNAVAILABLE' });
      expect(calls).toBe(1);
      mode = 'stall';
      await expect(client.capabilities()).rejects.toMatchObject({ code: 'DMS_UNAVAILABLE' });
      for (mode of ['large', 'invalid'])
        await expect(client.capabilities()).rejects.toMatchObject({ code: 'DMS_INVALID_RESPONSE' });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
