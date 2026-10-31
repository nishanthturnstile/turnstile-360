import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseDocument } from 'yaml';

for (const file of [
  'deploy/compose.local.yaml',
  'deploy/compose.dokploy.yaml',
  'deploy/compose.mailpit.yaml',
]) {
  const document = parseDocument(readFileSync(file, 'utf8'), { uniqueKeys: true });
  assert.equal(document.errors.length, 0, `${file}: invalid YAML`);
  const configuration = document.toJS();
  assert.ok(Object.keys(configuration.services).length > 0, `${file}: no services`);
  for (const [name, service] of Object.entries(configuration.services)) {
    if (!service.build) continue;
    const context = resolve(dirname(file), service.build.context);
    assert.ok(
      existsSync(resolve(context, service.build.dockerfile)),
      `${name}: missing Dockerfile`,
    );
  }
  console.log(`${file}: YAML and build paths valid`);
}
