import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  DOCUMENTS_LIMITS,
  documentsErrorSchema,
} from '../packages/turnstile-contracts/dist/documents.js';

const suffix = randomUUID(),
  network = `documents-ingress-${suffix}`,
  gateway = `documents-gateway-${suffix}`,
  backend = `documents-backend-${suffix}`;
function run(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000 });
  assert.equal(
    result.status,
    0,
    `Documents ingress fixture Docker operation failed (${args[0]}): ${result.stderr?.slice(-1000)}`,
  );
  return result.stdout.trim();
}
const image = 'thaarei-documents-gateway:dv-i02-fixture';
let created = false;
try {
  run(['build', '--quiet', '-f', 'deploy/customer/Dockerfile', '-t', image, '.']);
  run(['network', 'create', '--internal', network]);
  created = true;
  // A bounded counter upstream isolates ingress behavior. Product parsing and
  // authorization are qualified by their owning real HTTP/database/browser tests.
  run([
    'run',
    '--detach',
    '--name',
    backend,
    '--network',
    network,
    '--network-alias',
    'backend',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--user',
    'node',
    'node:24.21.0-bookworm-slim',
    'node',
    '-e',
    `require('node:http').createServer((req,res)=>{let size=0;req.on('data',c=>size+=c.length);req.on('end',()=>{res.setHeader('content-type','application/json');if(req.headers['content-type']==='text/plain'){res.writeHead(415).end(JSON.stringify({upstream:'private fixture body'}));return;}res.end(JSON.stringify({size,proto:req.headers['x-forwarded-proto']}));});}).listen(3002,'0.0.0.0');require('node:http').createServer((_req,res)=>res.writeHead(200,{'content-security-policy':"connect-src 'self'"}).end('fixture')).listen(8080,'0.0.0.0');`,
  ]);
  run([
    'run',
    '--detach',
    '--name',
    gateway,
    '--network',
    network,
    '--network-alias',
    'gateway',
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '-e',
    'TURNSTILE_API_UPSTREAM=backend',
    '-e',
    'TURNSTILE_WEB_UPSTREAM=backend',
    '-e',
    'DMS_API_UPSTREAM=backend',
    '-e',
    'DMS_DOCUMENTS_TRANSFER_ORIGIN=https://files.fixture.test:4443',
    image,
  ]);
  // Await real Nginx readiness inside the isolated network; no host port is allocated.
  run([
    'exec',
    backend,
    'node',
    '-e',
    `(async()=>{for(let n=0;n<100;n++){try{if((await fetch('http://gateway:8080/health/gateway')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}process.exit(1);})();`,
  ]);
  function request(path, size, contentType = 'application/json') {
    return JSON.parse(
      run([
        'exec',
        backend,
        'node',
        '-e',
        `fetch('http://gateway:8080'+${JSON.stringify(path)},{method:'POST',headers:{'content-type':${JSON.stringify(contentType)},'x-forwarded-proto':'https'},body:'x'.repeat(${size})}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json(),cache:r.headers.get('cache-control')}))).catch(()=>process.exit(1));`,
      ]),
    );
  }
  for (const [path, limit] of [
    ['/api/documents/future', DOCUMENTS_LIMITS.ordinaryRequestBytes],
    ['/api/documents/operations', DOCUMENTS_LIMITS.batchEnvelopeBytes],
  ]) {
    const exact = request(path, limit);
    assert.equal(exact.status, 200);
    assert.equal(exact.body.size, limit);
    assert.equal(exact.body.proto, 'https');
    const over = request(path, limit + 1);
    assert.equal(over.status, 413);
    assert.equal(documentsErrorSchema.parse(over.body).code, 'DOCUMENTS_TOO_LARGE');
    assert.equal(over.cache, 'private, no-store');
  }
  const csp = run([
    'exec',
    backend,
    'node',
    '-e',
    "fetch('http://gateway:8080/documents/uploads').then(r=>console.log(r.headers.get('content-security-policy')))",
  ]);
  assert.match(csp, /connect-src 'self' https:\/\/files\.fixture\.test:4443;/);
  assert.equal((csp.match(/connect-src/g) ?? []).length, 1);
  assert.match(csp, /object-src 'none'/);
  const media = request('/api/documents/future', 8, 'text/plain');
  assert.equal(media.status, 415);
  assert.equal(documentsErrorSchema.parse(media.body).code, 'DOCUMENTS_MEDIA_TYPE_UNSUPPORTED');
  assert.equal(JSON.stringify(media.body).includes('private fixture body'), false);
  assert.equal(
    request('/api/people/imports', 270337).status,
    200,
    'Documents ingress budgets must not change unrelated gateway routes',
  );
  console.log(
    'Actual customer Nginx: scoped exact/over byte limits, typed 413/415, correlation, no-store and configured forwarded headers passed. Counter upstream only; product HTTP qualification is separate.',
  );
} finally {
  for (const name of [gateway, backend])
    spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
  if (created) spawnSync('docker', ['network', 'rm', network], { stdio: 'ignore' });
}
