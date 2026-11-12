import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { StageJournal } from './contracts.js';
import type { Docker, Mount } from './docker.js';
import { atomic, hash, privateText, writeJson } from './files.js';
import { Unavailable } from './unavailable.js';

type Configuration = {
  Image: string;
  User: string;
  Entrypoint: string[];
  Cmd: string[];
  Env: string[];
  Labels: Record<string, string>;
  HostConfig: Record<string, unknown>;
};
export class PrivateJobs {
  constructor(
    private readonly c: {
      docker: Docker;
      root: string;
      state: string;
      network: string;
      ingress: string;
      uid: number;
      gid: number;
      local: string;
      image: (role: string) => string;
      journal: StageJournal;
      save: () => void;
      current: () => Promise<void>;
    },
  ) {}
  async resume(rebindProduct?: string) {
    for (const [stage, op] of Object.entries(this.c.journal.jobs)) {
      if (op.phase === 'superseded') continue;
      if (op.phase === 'complete' && op.exitCode !== 0) {
        if (
          rebindProduct &&
          (stage.startsWith(`pair-${rebindProduct}-`) || stage.startsWith(`sync-${rebindProduct}-`))
        ) {
          op.phase = 'superseded';
          this.c.save();
          rmSync(join(this.c.state, `${stage}.resolved.json`), { force: true });
          rmSync(join(this.c.state, `${stage}.input.json`), { force: true });
          rmSync(join(this.c.state, `${stage}.recipe.json`), { force: true });
          continue;
        }
        assert.ok(op.replayable, 'An uncertain fresh-only command requires owning reconciliation');
        await this.retry(stage);
      }
      if (op.phase === 'complete' && op.exitCode === 0) {
        if (op.id) {
          const remaining = await this.c.docker.inspect(op.id);
          if (remaining) {
            assert.ok(
              !remaining.State.Running &&
                remaining.Config.Labels['thaarei.installation'] === this.c.local &&
                remaining.Config.Labels['thaarei.installer.operation'] === stage,
              'A completed private container changed',
            );
            await this.c.docker.remove(op.id);
          }
        }
        rmSync(join(this.c.state, `${stage}.resolved.json`), { force: true });
        rmSync(join(this.c.state, `${stage}.input.json`), { force: true });
        rmSync(join(this.c.state, `${stage}.recipe.json`), { force: true });
        continue;
      }
      const recipe = JSON.parse(
        privateText(join(this.c.state, `${stage}.recipe.json`)),
      ) as Configuration;
      await this.settle(stage, recipe);
    }
  }
  private async retry(stage: string) {
    const op = this.c.journal.jobs[stage];
    assert.ok(op?.replayable && op.phase === 'complete' && op.exitCode !== 0);
    if (op.id) await this.c.docker.remove(op.id);
    assert.ok(op.attempt < 100, 'Private command retry bound reached; inspect evidence');
    const recipe = JSON.parse(
      privateText(join(this.c.state, `${stage}.recipe.json`)),
    ) as Configuration;
    if (recipe.Cmd.includes('maintenance/provision-auth-database.mjs')) op.replayable = false;
    op.attempt++;
    op.name = `thaarei-${this.c.local}-${hash(stage).slice(0, 16)}-${op.attempt}`;
    delete op.id;
    delete op.exitCode;
    op.phase = 'planned';
    this.c.save();
  }
  private async settle(stage: string, configuration: Configuration) {
    const c = this.c;
    await c.current();
    const op = c.journal.jobs[stage];
    assert.ok(op);
    const outputPath = join(c.state, `${stage}.output.json`),
      inputPath = join(c.state, `${stage}.input.json`),
      recipePath = join(c.state, `${stage}.recipe.json`);
    if (op.phase === 'complete') {
      assert.equal(op.exitCode, 0, 'Prior command failed; inspect retained private output');
      const out = privateText(outputPath, 16 * 1024 ** 2);
      rmSync(inputPath, { force: true });
      rmSync(recipePath, { force: true });
      return out;
    }
    assert.ok(Object.values(c.journal.jobs).some((v) => v.name === op.name));
    assert.ok(['dms-api', 'turnstile-api'].some((role) => c.image(role) === configuration.Image));
    assert.equal(configuration.Labels['thaarei.installation'], c.local);
    assert.equal(configuration.Labels['thaarei.installer.operation'], stage);
    let found = await c.docker.inspect(op.name);
    if (!found) {
      assert.equal(op.phase, 'planned', 'Unknown private outcome requires reconciliation');
      const id = await c.docker.create(op.name, configuration);
      op.id = id;
      op.phase = 'created';
      c.save();
      found = await c.docker.inspect(id);
    }
    assert.ok(found);
    assert.equal(found.Image, configuration.Image);
    assert.equal(found.Config.Labels['thaarei.installation'], c.local);
    assert.equal(found.Config.Labels['thaarei.installer.operation'], stage);
    assert.deepEqual(found.Config.Cmd, configuration.Cmd);
    for (const entry of configuration.Env)
      assert.ok(found.Config.Env.includes(entry), 'Retained private command environment changed');
    if (op.phase === 'planned') {
      op.id = found.Id;
      op.phase = 'created';
      c.save();
    }
    if (configuration.Labels['thaarei.installer.ingress'] === 'true')
      await c.docker.connect(c.ingress, found.Id);
    if (!found.State.Running) {
      const actual = await c.docker.json<{ State: { StartedAt: string } }>(
        'GET',
        `/containers/${found.Id}/json`,
      );
      if (actual?.State.StartedAt.startsWith('0001-')) await c.docker.start(found.Id);
    }
    const code = await c.docker.wait(found.Id),
      out = await c.docker.logs(found.Id);
    atomic(outputPath, out);
    if (code === 75 && configuration.Cmd.includes('maintenance/provision-auth-database.mjs'))
      op.replayable = true;
    op.exitCode = code;
    op.phase = 'complete';
    c.save();
    await c.docker.remove(found.Id);
    if (code !== 0) {
      atomic(join(c.state, `${stage}.failed-${op.attempt}.log`), out);
      if (op.replayable)
        throw new Unavailable('Replayable owning command stopped; resume retained operation');
      throw new Error('Uncertain fresh-only command stopped; owning reconciliation is required');
    }
    rmSync(inputPath, { force: true });
    rmSync(recipePath, { force: true });
    rmSync(join(c.state, `${stage}.resolved.json`), { force: true });
    return out;
  }
  async run(
    stage: string,
    role: string,
    entry: string,
    args: string[],
    values: Record<string, string>,
    input: unknown = {},
    net = 'none',
  ) {
    const c = this.c,
      op = c.journal.jobs[stage],
      inputPath = join(c.state, `${stage}.input.json`),
      recipePath = join(c.state, `${stage}.recipe.json`);
    if (op?.phase === 'complete') {
      if (op.exitCode !== 0 && op.replayable) await this.retry(stage);
      else return this.settle(stage, {} as Configuration);
    }
    assert.ok(Object.keys(c.journal.jobs).length < 10000, 'Private command journal bound');
    if (existsSync(inputPath))
      assert.deepEqual(
        JSON.parse(privateText(inputPath)),
        input,
        'Pending command payload changed',
      );
    else writeJson(inputPath, input);
    const mounts: Mount[] = [
      { Type: 'bind', Source: c.root, Target: '/run/thaarei' },
      ...(entry.endsWith('/initialize.js') && !args.includes('--validate')
        ? [{ Type: 'bind' as const, Source: c.root, Target: '/configuration' }]
        : []),
      { Type: 'bind', Source: inputPath, Target: '/run/installer-input.json', ReadOnly: true },
    ];
    const configuration: Configuration = {
      Image: c.image(role),
      User: `${c.uid}:${c.gid}`,
      Entrypoint: ['sh'],
      Cmd: ['-c', 'exec node "$@" < /run/installer-input.json', 'owning-command', entry, ...args],
      Env: Object.entries(values).map(([k, v]) => `${k}=${v}`),
      Labels: {
        'thaarei.installation': c.local,
        'thaarei.installer.operation': stage,
        'thaarei.installer.ingress': String(net === c.ingress),
      },
      HostConfig: {
        NetworkMode: net === 'none' ? 'none' : c.network,
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
        Memory: 2147483648,
        NanoCpus: 1000000000,
        PidsLimit: 64,
        Tmpfs: { '/tmp': 'size=128m,noexec,nosuid,nodev' },
        Mounts: mounts,
      },
    };
    if (existsSync(recipePath))
      assert.deepEqual(
        JSON.parse(privateText(recipePath)),
        configuration,
        'Retained command recipe changed',
      );
    else writeJson(recipePath, configuration);
    if (!op) {
      c.journal.jobs[stage] = {
        name: `thaarei-${c.local}-${hash(stage).slice(0, 16)}`,
        phase: 'planned',
        attempt: 1,
        replayable:
          entry.endsWith('/initialize.js') ||
          entry.endsWith('/migrate.js') ||
          entry.endsWith('/deployment/operator.js') ||
          ['initialize', 'inspect', 'verify', 'verify-login', 'verify-installation'].includes(
            args[0] ?? '',
          ) ||
          (input !== null &&
            typeof input === 'object' &&
            'action' in input &&
            input.action === 'inspect'),
      };
      c.save();
    }
    return this.settle(stage, configuration);
  }
}
