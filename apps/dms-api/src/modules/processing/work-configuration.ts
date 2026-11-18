import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const url = z.url().refine((v) => {
  const u = new URL(v);
  return (
    ['https:', 'http:'].includes(u.protocol) &&
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash &&
    !v.endsWith('/')
  );
});
export const workEnvironmentSchema = z.object({
  INSTALLATION_TENANT_ID: z.uuid(),
  INSTALLATION_CUSTOMER_KEY: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  DMS_COORDINATOR_DATABASE_URL: z.url(),
  DMS_WORK_ISSUER_URL: url,
  DMS_WORK_ALLOW_HTTP: z.enum(['true', 'false']).default('false'),
});
@Injectable()
export class WorkConfiguration {
  readonly value: ReturnType<typeof workEnvironmentSchema.parse>;
  constructor() {
    const parsed = workEnvironmentSchema.safeParse(process.env);
    if (!parsed.success) throw new Error('Private work configuration required');
    const value = parsed.data,
      u = new URL(value.DMS_WORK_ISSUER_URL);
    if (
      !value.DMS_WORK_ISSUER_URL.endsWith('/identity') ||
      (u.protocol !== 'https:' && value.DMS_WORK_ALLOW_HTTP !== 'true')
    )
      throw new Error('Private work issuer configuration rejected');
    this.value = value;
  }
  get audience() {
    return `${this.value.DMS_WORK_ISSUER_URL}/services/work`;
  }
}
export class WorkError extends Error {
  constructor(
    readonly code:
      | 'WORK_INVALID'
      | 'WORK_DENIED'
      | 'WORK_STALE'
      | 'WORK_CONFLICT'
      | 'WORK_UNAVAILABLE',
    readonly status = 409,
  ) {
    super(code);
  }
}
