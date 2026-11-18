import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { peopleExamples } from './fixtures/user-management.mjs';

// Explicit read-only capture. Replacing the frozen compatibility baseline is a reviewed change.
const { values } = parseArgs({
  options: { 'api-container': { type: 'string' }, 'web-container': { type: 'string' } },
});
const api = values['api-container'];
const web = values['web-container'];
if (!api || !web) throw new Error('Both --api-container and --web-container are required');
const script = `import { createHash } from 'node:crypto'; import {peopleJsonSchemas, peopleSchemas, PEOPLE_PERMISSIONS} from '@thaarei/turnstile-contracts'; let input='';for await (const chunk of process.stdin) input+=chunk; const examples=JSON.parse(input);for(const [name,value] of Object.entries(examples))peopleSchemas[name].parse(value);console.log(JSON.stringify({permissions:PEOPLE_PERMISSIONS,schemas:Object.fromEntries(Object.entries(peopleJsonSchemas()).map(([k,v])=>[k,createHash('sha256').update(JSON.stringify(v)).digest('hex')]))}));`;
const capture = JSON.parse(
  execFileSync('docker', ['exec', '-i', api, 'node', '--input-type=module', '-e', script], {
    input: JSON.stringify(peopleExamples),
    encoding: 'utf8',
  }),
);
const webAssets = execFileSync(
  'docker',
  [
    'exec',
    web,
    'sh',
    '-c',
    'find /usr/share/nginx/html -type f -name "*.js" -o -name "index.html" | sort | xargs sha256sum',
  ],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .map((line) => {
    const [sha256, path] = line.trim().split(/\s+/);
    return { path, sha256 };
  });
const image = (container) =>
  execFileSync('docker', ['inspect', container, '--format', '{{.Image}}'], {
    encoding: 'utf8',
  }).trim();
writeFileSync(
  fileURLToPath(
    new URL(
      '../packages/turnstile-contracts/test/documents-legacy-v2.fixture.json',
      import.meta.url,
    ),
  ),
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString().slice(0, 10),
      provenance: {
        apiImage: image(api),
        webImage: image(web),
        webAssets,
        method:
          'Read-only installed API package schema capture and validation of synthetic repository examples. Web files hashed; browser behavior remains DV-I02.',
      },
      ...capture,
      examples: peopleExamples,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Captured ${Object.keys(capture.schemas).length} schemas and ${Object.keys(peopleExamples).length} installed-package checked synthetic fixtures, ${webAssets.length} web assets.`,
);
