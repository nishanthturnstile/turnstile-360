import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  BUSINESS_MODULES,
  moduleCapabilitiesSchema,
  moduleEntrySchema,
  moduleErrorSchema,
  moduleJsonSchemas,
} from '../packages/turnstile-contracts/dist/index.js';

const schemas = {
  ModuleCapabilities: moduleCapabilitiesSchema,
  ModuleEntry: moduleEntrySchema,
  ModuleError: moduleErrorSchema,
};
const context = {
  catalogueDigest: 'a'.repeat(64),
  profileDigest: 'b'.repeat(64),
  releaseId: 'c'.repeat(64),
  policyRevision: 3,
  assignmentRevision: 2,
};
const link = BUSINESS_MODULES[0];
const examples = {
  ModuleCapabilities: {
    version: 1,
    modules: [{ id: link.id, title: link.title, path: link.path }],
    context,
  },
  ModuleEntry: { id: link.id, title: link.title, message: 'You are in Incident Management' },
  ModuleError: { code: 'MODULE_ACCESS_DENIED' },
};
for (const [name, schema] of Object.entries(schemas)) schema.parse(examples[name]);
const components = moduleJsonSchemas;
const response = (name, description) => ({
  description,
  headers: {
    'Cache-Control': { schema: { type: 'string', const: 'private, no-store' } },
    'Referrer-Policy': { schema: { type: 'string', const: 'no-referrer' } },
  },
  content: {
    'application/json': {
      schema: { $ref: `#/components/schemas/${name}` },
      example: examples[name],
    },
  },
});
const get = (name, description) => ({
  description,
  security: [{ ProductSession: [] }],
  responses: {
    200: response(name, 'Current user projection'),
    400: response('ModuleError', 'Invalid input'),
    401: response('ModuleError', 'Normal login required'),
    403: response('ModuleError', 'Deployment or user/module access denied'),
    409: response('ModuleError', 'Readiness or access context changed'),
    503: response('ModuleError', 'Required dependency or release unavailable'),
  },
});
const paths = {
  '/api/modules': {
    get: get(
      'ModuleCapabilities',
      'Only installed modules permitted by current signed v2, local enablement, current explicit user rights and readiness. Legacy products return no business modules.',
    ),
  },
};
for (const module of BUSINESS_MODULES)
  paths[`/api/modules/${module.id}/entry`] = {
    get: get(
      'ModuleEntry',
      'Guarded placeholder. This route is unregistered (404) when its implementation is excluded from the selected image.',
    ),
  };
for (const module of BUSINESS_MODULES)
  paths[`/api/modules/${module.id}/entry`].get.responses[404] = {
    description: 'Implementation excluded from this selected image; route unregistered',
  };
const document = {
  openapi: '3.1.0',
  info: { title: 'Turnstile module capabilities', version: '1.0.0' },
  servers: [{ url: 'https://turnstile.example.test' }],
  paths,
  components: {
    securitySchemes: {
      ProductSession: {
        type: 'apiKey',
        in: 'cookie',
        name: '__Host-turnstile',
        description:
          'Normal product BFF session. Staff and machine credentials do not authenticate user module routes.',
      },
    },
    schemas: components,
  },
};
const target = 'docs/api/turnstile-modules.openapi.json';
const formatted = spawnSync('pnpm', ['exec', 'biome', 'format', `--stdin-file-path=${target}`], {
  input: JSON.stringify(document),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
assert.equal(formatted.status, 0, `Formatting failed: ${formatted.stderr}`);
const text = formatted.stdout;
if (process.argv.includes('--check'))
  assert.equal(readFileSync(target, 'utf8'), text, 'Module OpenAPI drift; run pnpm docs:modules');
else writeFileSync(target, text);
console.log(
  'Module OpenAPI matches executable contracts, bounded projections and selected route semantics.',
);
