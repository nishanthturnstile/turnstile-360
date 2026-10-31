import { randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { type EnrollmentResponse, enrollmentRequestSchema } from '@thaarei/dms-contracts';
import type { FastifyRequest } from 'fastify';
import { withTenant } from '../../infrastructure/database/postgres.js';
import type { ApplicationRegistration } from '../access/access-policy.js';
import { DmsDatabaseService } from '../access/dms-database/dms-database.service.js';
import { dmsError } from '../access/dms-errors.js';
import { insertSecurityEvent } from '../audit/security-event.js';
import { parseAuthorityEnvironment } from '../platform-auth/authority-configuration.js';
import { digest, matchesDigest } from './enrollment-operator.js';

@Injectable()
export class EnrollmentService {
  constructor(private readonly database: DmsDatabaseService) {}
  async enroll(
    request: FastifyRequest,
  ): Promise<{ replay: boolean; response: EnrollmentResponse }> {
    const input = enrollmentRequestSchema.safeParse(request.body);
    const secret = request.headers['x-thaarei-enrollment-key'];
    const keyId =
      typeof secret === 'string'
        ? /^the_([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})\.[A-Za-z0-9_-]{43}$/.exec(secret)?.[1]
        : undefined;
    const idempotency = request.headers['idempotency-key'];
    if (
      !input.success ||
      typeof idempotency !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(idempotency)
    )
      return dmsError(400, 'INVALID_REQUEST');
    if (!keyId || typeof secret !== 'string') return dmsError(403, 'ENROLLMENT_KEY_INVALID');
    const config = parseAuthorityEnvironment(process.env);
    const pool = this.database.pool;
    const principal = request.machine;
    if (!pool || !principal) return dmsError(503, 'DMS_UNAVAILABLE');
    const requestHash = digest(JSON.stringify({ name: input.data.name }));
    const idempotencyHash = digest(idempotency);
    try {
      return await withTenant(pool, config.INSTALLATION_TENANT_ID, async (client) => {
        const { rows } = await client.query<ApplicationRegistration>(
          'SELECT * FROM dms.application_registration WHERE issuer = $1 AND client_id = $2 FOR UPDATE NOWAIT',
          [principal.issuer, principal.clientId],
        );
        const app = rows[0];
        if (app?.principal_kind !== 'consumer' || app.status === 'disabled')
          return dmsError(403, 'APPLICATION_DENIED');
        if (principal.scopes.some((scope) => !app.scope_ceiling.includes(scope)))
          return dmsError(403, 'SCOPE_DENIED');
        const keys = await client.query<{
          digest: string;
          application_id: string;
          deployment_id: string;
          issuer: string;
          client_id: string;
          revoked_at: Date | null;
          consumed_at: Date | null;
          expires_at: Date;
        }>('SELECT * FROM dms.enrollment_key WHERE id = $1 FOR UPDATE NOWAIT', [keyId]);
        const key = keys.rows[0];
        if (
          !key ||
          !matchesDigest(secret, key.digest) ||
          key.application_id !== app.id ||
          key.deployment_id !== config.DMS_RESOURCE_URL ||
          key.issuer !== principal.issuer ||
          key.client_id !== principal.clientId
        )
          return dmsError(403, 'ENROLLMENT_KEY_INVALID');
        if (key.revoked_at) return dmsError(403, 'ENROLLMENT_KEY_REVOKED');
        const receipts = await client.query<{
          id: string;
          enrollment_key_id: string;
          request_hash: string;
          expires_at: Date;
          fresh: boolean;
        }>(
          'SELECT *, expires_at > now() AS fresh FROM dms.enrollment_receipt WHERE deployment_id = $1 AND issuer = $2 AND client_id = $3 AND operation = $4 AND idempotency_hash = $5',
          [
            config.DMS_RESOURCE_URL,
            principal.issuer,
            principal.clientId,
            'application-enrollment:v1',
            idempotencyHash,
          ],
        );
        const receipt = receipts.rows[0];
        const event = {
          action: 'application.enroll',
          outcome: 'success' as const,
          actorKind: 'machine' as const,
          actorId: principal.clientId,
          subjectId: app.id,
          requestId: request.id,
        };
        if (receipt) {
          if (receipt.request_hash !== requestHash || receipt.enrollment_key_id !== keyId)
            return dmsError(409, 'IDEMPOTENCY_CONFLICT');
          if (!receipt.fresh) return dmsError(410, 'REPLAY_WINDOW_EXPIRED');
          if (app.status !== 'active') return dmsError(403, 'APPLICATION_DENIED');
          await insertSecurityEvent(client, config.INSTALLATION_TENANT_ID, {
            ...event,
            action: 'application.enroll.replay',
          });
          return {
            replay: true,
            response: {
              applicationId: app.id,
              tenantId: app.tenant_id,
              status: 'active',
              receiptId: receipt.id,
              replayUntil: receipt.expires_at.toISOString(),
            },
          };
        }
        if (key.consumed_at) return dmsError(403, 'ENROLLMENT_KEY_USED');
        const {
          rows: [clock],
        } = await client.query<{ live: boolean }>('SELECT $1::timestamptz > now() AS live', [
          key.expires_at,
        ]);
        if (!clock?.live) return dmsError(410, 'ENROLLMENT_KEY_EXPIRED');
        if (app.status !== 'pending') return dmsError(403, 'APPLICATION_DENIED');
        if (app.name !== input.data.name) return dmsError(400, 'ENROLLMENT_NAME_MISMATCH');
        await client.query('UPDATE dms.enrollment_key SET consumed_at = now() WHERE id = $1', [
          keyId,
        ]);
        await client.query(
          "UPDATE dms.application_registration SET status = 'active', updated_at = now() WHERE id = $1",
          [app.id],
        );
        const id = randomUUID();
        const saved = await client.query<{ expires_at: Date }>(
          "INSERT INTO dms.enrollment_receipt (id, tenant_id, application_id, deployment_id, issuer, client_id, operation, idempotency_hash, request_hash, enrollment_key_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '24 hours') RETURNING expires_at",
          [
            id,
            app.tenant_id,
            app.id,
            config.DMS_RESOURCE_URL,
            principal.issuer,
            principal.clientId,
            'application-enrollment:v1',
            idempotencyHash,
            requestHash,
            keyId,
          ],
        );
        await insertSecurityEvent(client, config.INSTALLATION_TENANT_ID, event);
        if (!saved.rows[0]) throw new Error('Enrollment receipt unavailable');
        return {
          replay: false,
          response: {
            applicationId: app.id,
            tenantId: app.tenant_id,
            status: 'active',
            receiptId: id,
            replayUntil: saved.rows[0].expires_at.toISOString(),
          },
        };
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '55P03')
        return dmsError(409, 'ENROLLMENT_IN_PROGRESS');
      if (error instanceof HttpException) {
        await withTenant(pool, config.INSTALLATION_TENANT_ID, (client) =>
          insertSecurityEvent(client, config.INSTALLATION_TENANT_ID, {
            action: 'application.enroll',
            outcome: 'denied',
            actorKind: 'machine',
            actorId: principal.clientId,
            subjectId: request.registration?.id ?? keyId,
            requestId: request.id,
          }),
        );
      }
      throw error;
    }
  }
}
