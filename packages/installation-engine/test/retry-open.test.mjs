import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeJson } from '../dist/files.js';
import { PrivateJobs } from '../dist/jobs.js';

test('explicit open retry preserves command identity, recovers lost wait, and never retries other issuance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'open-retry-'));
  try {
    const stage = 'owner-test';
    const payload = {
      key: 'retained-key',
      expectedRevision: 3,
      administratorUserId: 'user',
      administratorCookie: 'old',
      releaseId: 'release',
    };
    const recipe = {
      Image: 'api',
      Entrypoint: ['sh'],
      Cmd: [
        '-c',
        'exec node "$@" < /run/installer-input.json',
        'owning-command',
        'dist/modules/access/release-operator.js',
        'open',
      ],
      Env: [],
      Labels: { 'thaarei.installation': 'local', 'thaarei.installer.operation': stage },
      HostConfig: {},
    };
    writeJson(join(root, `${stage}.recipe.json`), recipe);
    writeJson(join(root, `${stage}.input.json`), payload);
    const journal = {
      jobs: { [stage]: { phase: 'complete', replayable: false, exitCode: 1, attempt: 1 } },
    };
    let container,
      created = 0,
      lost = true;
    const docker = {
      inspect: async () => container,
      create: async (_name, configuration) => {
        created++;
        container = {
          Id: 'id',
          Image: configuration.Image,
          Config: configuration,
          State: { Running: false },
        };
        return 'id';
      },
      json: async () => ({ State: { StartedAt: '0001-01-01' } }),
      start: async () => {},
      wait: async () => {
        if (lost) {
          lost = false;
          throw new Error('lost acknowledgement');
        }
        return 0;
      },
      logs: async () => '{"action":"release-open","replayed":true,"publicWritesEnabled":false}',
      remove: async () => {
        container = undefined;
      },
    };
    const jobs = new PrivateJobs({
      docker,
      root,
      state: root,
      network: 'net',
      ingress: 'edge',
      uid: process.getuid(),
      gid: process.getgid(),
      local: 'local',
      image: () => 'api',
      journal,
      save: () => {},
      current: async () => {},
    });
    await assert.rejects(jobs.resume(), /uncertain fresh-only/);
    await assert.rejects(jobs.retryOpen(stage, 'new'), /lost acknowledgement/);
    assert.deepEqual(JSON.parse(readFileSync(join(root, `${stage}.input.json`))), {
      ...payload,
      administratorCookie: 'new',
    });
    const result = JSON.parse(await jobs.retryOpen(stage, 'newer'));
    assert.equal(created, 1);
    assert.equal(result.publicWritesEnabled, false);
    assert.equal(journal.jobs[stage].replayable, false);
    assert.equal(journal.jobs[stage].exitCode, 0);
    assert.equal(JSON.parse(await jobs.retryOpen(stage, 'unused')).replayed, true);
    assert.equal(created, 1);
    journal.jobs[stage] = { phase: 'complete', replayable: false, exitCode: 1, attempt: 1 };
    writeJson(join(root, `${stage}.recipe.json`), {
      ...recipe,
      Cmd: [...recipe.Cmd.slice(0, -1), 'bootstrap-administrator'],
    });
    writeJson(join(root, `${stage}.input.json`), payload);
    await assert.rejects(jobs.retryOpen(stage, 'new'));
    assert.equal(
      JSON.parse(readFileSync(join(root, `${stage}.input.json`))).administratorCookie,
      'old',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
