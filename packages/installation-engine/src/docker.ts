import { createReadStream } from 'node:fs';
import { request } from 'node:http';
import type { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { Unavailable } from './unavailable.js';

export interface Mount {
  Type: 'bind' | 'volume';
  Source: string;
  Target: string;
  ReadOnly?: boolean;
}
export type Container = {
  Id: string;
  Image: string;
  Config: { Env: string[]; Labels: Record<string, string>; Cmd: string[] };
  State: { Running: boolean; ExitCode: number };
  NetworkSettings: { Networks: Record<string, unknown> };
};
/** Operator-only local socket adapter. Application images never receive this authority. */
export class Docker {
  constructor(private readonly socketPath = '/var/run/docker.sock') {}
  async preflight() {
    const v = await this.json<{
      ApiVersion: string;
      MinAPIVersion: string;
      Os: string;
      Arch: string;
    }>('GET', '/version');
    if (
      v?.Os !== 'linux' ||
      v.Arch !== 'amd64' ||
      Number(v.ApiVersion.split('.')[1]) < 52 ||
      Number(v.MinAPIVersion.split('.')[1]) > 52
    )
      throw new Error('This artifact requires Linux/amd64 Docker API 1.52 compatibility');
    const info = await this.json<{ MemTotal: number; NCPU: number; SystemTime: string }>(
      'GET',
      '/info',
    );
    if (
      !info ||
      info.MemTotal < 4 * 1024 ** 3 ||
      info.NCPU < 2 ||
      Math.abs(Date.now() - new Date(info.SystemTime).getTime()) > 300000
    )
      throw new Error('Private Docker resources or clock require reconciliation');
  }
  async request(
    method: string,
    path: string,
    value?: unknown | Readable,
    allowMissing = false,
  ): Promise<Readable | null> {
    return new Promise((resolve, reject) => {
      const stream =
        value && typeof (value as Readable).pipe === 'function' ? (value as Readable) : null;
      const data = value && !stream ? JSON.stringify(value) : undefined;
      const req = request(
        {
          socketPath: this.socketPath,
          path: `/v1.52${path}`,
          method,
          headers: data
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
            : {},
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(res);
          else {
            res.resume();
            if (allowMissing && res.statusCode === 404) resolve(null);
            else
              reject(
                new (res.statusCode && (res.statusCode >= 500 || res.statusCode === 429)
                  ? Unavailable
                  : Error)(`Private Docker operation unavailable (${res.statusCode})`),
              );
          }
        },
      );
      req.setTimeout(180000, () => req.destroy(new Unavailable('Private Docker deadline')));
      req.on('error', () => reject(new Unavailable('Private Docker transport unavailable')));
      if (stream)
        stream
          .on('error', () => req.destroy(new Error('Private artifact stream failed')))
          .pipe(req);
      else req.end(data);
    });
  }
  async json<T = Record<string, unknown>>(
    method: string,
    path: string,
    value?: unknown,
    allowMissing = false,
  ): Promise<T | null> {
    const r = await this.request(method, path, value, allowMissing);
    if (!r) return null;
    let raw = '';
    for await (const c of r) {
      raw += c;
      if (Buffer.byteLength(raw) > 16 * 1024 ** 2) throw new Error('Private Docker response bound');
    }
    return (raw ? JSON.parse(raw) : {}) as T;
  }
  inspect(name: string) {
    return this.json<Container>(
      'GET',
      `/containers/${encodeURIComponent(name)}/json`,
      undefined,
      true,
    );
  }
  async image(id: string) {
    const i = await this.json<{ Id: string; Os: string; Architecture: string }>(
      'GET',
      `/images/${encodeURIComponent(id)}/json`,
      undefined,
      true,
    );
    return i;
  }
  async load(path: string) {
    const r = await this.request('POST', '/images/load?quiet=true', createReadStream(path));
    if (!r) throw new Error('Artifact load unavailable');
    let raw = '';
    for await (const c of r) {
      raw += c;
      if (raw.length > 16 * 1024 ** 2) throw new Error('Image load response bound');
    }
    for (const l of raw.trim().split('\n'))
      if (l && JSON.parse(l).error) throw new Error('Artifact image load failed');
  }
  async create(name: string, config: Record<string, unknown>) {
    const r = await this.json<{ Id: string }>(
      'POST',
      `/containers/create?name=${encodeURIComponent(name)}`,
      config,
    );
    if (!r) throw new Error('Container create unavailable');
    return r.Id;
  }
  async start(id: string) {
    const existing = await this.inspect(id);
    if (!existing) throw new Error('Owned container missing');
    if (!existing.State.Running) (await this.request('POST', `/containers/${id}/start`))?.resume();
  }
  async wait(id: string, seconds = 180) {
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      const c = await this.inspect(id);
      if (!c) throw new Error('Unknown private command outcome');
      if (!c.State.Running) return c.State.ExitCode;
      await delay(200);
    }
    throw new Unavailable('Private command remains active; resume the retained operation');
  }
  async logs(id: string) {
    const r = await this.request('GET', `/containers/${id}/logs?stdout=true&stderr=true`);
    if (!r) throw new Error('Private command logs unavailable');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of r) {
      size += c.length;
      if (size > 16 * 1024 ** 2) throw new Error('Private command output bound');
      chunks.push(c);
    }
    const raw = Buffer.concat(chunks);
    let offset = 0;
    const output: Buffer[] = [];
    while (offset < raw.length) {
      if (raw.length - offset < 8) throw new Error('Incomplete Docker frame');
      const n = raw.readUInt32BE(offset + 4);
      if (n > 16 * 1024 ** 2 || offset + n + 8 > raw.length)
        throw new Error('Invalid Docker frame');
      output.push(raw.subarray(offset + 8, offset + 8 + n));
      offset += 8 + n;
    }
    return Buffer.concat(output).toString('utf8');
  }
  async exec(id: string, command: string[]) {
    const task = await this.json<{ Id: string }>('POST', `/containers/${id}/exec`, {
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true,
    });
    if (!task) throw new Error('Private inspect unavailable');
    const raw = await this.request('POST', `/exec/${task.Id}/start`, { Detach: false, Tty: false });
    if (raw)
      for await (const _ of raw) {
        /* Readiness output is deliberately discarded. */
      }
    const result = await this.json<{ ExitCode: number }>('GET', `/exec/${task.Id}/json`);
    if (result?.ExitCode !== 0) throw new Error('Owned service is not ready');
  }
  async remove(id: string) {
    (await this.request('DELETE', `/containers/${id}`, undefined, true))?.resume();
  }
  async network(name: string, installationId: string, custody: string, subnet?: string) {
    const n = await this.json<{
      Labels: Record<string, string>;
      IPAM: { Config: { Subnet: string }[] };
    }>('GET', `/networks/${encodeURIComponent(name)}`, undefined, true);
    if (n) {
      if (
        n.Labels['thaarei.installation'] !== installationId ||
        n.Labels['thaarei.installer.state'] !== custody ||
        (subnet && !n.IPAM.Config.some((v) => v.Subnet === subnet))
      )
        throw new Error('Existing network belongs to another owner');
      return;
    }
    await this.json('POST', '/networks/create', {
      Name: name,
      Internal: true,
      ...(subnet ? { IPAM: { Config: [{ Subnet: subnet }] } } : {}),
      Labels: { 'thaarei.installation': installationId, 'thaarei.installer.state': custody },
    });
  }
  async volume(name: string, installationId: string, custody: string) {
    const v = await this.json<{ Labels: Record<string, string> }>(
      'GET',
      `/volumes/${encodeURIComponent(name)}`,
      undefined,
      true,
    );
    if (v) {
      if (
        v.Labels['thaarei.installation'] !== installationId ||
        v.Labels['thaarei.installer.state'] !== custody
      )
        throw new Error('Existing volume belongs to another owner');
      return;
    }
    await this.json('POST', '/volumes/create', {
      Name: name,
      Labels: { 'thaarei.installation': installationId, 'thaarei.installer.state': custody },
    });
  }
  async connect(network: string, id: string, aliases: string[] = []) {
    const c = await this.inspect(id);
    if (!c) throw new Error('Owned container missing');
    if (!Object.hasOwn(c.NetworkSettings.Networks, network))
      await this.json('POST', `/networks/${encodeURIComponent(network)}/connect`, {
        Container: id,
        EndpointConfig: { Aliases: aliases },
      });
  }
}
