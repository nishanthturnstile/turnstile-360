import { createHash, randomUUID } from 'node:crypto';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { downloadName } from './download-name.js';
import { storageAuthenticationRequired } from './storage-auth.js';
import {
  type ObjectReference,
  objectKey,
  objectReferenceSchema,
  type StorageConfiguration,
  type StorageRole,
} from './storage-configuration.js';

export class StorageFailure extends Error {
  constructor(
    readonly code: 'unavailable' | 'precondition' | 'not-found' | 'denied',
    readonly cleanupCandidate?: ObjectReference,
  ) {
    super(`Storage operation ${code}`);
  }
}
export class S3Storage {
  private readonly client: S3Client;
  private readonly signer: S3Client;
  constructor(
    readonly config: StorageConfiguration,
    readonly role: StorageRole,
    credentials: { accessKeyId: string; secretAccessKey: string },
  ) {
    const options = {
      region: config.region,
      credentials,
      forcePathStyle: true,
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
      requestHandler: { requestTimeout: 30000, connectionTimeout: 3000 },
      followRegionRedirects: false,
    };
    this.client = new S3Client({ ...options, endpoint: config.endpoint });
    this.signer = new S3Client({ ...options, endpoint: config.publicOrigin });
  }
  close() {
    this.client.destroy();
    this.signer.destroy();
  }
  private require(roles: StorageRole[]) {
    if (!roles.includes(this.role)) throw new StorageFailure('denied');
  }
  private async send<T>(operation: () => Promise<T>): Promise<T> {
    try {
      if (!(await storageAuthenticationRequired(new URL(this.config.endpoint))))
        throw new StorageFailure('unavailable');
      return await operation();
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      throw new StorageFailure(
        status === 412
          ? 'precondition'
          : status === 404
            ? 'not-found'
            : status === 403
              ? 'denied'
              : 'unavailable',
      );
    }
  }
  async upload(
    reference: ObjectReference,
    size: number,
    contentType: string,
    expiresIn = 900,
    notAfter?: Date,
    internal = false,
  ) {
    this.require(['upload', 'artifactWrite']);
    if (reference.area !== (this.role === 'upload' ? 'staging' : 'artifacts'))
      throw new StorageFailure('denied');
    objectReferenceSchema.parse(reference);
    z.number()
      .int()
      .min(1)
      .max(50 * 1024 * 1024)
      .parse(size);
    z.string()
      .max(100)
      .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/)
      .parse(contentType);
    z.number().int().min(1).max(900).parse(expiresIn);
    return this.send(async () => {
      const signingDate = new Date();
      const lifetime = notAfter
        ? Math.min(expiresIn, Math.floor((notAfter.getTime() - signingDate.getTime()) / 1000))
        : expiresIn;
      if (lifetime < 1) throw new StorageFailure('precondition');
      return {
        url: await getSignedUrl(
          internal ? this.client : this.signer,
          new PutObjectCommand({
            Bucket: this.config.buckets[reference.area],
            Key: objectKey(reference),
            ContentLength: size,
            ContentType: contentType,
            IfNoneMatch: '*',
          }),
          {
            expiresIn: lifetime,
            signingDate,
            signableHeaders: new Set(['content-length', 'content-type', 'if-none-match']),
          },
        ),
        method: 'PUT' as const,
        headers: { 'content-type': contentType, 'if-none-match': '*' },
        size,
        expiresAt: new Date(signingDate.getTime() + lifetime * 1000).toISOString(),
      };
    });
  }
  async download(reference: ObjectReference, expiresIn = 120) {
    this.require(['originalRead', 'artifactRead']);
    if (reference.area !== (this.role === 'originalRead' ? 'originals' : 'artifacts'))
      throw new StorageFailure('denied');
    z.number().int().min(1).max(120).parse(expiresIn);
    return this.send(async () => ({
      url: await getSignedUrl(
        this.signer,
        new GetObjectCommand({
          Bucket: this.config.buckets[reference.area],
          Key: objectKey(reference),
        }),
        { expiresIn },
      ),
      method: 'GET' as const,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    }));
  }
  async downloadOriginal(reference: ObjectReference, fileName: string, expiresIn = 120) {
    this.require(['originalRead', 'artifactRead']);
    if (reference.area !== (this.role === 'originalRead' ? 'originals' : 'artifacts'))
      throw new StorageFailure('denied');
    objectReferenceSchema.parse(reference);
    z.number().int().min(1).max(120).parse(expiresIn);
    const safe = downloadName(fileName);
    return this.send(async () => {
      const signingDate = new Date();
      return {
        url: await getSignedUrl(
          this.signer,
          new GetObjectCommand({
            Bucket: this.config.buckets.originals,
            Key: objectKey(reference),
            ResponseContentDisposition: safe.disposition,
            ResponseContentType: 'application/octet-stream',
          }),
          { expiresIn, signingDate },
        ),
        method: 'GET' as const,
        fileName: safe.fileName,
        contentType: 'application/octet-stream' as const,
        expiresAt: new Date(signingDate.getTime() + expiresIn * 1000).toISOString(),
      };
    });
  }
  async downloadInternal(reference: ObjectReference) {
    this.require(['originalRead']);
    if (reference.area !== 'originals') throw new StorageFailure('denied');
    return this.send(async () => ({
      url: await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.config.buckets.originals, Key: objectKey(reference) }),
        { expiresIn: 120 },
      ),
    }));
  }
  async probe(tenantId: string) {
    try {
      await this.head({
        area: this.role === 'artifactRead' ? 'artifacts' : 'originals',
        tenantId,
        applicationId: tenantId,
        id: '00000000-0000-4000-8000-000000000000',
      });
      return true;
    } catch (error) {
      return error instanceof StorageFailure && error.code === 'not-found';
    }
  }
  async head(reference: ObjectReference) {
    this.require(['snapshot', 'originalRead', 'artifactRead']);
    if (
      this.role === 'snapshot'
        ? !['staging', 'originals'].includes(reference.area)
        : reference.area !== (this.role === 'originalRead' ? 'originals' : 'artifacts')
    )
      throw new StorageFailure('denied');
    const result = await this.send(() =>
      this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.buckets[reference.area],
          Key: objectKey(reference),
        }),
      ),
    );
    if (!result.ETag || !Number.isSafeInteger(result.ContentLength))
      throw new StorageFailure('unavailable');
    return {
      etag: result.ETag,
      size: result.ContentLength as number,
      contentType: result.ContentType,
    };
  }
  async verifyOriginal(
    reference: ObjectReference,
    expected: { size: number; etag: string; sha256: string },
    captureJson = false,
  ) {
    this.require(['originalRead', 'artifactRead']);
    if (reference.area !== (this.role === 'originalRead' ? 'originals' : 'artifacts'))
      throw new StorageFailure('denied');
    objectReferenceSchema.parse(reference);
    z.number().int().positive().max(52428800).parse(expected.size);
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(expected.sha256);
    const result = await this.send(() =>
      this.client.send(
        new GetObjectCommand({
          Bucket: this.config.buckets[reference.area],
          Key: objectKey(reference),
          IfMatch: expected.etag,
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      ),
    );
    const body = result.Body;
    if (!body || !(Symbol.asyncIterator in body)) throw new StorageFailure('unavailable');
    if (captureJson && (this.role !== 'artifactRead' || expected.size > 26214400))
      throw new StorageFailure('denied');
    const chunks: Uint8Array[] = [];
    const digest = createHash('sha256');
    let bytes = 0;
    try {
      if (result.ETag !== expected.etag || result.ContentLength !== expected.size)
        throw new StorageFailure('precondition');
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        bytes += chunk.byteLength;
        if (bytes > expected.size) throw new StorageFailure('precondition');
        digest.update(chunk);
        if (captureJson) chunks.push(chunk);
      }
      if (bytes !== expected.size || digest.digest('hex') !== expected.sha256)
        throw new StorageFailure('precondition');
      if (captureJson) return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      return undefined;
    } catch (error) {
      if (error instanceof StorageFailure) throw error;
      throw new StorageFailure('unavailable');
    } finally {
      (body as { destroy?: () => void }).destroy?.();
    }
  }
  // Only owning server code may reserve a destination UUID before I/O; no external key API.
  async snapshot(source: ObjectReference, sourceEtag: string, reservedId?: string) {
    this.require(['snapshot']);
    if (source.area !== 'staging') throw new StorageFailure('denied');
    z.string()
      .regex(/^"[\x21\x23-\x5b\x5d-\x7e]{1,128}"$/)
      .parse(sourceEtag);
    const target: ObjectReference = {
      ...source,
      area: 'originals',
      id: reservedId ? z.uuid().parse(reservedId) : randomUUID(),
    };
    const copy = new CopyObjectCommand({
      Bucket: this.config.buckets.originals,
      Key: objectKey(target),
      CopySource: `${this.config.buckets.staging}/${objectKey(source)}`,
      CopySourceIfMatch: sourceEtag,
      MetadataDirective: 'COPY',
    });
    // Guard the destination too; a collision must never overwrite an existing candidate.
    copy.middlewareStack.add(
      (next) => async (args) => {
        (args.request as { headers: Record<string, string> }).headers['if-none-match'] = '*';
        return next(args);
      },
      { step: 'build', name: 'createOnlySnapshot' },
    );
    try {
      await this.send(() => this.client.send(copy));
      return { reference: target, ...(await this.head(target)) };
    } catch (error) {
      // An ambiguous network/HEAD failure may follow a committed copy. Keep its exact key
      // available to the owning use case's future cleanup/reconciliation intent.
      if (error instanceof StorageFailure) throw new StorageFailure(error.code, target);
      throw error;
    }
  }
  async requireUnversioned(area: ObjectReference['area']) {
    this.require(['cleanup']);
    const result = await this.send(() =>
      this.client.send(new GetBucketVersioningCommand({ Bucket: this.config.buckets[area] })),
    );
    if (result.Status) throw new StorageFailure('precondition');
  }
  async deleteExact(reference: ObjectReference) {
    this.require(['cleanup']);
    await this.send(() =>
      this.client.send(
        new DeleteObjectCommand({
          Bucket: this.config.buckets[reference.area],
          Key: objectKey(reference),
        }),
      ),
    );
  }
}
