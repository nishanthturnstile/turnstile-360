import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../src/bootstrap.js';
import { authorityEnvironment } from './auth-environment.js';

describe('configured authority foundations', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    for (const [key, value] of Object.entries(authorityEnvironment())) vi.stubEnv(key, value);
    vi.stubEnv('NODE_ENV', 'test');
    app = await createApplication(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('does not advertise working authentication from valid configuration', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready/auth' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable', reason: 'database_unavailable' });
    expect((await app.inject({ method: 'POST', url: '/identity/sign-in/email' })).statusCode).toBe(
      503,
    );
  });
});
