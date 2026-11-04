import { randomUUID } from 'node:crypto';
import {
  type BeforeApplicationShutdown,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { featureWritesOpen } from '../access/release-state.js';
import { openPayload } from './invitation-crypto.js';
import { InvitationMailService, type MailOutcome } from './invitation-mail.service.js';
import { invitationAudit } from './invitation-policy.js';
import { InvitationStoreService } from './invitation-store.service.js';
export interface DeliveryClaim {
  invitation_id: string;
  generation: number;
  lease_id: string;
  payload: string;
  attempts: number;
  email: string;
}
@Injectable()
export class InvitationDeliveryService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<unknown> | undefined;
  private stopping = false;
  readonly metrics = { batches: 0, accepted: 0, failed: 0, unknown: 0, unavailable: 0 };
  constructor(
    private readonly store: InvitationStoreService,
    private readonly mail: InvitationMailService,
  ) {}
  onApplicationBootstrap() {
    if (!this.store.config) return;
    this.timer = setInterval(() => this.schedule(), 5000);
    this.timer.unref();
    this.schedule();
  }
  private schedule() {
    if (this.stopping || this.running) return;
    this.running = this.drain()
      .catch(() => {
        this.metrics.unavailable++;
      })
      .finally(() => {
        this.running = undefined;
      });
  }
  async beforeApplicationShutdown() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.running;
  }
  async claim(): Promise<DeliveryClaim[]> {
    return this.store.run(async (db, tenant, config) => {
      if (!(await featureWritesOpen(db, tenant))) return [];
      await db.query('SELECT turnstile.maintain_invitations($1,$2)', [
        tenant,
        config.recoveryEpoch,
      ]);
      const rows = (
        await db.query<{
          invitation_id: string;
          generation: number;
          payload: string;
          attempts: number;
          email: string;
        }>(
          `SELECT d.invitation_id,d.generation,d.payload,d.attempts,i.email FROM turnstile.invitation_delivery d JOIN turnstile.invitation i ON i.tenant_id=d.tenant_id AND i.id=d.invitation_id AND i.generation=d.generation WHERE d.tenant_id=$1 AND d.state='queued' AND d.next_attempt_at<=statement_timestamp() AND i.state='pending' AND i.expires_at>statement_timestamp() AND i.recovery_epoch=$2 AND d.recovery_epoch=$2 ORDER BY d.next_attempt_at,d.invitation_id LIMIT 10 FOR UPDATE OF d SKIP LOCKED`,
          [tenant, config.recoveryEpoch],
        )
      ).rows;
      const claims: DeliveryClaim[] = [];
      for (const row of rows) {
        const lease = randomUUID();
        await db.query(
          "UPDATE turnstile.invitation_delivery SET state='sending',attempts=attempts+1,lease_id=$4,lease_expires_at=statement_timestamp()+interval '30 seconds' WHERE tenant_id=$1 AND invitation_id=$2 AND generation=$3",
          [tenant, row.invitation_id, row.generation, lease],
        );
        claims.push({ ...row, attempts: row.attempts + 1, lease_id: lease });
      }
      return claims;
    });
  }
  async finish(claim: DeliveryClaim, outcome: MailOutcome) {
    return this.store.run(async (db, tenant, config) => {
      await db.query('SELECT turnstile.maintain_invitations($1,$2)', [
        tenant,
        config.recoveryEpoch,
      ]);
      const valid = (
        await db.query(
          `SELECT 1 FROM turnstile.invitation_delivery d JOIN turnstile.invitation i ON i.tenant_id=d.tenant_id AND i.id=d.invitation_id AND i.generation=d.generation WHERE d.tenant_id=$1 AND d.invitation_id=$2 AND d.generation=$3 AND d.state='sending' AND d.lease_id=$4 AND d.lease_expires_at>statement_timestamp() AND i.state='pending' AND i.expires_at>statement_timestamp() AND i.recovery_epoch=$5 AND d.recovery_epoch=$5`,
          [tenant, claim.invitation_id, claim.generation, claim.lease_id, config.recoveryEpoch],
        )
      ).rowCount;
      if (!valid) return false;
      if (outcome === 'transport_unavailable' && claim.attempts < 5) {
        const delay = [5, 30, 120, 600][claim.attempts - 1] ?? 600;
        await db.query(
          "UPDATE turnstile.invitation_delivery SET state='queued',next_attempt_at=statement_timestamp()+$5*interval '1 second',lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND invitation_id=$2 AND generation=$3 AND lease_id=$4",
          [tenant, claim.invitation_id, claim.generation, claim.lease_id, delay],
        );
        return true;
      }
      const state =
        outcome === 'smtp_accepted'
          ? 'smtp_accepted'
          : outcome === 'deadline'
            ? 'unknown'
            : 'failed';
      const reason =
        outcome === 'smtp_accepted'
          ? null
          : outcome === 'deadline'
            ? 'deadline'
            : outcome === 'transport_unavailable'
              ? 'attempts_exhausted'
              : 'smtp_rejected';
      await db.query(
        'UPDATE turnstile.invitation_delivery SET state=$5,reason=$6,payload=NULL,outcome_at=statement_timestamp(),lease_id=NULL,lease_expires_at=NULL WHERE tenant_id=$1 AND invitation_id=$2 AND generation=$3 AND lease_id=$4',
        [tenant, claim.invitation_id, claim.generation, claim.lease_id, state, reason],
      );
      await invitationAudit(
        db,
        tenant,
        claim.invitation_id,
        claim.generation,
        state === 'smtp_accepted'
          ? 'smtp_accepted'
          : state === 'unknown'
            ? 'delivery_unknown'
            : 'delivery_failed',
      );
      this.metrics[
        state === 'smtp_accepted' ? 'accepted' : state === 'unknown' ? 'unknown' : 'failed'
      ]++;
      return true;
    });
  }
  async deliver(claim: DeliveryClaim) {
    const valid = await this.store.run(async (db, tenant, config) => {
      if (!(await featureWritesOpen(db, tenant))) return false;
      await db.query('SELECT turnstile.maintain_invitations($1,$2)', [
        tenant,
        config.recoveryEpoch,
      ]);
      return (
        (
          await db.query(
            "SELECT 1 FROM turnstile.invitation_delivery d JOIN turnstile.invitation i ON i.tenant_id=d.tenant_id AND i.id=d.invitation_id AND i.generation=d.generation WHERE d.tenant_id=$1 AND d.invitation_id=$2 AND d.generation=$3 AND d.lease_id=$4 AND d.state='sending' AND i.state='pending' AND i.expires_at>statement_timestamp() AND i.recovery_epoch=$5",
            [tenant, claim.invitation_id, claim.generation, claim.lease_id, config.recoveryEpoch],
          )
        ).rowCount === 1
      );
    });
    if (!valid) return false;
    let outcome: MailOutcome;
    try {
      const payload = openPayload(
        this.store.config ??
          (() => {
            throw new Error('Invitation configuration unavailable');
          })(),
        claim.invitation_id,
        claim.generation,
        claim.payload,
      );
      if (payload.email !== claim.email) throw new Error('Delivery binding');
      outcome = await this.mail.send(payload);
    } catch {
      outcome = 'deadline';
    }
    return this.finish(claim, outcome);
  }
  async drain() {
    this.metrics.batches++;
    const claims = await this.claim();
    const outcomes = await Promise.allSettled(claims.map((claim) => this.deliver(claim)));
    for (const outcome of outcomes) if (outcome.status === 'rejected') this.metrics.unavailable++;
    return claims.length;
  }
}
