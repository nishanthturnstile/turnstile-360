import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { dmsPublicExamples, dmsPublicOpenApi } from '../packages/dms-contracts/dist/openapi.js';
import {
  DMS_ERROR_STATUS,
  DMS_PUBLIC_ROUTES,
  dmsPublicSchemas,
} from '../packages/dms-contracts/dist/public.js';

const spec = dmsPublicOpenApi;
assert.deepEqual(
  Object.keys(DMS_ERROR_STATUS).sort(),
  dmsPublicSchemas.DmsError.shape.code.options.toSorted(),
  'Every public error needs an HTTP status family',
);
const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
assert.deepEqual(
  Object.keys(spec.components.schemas).sort(),
  Object.keys(dmsPublicExamples).sort(),
);
for (const [name, schema] of Object.entries(spec.components.schemas)) {
  assert.equal(
    ajv.validate(schema, dmsPublicExamples[name]),
    true,
    `Invalid ${name} JSON Schema example`,
  );
  dmsPublicSchemas[name].parse(dmsPublicExamples[name]);
}
const fixtures = JSON.parse(readFileSync('scripts/fixtures/dms-contracts.json', 'utf8'));
for (const example of fixtures) {
  const schema = spec.components.schemas[example.schema];
  assert.equal(
    ajv.validate(schema, example.value),
    example.valid,
    `JSON Schema fixture ${example.schema}`,
  );
  assert.equal(
    dmsPublicSchemas[example.schema].safeParse(example.value).success,
    example.valid,
    `Zod fixture ${example.schema}`,
  );
}
const identity = spec.paths['/v1'].get;
const capabilities = spec.paths['/v1/capabilities'].get;
const enrollment = spec.paths['/v1/application-enrollments'].post;
assert.notEqual(
  identity.description,
  capabilities.description,
  'Public identity must not inherit machine authorization prose',
);
assert.equal(
  new Set([
    identity.responses[200].description,
    capabilities.responses[200].description,
    enrollment.responses[200].description,
  ]).size,
  3,
  'Different operations need accurate success descriptions',
);
assert.notEqual(
  enrollment.responses[200].description,
  enrollment.responses[201].description,
  'Creation and replay are distinct enrollment outcomes',
);
const ids = [];
for (const [path, methods] of Object.entries(spec.paths)) {
  assert.ok(path === '/v1' || path.startsWith('/v1/'));
  for (const [method, operation] of Object.entries(methods)) {
    ids.push(operation.operationId);
    const contract = DMS_PUBLIC_ROUTES.find(
      (route) => route.path === path && route.method.toLowerCase() === method,
    );
    assert.ok(contract);
    assert.equal(operation['x-dms-policy'], contract.policy);
    assert.equal(operation.security.length, contract.policy === 'public' ? 0 : 1);
    for (const response of Object.values(operation.responses)) {
      assert.ok(response.headers['X-Request-Id']);
      assert.ok(response.headers['Cache-Control']);
      const media = response.content['application/json'];
      const name = media.schema.$ref.split('/').at(-1);
      assert.equal(ajv.validate(spec.components.schemas[name], media.example), true);
    }
  }
}
assert.equal(new Set(ids).size, ids.length, 'Operation IDs must be unique');
assert.equal(ids.length, DMS_PUBLIC_ROUTES.length);
function references(value) {
  if (!value || typeof value !== 'object') return;
  if ('$ref' in value) {
    assert.ok(value.$ref.startsWith('#/'), 'External schema references are forbidden');
    let target = spec;
    for (const part of value.$ref.slice(2).split('/')) target = target?.[part];
    assert.ok(target, `Unresolved ${value.$ref}`);
  }
  for (const child of Object.values(value)) references(child);
}
references(spec);
const path = 'docs/api/dms.openapi.json';
const formatted = spawnSync('pnpm', ['exec', 'biome', 'format', `--stdin-file-path=${path}`], {
  input: JSON.stringify(spec),
  encoding: 'utf8',
});
assert.equal(formatted.status, 0, 'OpenAPI formatting failed');
if (process.argv.includes('--check'))
  assert.equal(readFileSync(path, 'utf8'), formatted.stdout, 'Regenerate consumer DMS OpenAPI');
else writeFileSync(path, formatted.stdout);
console.log(
  'Consumer DMS OpenAPI: schemas, examples, references, operation/security/header catalog and drift verified.',
);
