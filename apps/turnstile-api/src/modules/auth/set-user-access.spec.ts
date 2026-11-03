import { setUserAccess } from './set-user-access.js';

it('rejects missing operator attribution and configuration authority without product access before connecting', async () => {
  await expect(
    setUserAccess(
      {
        userId: 'fixture-user',
        enabled: true,
        permissions: ['turnstile:access', 'turnstile:configuration:manage'],
      },
      {},
    ),
  ).rejects.toMatchObject({ name: 'ZodError' });
  await expect(
    setUserAccess(
      {
        operatorId: 'fixture-operator',
        userId: 'fixture-user',
        enabled: true,
        permissions: ['turnstile:configuration:manage'],
      },
      {},
    ),
  ).rejects.toMatchObject({ name: 'ZodError' });
});
