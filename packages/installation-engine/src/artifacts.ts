import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readProtectedTrust,
  type TrustBundle,
  type VerifiedModuleRelease,
  verifyInstalledModuleRelease,
} from '@thaarei/deployment-control';
import { type DeliveryRequest, validateDeliveryEvidence } from '@thaarei/module-catalog';
import { decodeJwt, decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import {
  type CustomerRelease,
  customerRelease,
  ENGINE_VERSION,
  RELEASE_AUDIENCE,
  RELEASE_TYPE,
} from './contracts.js';
import { Docker } from './docker.js';
import { hash } from './files.js';
export async function fileHash(path: string) {
  const h = createHash('sha256');
  for await (const c of createReadStream(path)) h.update(c);
  return h.digest('hex');
}
function json(path: string, max = 262144): unknown {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || s.size > max)
    throw new Error('Bounded regular artifact required');
  return JSON.parse(readFileSync(path, 'utf8'));
}
export async function verifyReleaseToken(
  token: string,
  trust: TrustBundle,
  historical = false,
): Promise<CustomerRelease> {
  if (token.length > 131072) throw new Error('Release proof bound');
  const h = decodeProtectedHeader(token);
  if (Object.keys(h).some((k) => !['alg', 'typ', 'kid'].includes(k)))
    throw new Error('Untrusted release header');
  const matching = trust.keys.filter((k) => k.kid === h.kid),
    k = matching[0];
  if (matching.length !== 1 || !k || k.status === 'revoked')
    throw new Error('Release signing key unavailable');
  const issuer = new URL(trust.issuer);
  if (issuer.protocol !== 'https:' || issuer.origin !== trust.issuer)
    throw new Error('Canonical HTTPS release issuer required');
  const original = historical ? decodeJwt(token).iat : undefined;
  if (
    historical &&
    (!Number.isInteger(original) || !original || original > Math.floor(Date.now() / 1000))
  )
    throw new Error('Invalid original release issuance');
  const v = await jwtVerify(token, await importSPKI(k.pem, 'RS256'), {
    algorithms: ['RS256'],
    typ: RELEASE_TYPE,
    issuer: trust.issuer,
    audience: RELEASE_AUDIENCE,
    requiredClaims: ['iat', 'nbf', 'exp'],
    maxTokenAge: '24h',
    ...(historical ? { currentDate: new Date(Number(original) * 1000) } : {}),
  });
  const { iss: _iss, aud: _aud, iat, nbf, exp, ...body } = v.payload;
  if (
    !Number.isInteger(iat) ||
    !Number.isInteger(nbf) ||
    !Number.isInteger(exp) ||
    !iat ||
    !nbf ||
    !exp ||
    nbf < iat ||
    exp - iat > 86400 ||
    exp <= nbf ||
    (k.status === 'retired' && (k.lastIssuedAt === null || iat > k.lastIssuedAt))
  )
    throw new Error('Release validity rejected');
  return customerRelease.parse(body);
}
/** Full signed file custody is checked before any target configuration/database mutation. */
export async function verifyArtifacts(
  directory: string,
  trustFile: string,
  docker = new Docker(),
  load = false,
  historical = false,
): Promise<{
  release: CustomerRelease;
  module: { attestation: string; request: DeliveryRequest };
  installed: VerifiedModuleRelease;
}> {
  const trust = await readProtectedTrust(trustFile);
  const descriptor = json(join(directory, 'installation.json')) as { attestation?: unknown };
  if (
    Object.keys(descriptor).join(',') !== 'attestation' ||
    typeof descriptor.attestation !== 'string'
  )
    throw new Error('Strict installation descriptor required');
  const release = await verifyReleaseToken(descriptor.attestation, trust, historical);
  if (release.engineVersion !== ENGINE_VERSION)
    throw new Error('Installer engine compatibility rejected');
  const allowed = new Set(['installation.json', ...release.files.map((f) => f.name)]);
  const walk = (dir: string, prefix = '') => {
    for (const n of readdirSync(dir)) {
      const path = join(dir, n),
        name = prefix + n,
        s = lstatSync(path);
      if (s.isSymbolicLink()) throw new Error('Artifact symlink rejected');
      if (s.isDirectory()) {
        if (name !== 'modules') throw new Error('Unknown artifact directory');
        walk(path, `${name}/`);
      } else if (!allowed.has(name)) throw new Error('Unowned artifact file');
    }
  };
  walk(directory);
  for (const f of release.files) {
    const p = join(directory, f.name),
      s = lstatSync(p);
    if (!s.isFile() || s.isSymbolicLink() || s.size !== f.size || (await fileHash(p)) !== f.digest)
      throw new Error('Missing or substituted installation artifact');
  }
  const module = json(join(directory, 'modules/delivery.json')) as {
    attestation: string;
    request: { profile: unknown };
  };
  const installed = await verifyInstalledModuleRelease(
    module.attestation,
    module.request,
    module.request.profile,
    trust,
    Math.floor(Date.now() / 1000),
  );
  if (
    installed.releaseId !== release.module.releaseId ||
    installed.request.profileDigest !== release.module.profileDigest ||
    installed.request.profile.catalogueDigest !== release.module.catalogueDigest
  )
    throw new Error('Selected module release mismatch');
  const {
    iss: _iss,
    aud: _aud,
    iat: _iat,
    nbf: _nbf,
    exp: _exp,
    ...payload
  } = decodeJwt(module.attestation);
  const evidence = await validateDeliveryEvidence(installed.request, payload);
  for (const [name, digest] of Object.entries({
    'images.tar': evidence.inventory.archiveDigest,
    'source-inventory.json': evidence.inventory.sourceInventoryDigest,
    'artifact-inventory.json': evidence.artifactInventoryDigest,
    NOTICES: evidence.inventory.noticesDigest,
    'README.md': evidence.documentationDigest,
  })) {
    if ((await fileHash(join(directory, 'modules', name))) !== digest)
      throw new Error('Inner selected release file mismatch');
  }
  if (
    hash(JSON.stringify(json(join(directory, 'modules/source-inventory.json'), 16 * 1024 ** 2))) !==
    release.sourceDigest
  )
    throw new Error('Inner source inventory mismatch');
  for (const role of ['turnstile-api', 'turnstile-web'] as const)
    if (
      release.images.find((i) => i.role === role)?.id !==
      `sha256:${evidence.inventory.images.find((i) => i.role === role)?.digest}`
    )
      throw new Error('Selected image inventory mismatch');
  if (installed.request.profile.sourceDigest !== release.sourceDigest)
    throw new Error('Selected source mismatch');
  if (load) await docker.load(join(directory, 'images.tar'));
  for (const image of release.images) {
    const current = await docker.image(image.id);
    if (
      !current ||
      current.Id !== image.id ||
      current.Os !== 'linux' ||
      current.Architecture !== 'amd64'
    )
      throw new Error('Load the exact compatible image inventory before installation');
  }
  return {
    release,
    module: { attestation: module.attestation, request: installed.request },
    installed,
  };
}
