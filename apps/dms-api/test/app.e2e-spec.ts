import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../src/bootstrap.js';

describe('Thaarei DMS API', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    vi.stubEnv('AUTH_SECRET', '');
    app = await createApplication(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('returns the application identity through the configured prefix', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ name: 'Thaarei DMS API' });
  });

  it('exposes process liveness without claiming dependency readiness', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('fails auth readiness without changing process liveness', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready/auth' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable', reason: 'invalid_configuration' });
  });
});
