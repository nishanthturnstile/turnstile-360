import {
  type CapabilitiesResponse,
  capabilitiesResponseSchema,
  type DmsErrorCode,
  dmsErrorSchema,
  type EnrollmentRequest,
  type EnrollmentResponse,
  enrollmentRequestSchema,
  enrollmentResponseSchema,
} from '@thaarei/dms-contracts';
import { DmsClientError, fixedUrl, jsonRequest, timeout } from './http.js';
import type { MachineTokenProvider } from './tokens.js';

export interface DmsActorContext {
  userId: string;
  requestId: string;
}

export class DmsClient {
  private readonly baseUrl: string;
  private readonly provider: MachineTokenProvider;
  private readonly transport: typeof fetch;
  private readonly timeoutMs: number;
  constructor(options: {
    baseUrl: string;
    tokenProvider: MachineTokenProvider;
    allowInsecureHttp?: boolean;
    transport?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.baseUrl = fixedUrl(options.baseUrl, options.allowInsecureHttp ?? false);
    if (new URL(this.baseUrl).pathname !== '/v1')
      throw new DmsClientError('DMS_CONFIGURATION_INVALID');
    this.provider = options.tokenProvider;
    this.transport = options.transport ?? fetch;
    this.timeoutMs = timeout(options.timeoutMs);
  }

  async capabilities(actor?: DmsActorContext): Promise<CapabilitiesResponse> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (actor) {
      if (
        !/^[A-Za-z0-9_-]{1,200}$/.test(actor.userId) ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(actor.requestId)
      )
        throw new DmsClientError('DMS_REQUEST_INVALID');
      headers['x-thaarei-actor-id'] = actor.userId;
      headers['x-thaarei-request-id'] = actor.requestId;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.machineToken();
      const result = await jsonRequest(
        `${this.baseUrl}/capabilities`,
        {
          method: 'GET',
          headers: { ...headers, authorization: `Bearer ${token.accessToken}` },
        },
        this.transport,
        this.timeoutMs,
      );
      const error = dmsErrorSchema.safeParse(result.body);
      if (
        attempt === 0 &&
        result.status === 401 &&
        error.success &&
        error.data.code === 'MACHINE_TOKEN_EXPIRED'
      ) {
        try {
          this.provider.invalidate(token);
        } catch {
          throw new DmsClientError('DMS_UNAVAILABLE');
        }
        continue;
      }
      this.assertSuccess(result.status, error.success ? error.data.code : undefined);
      const parsed = capabilitiesResponseSchema.safeParse(result.body);
      if (!parsed.success) throw new DmsClientError('DMS_INVALID_RESPONSE');
      return parsed.data;
    }
    throw new DmsClientError('DMS_MACHINE_AUTH_FAILED', 401);
  }

  // Enrollment is an explicit provisioning action. Never automatically retry mutations.
  async enroll(input: {
    request: EnrollmentRequest;
    enrollmentKey: string;
    idempotencyKey: string;
  }): Promise<EnrollmentResponse> {
    const parsed = enrollmentRequestSchema.safeParse(input.request);
    if (
      !parsed.success ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(input.idempotencyKey) ||
      !/^the_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(input.enrollmentKey)
    )
      throw new DmsClientError('DMS_REQUEST_INVALID');
    const token = await this.machineToken();
    const result = await jsonRequest(
      `${this.baseUrl}/application-enrollments`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${token.accessToken}`,
          'x-thaarei-enrollment-key': input.enrollmentKey,
          'idempotency-key': input.idempotencyKey,
        },
        body: JSON.stringify(parsed.data),
      },
      this.transport,
      this.timeoutMs,
    );
    if (result.status !== 200 && result.status !== 201) {
      const problem = dmsErrorSchema.safeParse(result.body);
      throw new DmsClientError(
        'DMS_ENROLLMENT_FAILED',
        result.status,
        problem.success ? problem.data.code : undefined,
      );
    }
    const saved = enrollmentResponseSchema.safeParse(result.body);
    if (!saved.success) throw new DmsClientError('DMS_INVALID_RESPONSE');
    return saved.data;
  }

  private async machineToken() {
    try {
      return await this.provider.getToken();
    } catch (error) {
      if (error instanceof DmsClientError) throw error;
      throw new DmsClientError('DMS_UNAVAILABLE');
    }
  }

  private assertSuccess(status: number, domainCode?: DmsErrorCode) {
    if (status === 200) return;
    if (status === 401) throw new DmsClientError('DMS_MACHINE_AUTH_FAILED', status, domainCode);
    if (status === 403) throw new DmsClientError('DMS_ACCESS_DENIED', status, domainCode);
    throw new DmsClientError('DMS_UNAVAILABLE', status, domainCode);
  }
}
