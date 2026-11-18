import { createReadStream, createWriteStream } from 'node:fs';
import { request } from 'node:http';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Private Docker-operator tool only. Never imported by an HTTP server or worker.
export class DockerEngine {
  constructor(private readonly socketPath = '/var/run/docker.sock') {}
  async stream(method: string, path: string, value?: unknown | Readable): Promise<Readable> {
    return new Promise((resolve, reject) => {
      const body =
        value && typeof (value as Readable).pipe !== 'function' ? JSON.stringify(value) : undefined;
      const req = request(
        {
          socketPath: this.socketPath,
          path: `/v1.52${path}`,
          method,
          headers: body
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
            : {},
        },
        (response) => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300)
            resolve(response);
          else {
            response.resume();
            reject(new Error(`Docker operation unavailable (${response.statusCode})`));
          }
        },
      );
      req.setTimeout(4 * 3600000, () =>
        req.destroy(new Error('Private Docker operation deadline')),
      );
      req.on('error', () => reject(new Error('Docker transport unavailable')));
      if (value && typeof (value as Readable).pipe === 'function') {
        (value as Readable)
          .on('error', () => req.destroy(new Error('Private input stream failed')))
          .pipe(req);
      } else req.end(body);
    });
  }
  async json<T = Record<string, unknown>>(
    method: string,
    path: string,
    value?: unknown,
  ): Promise<T> {
    const response = await this.stream(method, path, value);
    let body = '';
    for await (const block of response) {
      body += block;
      if (Buffer.byteLength(body) > 16 * 1024 * 1024) throw new Error('Docker response bound');
    }
    return (body ? JSON.parse(body) : {}) as T;
  }
  async inspect(id: string) {
    return this.json<Container>('GET', `/containers/${encodeURIComponent(id)}/json`);
  }
  async exec(id: string, command: string[], user?: string, environment: string[] = []) {
    const { Id } = await this.json<{ Id: string }>('POST', `/containers/${id}/exec`, {
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true,
      Env: environment,
      ...(user ? { User: user } : {}),
    });
    const raw = await this.stream('POST', `/exec/${Id}/start`, { Detach: false, Tty: false });
    const chunks: Buffer[] = [];
    let size = 0;
    const demux = new DockerOutput();
    demux.on('data', (b) => {
      size += b.length;
      if (size > 16 * 1024 * 1024) demux.destroy(new Error('Private tool output bound'));
      else chunks.push(b);
    });
    await pipeline(raw, demux);
    const result = await this.json<{ ExitCode: number }>('GET', `/exec/${Id}/json`);
    if (result.ExitCode !== 0) throw new Error('Private container command failed');
    return Buffer.concat(chunks).toString('utf8').trim();
  }
  async archive(id: string, path: string, file: string) {
    await pipeline(
      await this.stream('GET', `/containers/${id}/archive?path=${encodeURIComponent(path)}`),
      createWriteStream(file, { flags: 'wx', mode: 0o600 }),
    );
  }
  async extract(id: string, path: string, file: string) {
    await this.stream(
      'PUT',
      `/containers/${id}/archive?path=${encodeURIComponent(path)}`,
      createReadStream(file),
    ).then((r) => r.resume());
  }
  async stop(id: string, seconds = 90) {
    try {
      (await this.stream('POST', `/containers/${id}/stop?t=${seconds}`)).resume();
    } catch {
      const current = await this.inspect(id);
      if (current.State.Running) throw new Error('Source did not stop');
    }
  }
  async start(id: string) {
    try {
      (await this.stream('POST', `/containers/${id}/start`)).resume();
    } catch {
      if (!(await this.inspect(id)).State.Running) throw new Error('Container did not start');
    }
  }
  async remove(id: string) {
    (await this.stream('DELETE', `/containers/${id}?force=true&v=true`)).resume();
  }
  async job(
    image: string,
    mounts: Mount[],
    user: string,
    network = 'none',
    environment: string[] = [],
    capabilities: string[] = [],
  ) {
    const result = await this.json<{ Id: string }>('POST', '/containers/create', {
      Image: image,
      User: user,
      Entrypoint: ['node'],
      Cmd: ['-e', 'setInterval(()=>{},10000)'],
      Env: environment,
      Labels: { 'thaarei.dms.private-tool': 'recovery' },
      HostConfig: {
        NetworkMode: network,
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        CapAdd: capabilities,
        SecurityOpt: ['no-new-privileges'],
        Memory: 2147483648,
        NanoCpus: 1000000000,
        PidsLimit: 64,
        Tmpfs: { '/tmp': 'size=128m,noexec,nosuid,nodev' },
        Mounts: mounts,
      },
    });
    try {
      await this.start(result.Id);
      return result.Id;
    } catch (error) {
      await this.remove(result.Id).catch(() => {});
      throw error;
    }
  }
  async network(name: string, internal = false) {
    await this.json('POST', '/networks/create', {
      Name: name,
      Internal: internal,
      Labels: { 'com.docker.compose.project': name.slice(0, name.lastIndexOf('_')) },
    });
  }
  async connect(network: string, id: string) {
    await this.json('POST', `/networks/${encodeURIComponent(network)}/connect`, { Container: id });
  }
}
export interface Mount {
  Type: 'volume' | 'bind';
  Source: string;
  Target: string;
  ReadOnly?: boolean;
}
export interface Container {
  Id: string;
  Image: string;
  Name: string;
  Config: { Image: string; Env: string[]; Labels: Record<string, string> };
  Mounts: { Type: string; Name?: string; Source: string; Destination: string }[];
  State: { Running: boolean };
}
class DockerOutput extends Transform {
  private pending = Buffer.alloc(0);
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    done: (error?: Error | null) => void,
  ) {
    this.pending = Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= 8) {
      const length = this.pending.readUInt32BE(4);
      if (length > 16 * 1024 * 1024) {
        done(new Error('Docker frame bound'));
        return;
      }
      if (this.pending.length < length + 8) break;
      this.push(this.pending.subarray(8, 8 + length));
      this.pending = this.pending.subarray(8 + length);
    }
    done();
  }
  override _flush(done: (error?: Error | null) => void) {
    done(this.pending.length ? new Error('Incomplete Docker frame') : undefined);
  }
}
