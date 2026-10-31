import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../src/bootstrap.js';

describe('Thaarei DMS API', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApplication(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
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
});
