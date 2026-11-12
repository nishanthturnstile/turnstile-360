// Private test orchestration only. Every staff/machine mutation still uses the real HTTPS handlers.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { join } from 'node:path';
import { catalogueDigest, resolveSelection } from '../../packages/module-catalog/dist/index.js';
export async function moduleCutoverControl({
  fixture,
  admin,
  origin,
  publicTrust,
  temporary,
  referenceDirectory,
  signEvidence,
  reauthenticateAdmin,
  run,
  centralIngress,
}) {
  const call = async (path, body) => {
    const r = await admin.call(path, body);
    assert.equal(
      r.status,
      200,
      `Cutover fixture staff operation failed: ${path}, ${r.status}: ${r.text}`,
    );
    return r.json();
  };
  const registry = (body) =>
    call('/api/registry', { requestId: randomUUID(), reason: 'isolated actual cutover', ...body });
  const catalogue = fixture.bundles[0].request.catalogue;
  await reauthenticateAdmin();
  await call('/api/module-catalogues', {
    type: 'code.import',
    requestId: randomUUID(),
    reason: 'actual source fixture',
    attestation: await signEvidence({ version: 1, kind: 'code', catalogue }),
  });
  const records = new Map();
  for (const selected of new Map(
    fixture.bundles.map((b) => [b.request.catalogue.id, b.request.catalogue]),
  ).values()) {
    await call('/api/module-catalogues', {
      type: 'draft.create',
      requestId: randomUUID(),
      reason: 'actual source classification',
      id: selected.id,
      sourceId: catalogue.id,
      categories: selected.modules.map(({ id, category }) => ({ id, category })),
    });
    const record = await call(`/api/module-catalogues/${selected.id}`);
    await call('/api/module-catalogues', {
      type: 'catalogue.publish',
      requestId: randomUUID(),
      reason: 'actual source classification',
      id: selected.id,
      revision: record.revision,
      attestation: await signEvidence({
        version: 1,
        kind: 'classification',
        catalogueId: selected.id,
        catalogueDigest: record.digest,
        codeCatalogueDigest: await catalogueDigest(catalogue),
        draftRevision: record.revision,
      }),
    });
    records.set(selected.id, record);
  }
  for (const bundle of fixture.bundles)
    await writeFile(
      join(referenceDirectory, `${bundle.request.profileDigest}.json`),
      await readFile(join(bundle.directory, 'delivery.json')),
      { mode: 0o644 },
    );
  let id, binding, connectedNetwork;
  const read = () => call(`/api/registry/products/${id}/modules`);
  const assign = async (ids, removed = [], catalogueId = catalogue.id) => {
    const record = records.get(catalogueId),
      selected = record.catalogue;
    for (const type of ['assignment.draft', 'assignment.approve']) {
      const view = await read();
      await call(`/api/registry/products/${id}/modules`, {
        type,
        command: {
          version: 1,
          operationId: randomUUID(),
          expectedRevision: view.productRevision,
          binding: view.binding,
          catalogueDigest: record.digest,
          requestedIndividualIds: ids,
          confirmedResolvedIds: resolveSelection(selected, { requestedIndividualIds: ids })
            .resolvedIds,
          explicitlyRemovedIds: removed,
          confirmedRemovalClosureIds: removed,
          activeBasis: view.authority?.active ?? null,
          reason: 'Actual selected cutover review',
        },
      });
    }
    return read();
  };
  const pairing = async (action) => {
    const view = await read(),
      code = randomBytes(32).toString('base64url'),
      pairingId = randomUUID();
    const r = await call('/api/pairing', {
      requestId: randomUUID(),
      reason: 'Actual selected cutover pairing',
      productId: id,
      revision: view.productRevision,
      action,
      pairingId,
      code,
    });
    return { version: 1, origin, binding, pairingId, code, expiresAt: r.expiresAt };
  };
  const token = randomBytes(32).toString('base64url');
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      let raw = '';
      for await (const c of req) {
        raw += c;
        assert.ok(raw.length <= 16384);
      }
      const input = JSON.parse(raw);
      await reauthenticateAdmin();
      let result;
      if (input.action === 'initialize') {
        assert.equal(id, undefined);
        connectedNetwork = input.network;
        await run('docker', [
          'network',
          'connect',
          '--alias',
          'central.fixture.test',
          connectedNetwork,
          centralIngress,
        ]);
        const client = await registry({
          type: 'client.create',
          code: 'ACTUAL-MODULE-CUTOVER',
          name: 'Actual module cutover',
        });
        const installation = await registry({
          type: 'installation.create',
          clientId: client.clientId,
          environment: 'cutover',
          label: 'Actual selected customer',
          localInstallationId: input.localInstallationId,
          tenantId: input.tenantId,
        });
        const product = await registry({
          type: 'product.create',
          clientId: client.clientId,
          installationId: installation.resourceId,
          binding: { product: 'turnstile', applicationId: input.applicationId },
        });
        id = product.resourceId;
        binding = (await call(`/api/registry/products/${id}/manifest`)).binding;
        await assign(['incident-management']);
        await call(`/api/registry/products/${id}/modules/enforce`, {
          operationId: randomUUID(),
          expectedRevision: (await read()).productRevision,
          reason: 'Verified actual enforcing image',
        });
        result = {
          pairing: await pairing('issue'),
          publicTrust,
          centralIngress,
          ca: await readFile(join(temporary, 'cert.pem'), 'utf8'),
        };
      } else if (input.action === 'approve-product') {
        await registry({
          type: 'product.policy',
          id,
          revision: (await read()).productRevision,
          decision: 'approve',
        });
        result = await read();
      } else if (input.action === 'activate') {
        const view = await read();
        const command = {
          operationId: randomUUID(),
          expectedRevision: view.productRevision,
          desiredRevision: view.desired.revision,
          epoch: view.inventory.epoch,
          installed: view.inventory.installed,
          activeBasis: view.authority?.active ?? null,
          reason: 'Actual installed release and current MFA confirmed',
        };
        if (input.lost)
          await assert.rejects(
            admin.call(`/api/registry/products/${id}/modules/activate`, command, {
              dropResponse: true,
            }),
          );
        await call(`/api/registry/products/${id}/modules/activate`, command);
        result = await read();
      } else if (input.action === 'assign')
        result = await assign(input.ids, input.removed ?? [], input.catalogueId ?? catalogue.id);
      else if (input.action === 'pair') result = await pairing('replace');
      else if (input.action === 'read') result = await read();
      else throw new Error('Unknown fixture operation');
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
      res
        .writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const file = join(temporary, 'cutover-control.json');
  await writeFile(
    file,
    JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, token }),
    { mode: 0o600 },
  );
  return {
    file,
    close: async () => {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      if (connectedNetwork)
        await run('docker', ['network', 'disconnect', connectedNetwork, centralIngress]).catch(
          () => {},
        );
    },
  };
}
