import { randomBytes, randomUUID } from 'node:crypto';
import {
  activateRequest,
  appliedDecision,
  type Binding,
  binding,
  localSetupManifest,
  machineReceipt,
  type machineReport,
  manifest,
  origin,
  pairingFile,
  rotateRequest,
  sameBinding,
} from '@thaarei/control-plane-contracts';
import {
  type VersionedSyncResponse,
  versionedSyncRequest,
  versionedSyncResponse,
} from '@thaarei/module-catalog';
import { z } from 'zod';
import { assertVerifiedModuleRelease, type VerifiedModuleRelease } from './module-release.js';
import {
  applyDecision,
  type DecisionState,
  evaluateDecision,
  initialDecisionState,
  type TrustBundle,
  verifyInstalledDecision,
} from './verifier.js';

const proof = z
  .object({
    token: z.string().max(8192),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    appliedAt: z.number().int().nonnegative(),
  })
  .strict();
const decisionState = z
  .object({
    epoch: z.uuid(),
    trustRevision: z.number().int().nonnegative(),
    lastTime: z.number().int().nonnegative(),
    quarantined: z.boolean(),
    accepted: proof.nullable(),
    activation: proof.nullable(),
    minimumVersion: z.literal(2).optional(),
    releaseTrustRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
const credential = z
  .object({
    secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    generation: z.number().int().positive(),
    epoch: z.uuid(),
    operationId: z.uuid(),
  })
  .strict();
export const storedProduct = z
  .object({
    version: z.literal(1),
    origin,
    binding,
    recoveryMarker: z.string().min(32).max(128),
    trustRevision: z.number().int().nonnegative(),
    current: credential.nullable(),
    operation: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('activate'), request: activateRequest }).strict(),
        z.object({ kind: z.literal('rotate'), request: rotateRequest }).strict(),
      ])
      .nullable(),
    decision: decisionState.nullable(),
    report: versionedSyncRequest.nullable(),
  })
  .strict();
export type StoredProduct = z.infer<typeof storedProduct>;
export interface ProductStore {
  // Shared by reporter and private operator commands; must fence every writer across processes.
  locked<T>(operation: () => Promise<T>): Promise<T>;
  load(): Promise<StoredProduct | null>;
  save(value: StoredProduct): Promise<void>;
  recoveryMarker(): Promise<string>;
  // Supplied by the owning installed adapter; no request-selected version switch.
  moduleRelease?(): Promise<VerifiedModuleRelease | null>;
}
export type Transport = ((
  path: 'activate' | 'sync' | 'rotate',
  input: unknown,
  secret?: string,
) => Promise<unknown>) & { origin?: string };
export class DeploymentTransportError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | null,
  ) {
    super(`Deployment request failed (${status})`);
  }
}
// Scheduling/election belongs to the product. Delays and transport attempts are bounded here.
export function nextSyncDelay(
  failures: number,
  retryAfterSeconds: number | null = null,
  random: () => number = Math.random,
) {
  const jitter = Math.max(0, Math.min(1, random()));
  if (failures <= 0) return Math.floor(900000 * (0.9 + 0.1 * jitter));
  const backoff = Math.min(900000, 5000 * 2 ** Math.min(8, Math.max(0, failures - 1)));
  return Math.ceil(
    Math.min(900000, Math.max(backoff * (0.5 + 0.5 * jitter), (retryAfterSeconds ?? 0) * 1000)),
  );
}
export function httpsTransport(rawOrigin: string, fetcher: typeof fetch = fetch): Transport {
  const target = manifest.shape.origin.parse(rawOrigin);
  const transport: Transport = async (path, input, secret) => {
    const response = await fetcher(`${target}/api/machine/v1/${path}`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!response.ok) {
      await response.body?.cancel();
      const value = Number(response.headers.get('retry-after'));
      throw new DeploymentTransportError(
        response.status,
        Number.isFinite(value) && value >= 0 ? Math.min(value, 900) : null,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty deployment response');
    let text = '';
    let size = 0;
    const decoder = new TextDecoder();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        throw new Error('Deployment response too large');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  };
  transport.origin = target;
  return transport;
}
export class DeploymentClient {
  constructor(
    readonly store: ProductStore,
    readonly transport: Transport,
    readonly trust: () => Promise<TrustBundle>,
    readonly now: () => number = () => Math.floor(Date.now() / 1000),
    readonly reportProvider?: (
      epoch: string | null,
    ) => Promise<z.infer<typeof machineReport> | null>,
  ) {}
  async setup(rawFile: unknown, rebind = false) {
    const file = pairingFile.parse(rawFile);
    if (this.transport.origin && this.transport.origin !== file.origin)
      throw new Error('Configured central origin does not match pairing');
    return this.store.locked(async () => {
      let value = await this.store.load();
      if (value) {
        if (
          rebind &&
          value.operation?.kind === 'activate' &&
          !value.decision &&
          value.origin === file.origin &&
          sameBinding(value.binding, file.binding) &&
          value.operation.request.pairingId === file.pairingId &&
          value.operation.request.code === file.code &&
          value.recoveryMarker === (await this.store.recoveryMarker())
        )
          return this.recover(value);
        if (!rebind) {
          if (
            value.recoveryMarker !== (await this.store.recoveryMarker()) ||
            value.decision?.quarantined
          )
            throw new Error('Reviewed restore rebind required');
          if (
            value.origin !== file.origin ||
            !value.operation ||
            value.operation.kind !== 'activate' ||
            JSON.stringify(value.operation.request.binding) !== JSON.stringify(file.binding) ||
            value.operation.request.pairingId !== file.pairingId ||
            value.operation.request.code !== file.code
          )
            throw new Error('Existing product requires reviewed rebind');
          return this.recover(value);
        }
        // Explicit operator-only rebind clears all activation evidence and changes epoch online.
        if (value.decision) value.decision.quarantined = true;
        await this.store.save(value);
      }
      const trustRevision = value?.trustRevision ?? 0;
      value = {
        version: 1,
        trustRevision,
        origin: file.origin,
        binding: file.binding,
        recoveryMarker: await this.store.recoveryMarker(),
        current: null,
        operation: {
          kind: 'activate',
          request: {
            version: 1,
            requestId: randomUUID(),
            binding: file.binding,
            pairingId: file.pairingId,
            code: file.code,
            candidateSecret: randomBytes(32).toString('base64url'),
          },
        },
        decision: null,
        report: null,
      };
      await this.store.save(value); // Request/binding/secret durable before any network operation.
      return this.recover(value);
    });
  }
  async sync() {
    return this.store.locked(async () => {
      const value = await this.required();
      return value.operation ? this.recover(value) : this.contact(value, value.current?.secret);
    });
  }
  async rotate() {
    return this.store.locked(async () => {
      const value = await this.required();
      if (value.operation) return this.recover(value);
      if (!value.current) throw new Error('Pair product first');
      value.operation = {
        kind: 'rotate',
        request: {
          version: 1,
          operationId: randomUUID(),
          binding: value.binding,
          epoch: value.current.epoch,
          expectedGeneration: value.current.generation,
          candidateSecret: randomBytes(32).toString('base64url'),
        },
      };
      value.report = null;
      await this.store.save(value);
      return this.recover(value);
    });
  }
  private async required() {
    const value = await this.store.load();
    if (!value) throw new Error('Pair product first');
    if (this.transport.origin && this.transport.origin !== value.origin)
      throw new Error('Configured central origin does not match paired product');
    if (value.recoveryMarker !== (await this.store.recoveryMarker())) {
      if (value.decision) value.decision.quarantined = true;
      await this.store.save(value);
      throw new Error('Restore quarantine requires reviewed rebind');
    }
    if (value.decision && this.now() < value.decision.lastTime) {
      value.decision.quarantined = true;
      await this.store.save(value);
      throw new Error('Backward clock requires reconciliation');
    }
    return value;
  }
  private async recover(value: StoredProduct) {
    const operation = value.operation;
    if (!operation) throw new Error('No operation to recover');
    // First try the durable candidate. This also recovers committed pairing after receipt expiry.
    try {
      return await this.contact(value, operation.request.candidateSecret, true);
    } catch {
      /* uncommitted or unavailable; replay the same operation, never regenerate */
    }
    if (operation.kind === 'activate')
      machineReceipt.parse(await this.transport('activate', operation.request));
    else {
      if (!value.current) throw new Error('Current rotation credential missing');
      machineReceipt.parse(await this.transport('rotate', operation.request, value.current.secret));
    }
    return this.contact(value, operation.request.candidateSecret, true);
  }
  private async contact(
    value: StoredProduct,
    secret: string | undefined,
    candidate = false,
  ): Promise<VersionedSyncResponse> {
    if (!secret) throw new Error('Machine secret missing');
    const trust = await this.trust();
    const release = (await this.store.moduleRelease?.()) ?? undefined;
    if (release) assertVerifiedModuleRelease(release);
    if (value.decision?.minimumVersion === 2 && !release)
      throw new Error('Verified v2 release missing; downgrade forbidden');
    if (trust.revision < value.trustRevision)
      throw new Error('Trust downgrade requires reconciliation');
    if (!value.report) {
      const claims = value.decision?.accepted
        ? await verifyInstalledDecision(
            value.decision.accepted.token,
            value.binding,
            value.decision.epoch,
            trust,
            this.now(),
            value.decision.minimumVersion === 2 ? release : undefined,
            true,
          )
        : null;
      let metrics: z.infer<typeof machineReport> | null | undefined;
      try {
        metrics = await this.reportProvider?.(value.current?.epoch ?? null);
      } catch {
        // Unavailable metrics must not prevent contact or application of a newer denial.
        // The previous sample stays stale; the durable journal below still fences HTTP retries.
        metrics = null;
      }
      value.report = {
        ...(release
          ? {
              version: 2 as const,
              installed: {
                catalogueDigest: release.request.profile.catalogueDigest,
                profileDigest: release.request.profileDigest,
                releaseId: release.releaseId,
              },
            }
          : { version: 1 as const }),
        ...(metrics
          ? {
              report: {
                ...metrics,
                localState: claims?.state ?? null,
                appliedPolicyRevision: claims?.policyRevision ?? null,
              },
            }
          : {}),
        reportId: randomUUID(),
        binding: value.binding,
        epoch: value.current?.epoch ?? null,
        applied: claims
          ? appliedDecision.parse({
              decisionId: claims.decisionId,
              policyRevision: claims.policyRevision,
              decisionSequence: claims.decisionSequence,
              appliedAt: value.decision?.accepted?.appliedAt,
            })
          : null,
      };
      await this.store.save(value);
    }
    if (release) {
      if (
        value.report.version !== 2 ||
        value.report.installed.releaseId !== release.releaseId ||
        value.report.installed.profileDigest !== release.request.profileDigest ||
        value.report.installed.catalogueDigest !== release.request.profile.catalogueDigest
      )
        throw new Error(
          'Pending sync journal differs from installed v2 release; reconcile before retry',
        );
    } else if (value.report.version !== 1) throw new Error('Cannot downgrade pending v2 sync');
    const response = versionedSyncResponse.parse(
      await this.transport('sync', value.report, secret),
    );
    if (response.version !== value.report.version) throw new Error('Sync version mismatch');
    if (
      !sameBinding(response.binding, value.binding) ||
      response.receiptId !== value.report.reportId
    )
      throw new Error('Sync response binding mismatch');
    const expectedOperation = value.operation?.request;
    if (candidate) {
      if (!expectedOperation) throw new Error('Missing candidate journal');
      const operationId =
        'operationId' in expectedOperation
          ? expectedOperation.operationId
          : expectedOperation.requestId;
      const generation = value.current ? value.current.generation + 1 : 1;
      // Replacement can have a larger central generation; epoch changes only this explicit setup flow.
      if (
        response.operationId !== operationId ||
        (value.operation?.kind === 'rotate' &&
          (response.generation !== generation || response.epoch !== value.current?.epoch))
      )
        throw new Error('Candidate confirmation mismatch');
    } else if (
      response.epoch !== value.current?.epoch ||
      response.generation !== value.current?.generation ||
      response.operationId !== value.current?.operationId
    )
      throw new Error('Credential confirmation mismatch');
    const state: DecisionState = value.decision ?? initialDecisionState(response.epoch);
    const updated = await applyDecision(
      state,
      response.decision,
      value.binding,
      trust,
      this.now(),
      release,
    );
    // Decision, current/candidate promotion and journal clearing are ONE durable commit.
    value.decision = updated;
    value.trustRevision = Math.max(value.trustRevision, trust.revision);
    value.current = {
      secret,
      generation: response.generation,
      epoch: response.epoch,
      operationId: response.operationId,
    };
    value.operation = null;
    value.report = null;
    await this.store.save(value);
    return response;
  }
  async access() {
    return this.store.locked(async () => {
      try {
        const value = await this.required();
        if (!value.decision) return { access: 'closed' as const, state: 'unapproved' };
        const trust = await this.trust();
        const now = this.now();
        if (trust.revision < value.trustRevision)
          throw new Error('Trust downgrade requires reconciliation');
        const release = (await this.store.moduleRelease?.()) ?? undefined;
        const result = await evaluateDecision(value.decision, value.binding, trust, now, release);
        if (result.state === 'reconciliation-required') value.decision.quarantined = true;
        value.decision.lastTime = Math.max(value.decision.lastTime, now);
        value.trustRevision = Math.max(value.trustRevision, trust.revision);
        value.decision.trustRevision = Math.max(value.decision.trustRevision, trust.revision);
        await this.store.save(value);
        return result;
      } catch {
        return { access: 'closed' as const, state: 'reconciliation-required' };
      }
    });
  }
}
export function setupManifest(origin: string, expected: Binding) {
  return manifest.parse({ version: 1, origin, binding: expected });
}

export function exportLocalManifest(ownedIdentity: unknown) {
  return localSetupManifest.parse(ownedIdentity);
}
