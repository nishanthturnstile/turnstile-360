import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { moduleActivationJsonSchema } from '../apps/thaarei-control-plane/src/contracts/module-transitions.ts';

const document = {
  openapi: '3.1.0',
  info: { title: 'Central module activation', version: '1.0.0' },
  paths: {
    '/api/registry/products/{id}/modules/activate': {
      post: {
        description:
          'Current Admin/Operator MFA, exact same-origin JSON, current product/desired/active basis and pairing epoch, fresh matching authenticated inventory, independently verified selected delivery. Does not assign customer user permissions. Retries recover historical receipts and never reapply authority.',
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        security: [{ StaffSession: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: moduleActivationJsonSchema } },
        },
        responses: Object.fromEntries(
          [
            [200, 'Atomic activation receipt; signed sync/application remains required'],
            [400, 'Invalid input'],
            [401, 'Staff session required'],
            [403, 'Current writer/MFA or origin denied'],
            [
              409,
              'Current binding, revision, desired, basis, pairing or installed package changed',
            ],
            [503, 'Recovery quarantine or required service unavailable'],
          ].map(([status, description]) => [
            status,
            {
              description,
              headers: {
                'Cache-Control': { schema: { const: 'no-store', type: 'string' } },
                'Referrer-Policy': { schema: { const: 'no-referrer', type: 'string' } },
              },
            },
          ]),
        ),
      },
    },
  },
  components: {
    securitySchemes: {
      StaffSession: {
        type: 'apiKey',
        in: 'cookie',
        name: '__Secure-thaarei-control-plane.session_token',
        description:
          'Admitted verified employee with current live staff MFA; never customer/machine credentials.',
      },
    },
  },
};
const path = 'docs/api/module-transitions.openapi.json';
const r = spawnSync('pnpm', ['exec', 'biome', 'format', `--stdin-file-path=${path}`], {
  input: JSON.stringify(document),
  encoding: 'utf8',
});
assert.equal(r.status, 0);
if (process.argv.includes('--check')) assert.equal(readFileSync(path, 'utf8'), r.stdout);
else writeFileSync(path, r.stdout);
