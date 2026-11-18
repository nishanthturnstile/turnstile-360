import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function pdf(text) {
  const body = `BT /F1 16 Tf 50 700 Td (${text}) Tj ET`,
    objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    ];
  let value = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, o] of objects.entries()) {
    offsets.push(Buffer.byteLength(value));
    value += `${i + 1} 0 obj\n${o}\nendobj\n`;
  }
  const start = Buffer.byteLength(value);
  return Buffer.from(
    `${value}xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((x) => `${String(x).padStart(10, '0')} 00000 n `)
      .join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`,
  );
}
export async function qualifyConsumers({
  root,
  install,
  network,
  version,
  state,
  run,
  dms,
  application,
  compose,
  ocrFile,
}) {
  const folder = join(root, 'independent');
  mkdirSync(folder, { mode: 0o700 });
  const input = join(folder, 'input'),
    output = join(folder, 'output');
  mkdirSync(input, { mode: 0o700 });
  mkdirSync(output, { mode: 0o700 });
  const consumers = {};
  for (const who of ['A', 'B']) {
    const applicationId = randomUUID(),
      clientId = `independent-${who.toLowerCase()}`,
      name = `Independent ${who}`;
    await dms('authority-client', {
      action: 'issue',
      kind: 'machine',
      clientId,
      applicationId,
      scopes: state.scopes,
      operatorEmail: state.operatorEmail,
      operatorPassword: state.operatorPassword,
      credentialFile: `/configuration/.independent-${who}.json`,
    });
    const c = JSON.parse(readFileSync(join(install, `.independent-${who}.json`)));
    await application({
      action: 'register',
      applicationId,
      clientId,
      name,
      scopes: state.scopes,
      operatorEmail: state.operatorEmail,
      operatorPassword: state.operatorPassword,
    });
    await application({
      action: 'issue-key',
      applicationId,
      credentialFile: `/configuration/.independent-key-${who}.json`,
    });
    consumers[who] = {
      ...c,
      applicationId,
      name,
      scopes: state.scopes,
      enrollmentKey: JSON.parse(readFileSync(join(install, `.independent-key-${who}.json`)))
        .enrollmentKey,
    };
  }
  const files = [];
  function add(name, bytes, contentType, cls, pages = 1) {
    writeFileSync(join(input, name), bytes, { mode: 0o600 });
    files.push({
      name,
      path: `/input/${name}`,
      contentType,
      class: cls,
      pages,
      profile: 'searchable',
    });
  }
  for (let i = 0; i < 8; i++)
    add(
      `small-${i}.txt`,
      Buffer.from(`qualifytoken synthetic document ${i}.\n`.repeat(64)),
      'text/plain',
      'text-small',
    );
  for (let i = 0; i < 8; i++)
    add(
      `large-${i}.txt`,
      Buffer.from(`qualifytoken bounded synthetic paragraph ${i}.\n`.repeat(1600)),
      'text/plain',
      'text-large',
    );
  for (let i = 0; i < 4; i++)
    add(
      `table-${i}.csv`,
      Buffer.from(
        `name,value\n${Array.from({ length: 512 }, (_, n) => `qualifytoken-${n},${n}`).join('\n')}`,
      ),
      'text/csv',
      'tabular',
    );
  for (let i = 0; i < 2; i++)
    add(
      `native-${i}.pdf`,
      pdf(`qualifytoken printed native document ${i}`),
      'application/pdf',
      'native-pdf',
    );
  assert.ok(ocrFile, 'Explicit owned OCR fixture required');
  for (let i = 0; i < 2; i++)
    add(`scan-${i}.png`, readFileSync(ocrFile), 'image/png', 'ocr-english');
  const mix = {
    name: 'synthetic-local-v1',
    normalArrivalsPerMinute: 200000 / (22 * 8 * 60),
    workingDaysPerMonth: 22,
    hoursPerDay: 8,
    initialBurst: 4,
    maxConcurrentDocuments: 4,
    documents: 24,
    classes: { 'text-small': 8, 'text-large': 8, tabular: 4, 'native-pdf': 2, 'ocr-english': 2 },
    ocrShare: 2 / 24,
    structuredShare: 0,
    scope:
      'Bounded synthetic sample; optional structured adapter qualified separately. Not sustained monthly capacity or a customer workload.',
  };
  const formatCases = [];
  const upstream = 'apps/dms-processing/tests/fixtures/extraction';
  const families = [
    ['testWORD.doc', 'application/msword'],
    ['testWORD.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['testPPT.ppt', 'application/vnd.ms-powerpoint'],
    ['testPPT.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['testFooter.odt', 'application/vnd.oasis.opendocument.text'],
    ['testMasterFooter.odp', 'application/vnd.oasis.opendocument.presentation'],
    ['testEXCEL.xls', 'application/vnd.ms-excel'],
    ['testEXCEL.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['test-columnar.xlsb', 'application/vnd.ms-excel.sheet.binary.macroenabled.12'],
    ['testMSG.msg', 'application/vnd.ms-outlook'],
  ];
  for (const [name, media] of families) {
    add(name, readFileSync(join(upstream, name)), media, 'format-family', 0);
    formatCases.push({ ...files.pop(), allowedStatuses: ['SUCCEEDED', 'PARTIAL'] });
  }
  await run(
    'uv',
    [
      'run',
      '--locked',
      '--project',
      resolve('apps/dms-processing'),
      'python',
      resolve('scripts/fixtures/dms-distribution/make-ods.py'),
      join(input, 'safe.ods'),
    ],
    { cwd: process.cwd() },
  );
  add(
    'safe.ods',
    readFileSync(join(input, 'safe.ods')),
    'application/vnd.oasis.opendocument.spreadsheet',
    'format-family',
    0,
  );
  formatCases.push({ ...files.pop(), allowedStatuses: ['SUCCEEDED', 'PARTIAL'] });
  add(
    'safe.eml',
    Buffer.from(
      'From: sender@example.test\r\nTo: receiver@example.test\r\nSubject: Synthetic qualification\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nqualifytoken safe email body\r\n',
    ),
    'message/rfc822',
    'email',
    0,
  );
  formatCases.push({ ...files.pop(), allowedStatuses: ['SUCCEEDED', 'PARTIAL'] });
  add(
    'safe.rtf',
    Buffer.from('{\\rtf1\\ansi qualifytoken printed RTF text}'),
    'application/rtf',
    'rtf',
    0,
  );
  formatCases.push({ ...files.pop(), allowedStatuses: ['SUCCEEDED', 'PARTIAL'] });
  const config = {
    issuer: 'https://identity.dms.test/identity',
    resource: 'https://identity.dms.test/v1',
    transferOrigin: 'https://files.dms.test',
    consumers,
    files,
    formatCases,
    mix,
    interarrivalMs: Math.ceil(60000 / mix.normalArrivalsPerMinute),
  };
  writeFileSync(join(folder, 'consumer.json'), JSON.stringify(config), { mode: 0o600 });
  cpSync('examples/dms/qualification.mjs', join(folder, 'consumer.mjs'));
  const containers = JSON.parse(
    (
      await run('docker', [
        'inspect',
        ...(
          await compose([
            'ps',
            '-q',
            'coordinator',
            'scan-worker',
            'extract-worker',
            'heavy-worker',
          ])
        ).stdout
          .trim()
          .split('\n'),
      ])
    ).stdout,
  );
  const coordinator = containers.find(
    (c) => c.Config.Labels['com.docker.compose.service'] === 'coordinator',
  ).Id;
  const samples = [];
  let sampling = false;
  async function sample() {
    if (sampling) return;
    sampling = true;
    try {
      const observation = await run(
        'docker',
        ['exec', coordinator, 'node', '/app/qualification-observe.mjs'],
        { allowFailure: true },
      );
      const stats = await run(
        'docker',
        ['stats', '--no-stream', '--format', '{{json .}}', ...containers.map((c) => c.Id)],
        { allowFailure: true },
      );
      const scratch = await run('docker', ['exec', coordinator, 'du', '-sb', '/capacity/scratch'], {
        allowFailure: true,
      });
      samples.push({
        at: new Date().toISOString(),
        observation: observation.status === 0 ? JSON.parse(observation.stdout) : null,
        containers:
          stats.status === 0 ? stats.stdout.trim().split('\n').filter(Boolean).map(JSON.parse) : [],
        scratchBytes: scratch.status === 0 ? Number(scratch.stdout.split(/\s/)[0]) : null,
      });
    } finally {
      sampling = false;
    }
  }
  const timer = setInterval(() => void sample().catch(() => {}), 5000);
  await sample();
  try {
    await run('docker', [
      'run',
      '--rm',
      '--network',
      network,
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      `${process.getuid()}:${process.getgid()}`,
      '--memory',
      '256m',
      '--cpus',
      '1',
      '--pids-limit',
      '32',
      '--env',
      'NODE_EXTRA_CA_CERTS=/ca.crt',
      '--mount',
      `type=bind,src=${resolve(folder, 'consumer.mjs')},dst=/consumer.mjs,readonly`,
      '--mount',
      `type=bind,src=${resolve(folder, 'consumer.json')},dst=/consumer.json,readonly`,
      '--mount',
      `type=bind,src=${resolve(input)},dst=/input,readonly`,
      '--mount',
      `type=bind,src=${resolve(output)},dst=/output`,
      '--mount',
      `type=bind,src=${resolve(install, 'deploy/qualification/tls/ca.crt')},dst=/ca.crt,readonly`,
      `thaarei-dms-api:${version}`,
      'node',
      '/consumer.mjs',
      '/consumer.json',
      '/output/result.json',
    ]);
  } finally {
    clearInterval(timer);
    while (sampling) await new Promise((r) => setTimeout(r, 100));
    await sample();
  }
  const result = JSON.parse(readFileSync(join(output, 'result.json')));
  assert.ok(result.passed);
  assert.ok(
    samples.filter((s) => s.observation && s.containers.length && s.scratchBytes !== null).length >=
      3,
    'Insufficient queue/resource instrumentation; do not publish an unobserved performance pass',
  );
  writeFileSync(
    join(root, 'PERFORMANCE-RESULT.json'),
    JSON.stringify(
      {
        ...result,
        instrumentation: {
          intervalSeconds: 5,
          samples,
          limitations:
            'Sampled container CPU/RSS and scratch, not exact process high-water marks or per-page CPU attribution. Private observer is outside the independent consumer. Queue observations include fixture baseline work.',
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log('Independent A/B HTTP journey and declared synthetic operating mix passed');
}
