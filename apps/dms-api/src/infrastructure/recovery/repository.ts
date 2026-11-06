import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, readFile, rm, stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { z } from 'zod';
export const repositorySchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    endpoint: z.url(),
    bucket: z.string().regex(/^[a-z][a-z0-9.-]{2,62}$/),
    prefix: z.string().regex(/^[A-Za-z0-9/_-]{1,128}$/),
    region: z.string().min(1).max(64),
    accessKeyId: z.string().min(16).max(128),
    secretAccessKey: z.string().min(32).max(256),
    keyFile: z.string().min(1),
    offHostAttested: z.boolean(),
    fixtureOnly: z.boolean().default(false),
  })
  .strict();
export async function fileHash(file: string) {
  const hash = createHash('sha256');
  for await (const block of createReadStream(file)) hash.update(block);
  return hash.digest('hex');
}
export class BackupRepository {
  readonly client: S3Client;
  readonly key: Buffer;
  private constructor(
    readonly config: z.infer<typeof repositorySchema>,
    key: Buffer,
  ) {
    this.key = key;
    const url = new URL(config.endpoint);
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      (!config.fixtureOnly &&
        (url.protocol !== 'https:' ||
          ['localhost', '127.0.0.1', '[::1]', 'storage'].includes(url.hostname) ||
          !config.offHostAttested))
    )
      throw new Error('An independently operated TLS backup repository is required');
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('Unsupported backup transport');
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: { connectionTimeout: 5000, requestTimeout: 120000 },
    });
  }
  static async create(raw: unknown) {
    const config = repositorySchema.parse(raw);
    const info = await stat(config.keyFile);
    if ((info.mode & 0o077) !== 0 || !info.isFile())
      throw new Error('Private independent encryption-key file required');
    const key = await readFile(config.keyFile);
    if (key.length !== 32) throw new Error('Use a 32-byte encryption key');
    return new BackupRepository(config, key);
  }
  objectKey(id: string, name: string) {
    if (
      !z.uuid().safeParse(id).success ||
      ![
        'postgres',
        'storage',
        'configuration',
        'signatures',
        'objects',
        'images',
        'manifest',
      ].includes(name)
    )
      throw new Error('Fixed backup object identity required');
    return `${this.config.prefix.replace(/\/$/, '')}/${id}/${name}.gcm`;
  }
  async encrypt(file: string, target: string, id: string, name: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`DMS-BACKUP-1:${id}:${name}`));
    const header = Buffer.concat([Buffer.from('DMSBKP1\n'), iv]);
    const output = await open(target, 'wx', 0o600);
    await output.write(header);
    await output.close();
    await pipeline(createReadStream(file), cipher, createWriteStream(target, { flags: 'a' }));
    const suffix = await open(target, 'a');
    try {
      await suffix.write(cipher.getAuthTag());
      await suffix.sync();
    } finally {
      await suffix.close();
    }
  }
  async decrypt(file: string, target: string, id: string, name: string) {
    const fd = await open(file, 'r');
    const size = (await fd.stat()).size;
    const header = Buffer.alloc(20),
      tag = Buffer.alloc(16);
    try {
      await fd.read(header, 0, 20, 0);
      await fd.read(tag, 0, 16, size - 16);
    } finally {
      await fd.close();
    }
    if (size < 36 || header.subarray(0, 8).toString() !== 'DMSBKP1\n')
      throw new Error('Invalid encrypted backup');
    const decipher = createDecipheriv('aes-256-gcm', this.key, header.subarray(8));
    decipher.setAAD(Buffer.from(`DMS-BACKUP-1:${id}:${name}`));
    decipher.setAuthTag(tag);
    try {
      await pipeline(
        createReadStream(file, { start: 20, end: size - 17 }),
        decipher,
        createWriteStream(target, { flags: 'wx', mode: 0o600 }),
      );
    } catch {
      await rm(target, { force: true });
      throw new Error('Backup authentication failed');
    }
  }
  async download(id: string, name: string, target: string) {
    const body = (
      await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: this.objectKey(id, name) }),
      )
    ).Body;
    if (!body) throw new Error('Missing backup object');
    await pipeline(body as Readable, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
  }
  async verifyRemote(id: string, name: string, expected: string) {
    const body = (
      await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: this.objectKey(id, name) }),
      )
    ).Body;
    if (!body) throw new Error('Backup object unavailable');
    const hash = createHash('sha256');
    for await (const chunk of body as Readable) hash.update(chunk);
    if (hash.digest('hex') !== expected) throw new Error('Remote backup verification failed');
  }
  async upload(id: string, name: string, file: string) {
    const expected = await fileHash(file),
      size = (await stat(file)).size,
      Key = this.objectKey(id, name),
      Bucket = this.config.bucket;
    if (size <= 16 * 1024 * 1024) {
      try {
        await this.client.send(
          new PutObjectCommand({
            Bucket,
            Key,
            Body: createReadStream(file),
            ContentLength: size,
            IfNoneMatch: '*',
          }),
        );
      } catch {
        await this.verifyRemote(id, name, expected);
      }
    } else {
      const created = await this.client.send(new CreateMultipartUploadCommand({ Bucket, Key }));
      if (!created.UploadId) throw new Error('Backup upload unavailable');
      const UploadId = created.UploadId,
        Parts: { PartNumber: number; ETag: string }[] = [];
      if (size > 5 * 1024 ** 4) throw new Error('Backup component exceeds repository limit');
      const partBytes = Math.max(16 * 1024 ** 2, Math.ceil(size / 9999 / 1024 ** 2) * 1024 ** 2);
      try {
        for (let offset = 0, n = 1; offset < size; offset += partBytes, n++) {
          const length = Math.min(partBytes, size - offset);
          const part = await this.client.send(
            new UploadPartCommand({
              Bucket,
              Key,
              UploadId,
              PartNumber: n,
              ContentLength: length,
              Body: createReadStream(file, { start: offset, end: offset + length - 1 }),
            }),
          );
          if (!part.ETag) throw new Error('Unconfirmed backup part');
          Parts.push({ PartNumber: n, ETag: part.ETag });
        }
        try {
          await this.client.send(
            new CompleteMultipartUploadCommand({
              Bucket,
              Key,
              UploadId,
              MultipartUpload: { Parts },
              IfNoneMatch: '*',
            }),
          );
        } catch {
          await this.verifyRemote(id, name, expected);
          await this.client
            .send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }))
            .catch(() => {});
        }
      } catch (error) {
        await this.client
          .send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }))
          .catch(() => {});
        throw error;
      }
    }
    await this.verifyRemote(id, name, expected);
  }
  async manifests() {
    const ids: string[] = [];
    let token: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: `${this.config.prefix.replace(/\/$/, '')}/`,
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      for (const item of response.Contents ?? []) {
        const match = item.Key?.match(/\/([a-f0-9-]{36})\/manifest\.gcm$/);
        if (match && z.uuid().safeParse(match[1]).success) ids.push(z.uuid().parse(match[1]));
      }
      if (ids.length > 10000) throw new Error('Backup catalog review required');
      token = response.NextContinuationToken;
    } while (token);
    return ids;
  }
  close() {
    this.key.fill(0);
    this.client.destroy();
  }
}
