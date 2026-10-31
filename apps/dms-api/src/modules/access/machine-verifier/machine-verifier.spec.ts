import { randomUUID } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { verifyMachineToken } from './machine-verifier.service.js';

describe('machine JWT trust boundary', () => {
  it('accepts the pinned machine profile and rejects signature, identity, audience, lifetime and credential-type confusion', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const keys = createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), kid: 'fixture-key', alg: 'RS256' }],
    });
    const issuer = 'http://localhost/identity';
    const audience = 'http://localhost/v1';
    const now = Math.floor(Date.now() / 1000);
    const base = {
      iss: issuer,
      aud: audience,
      sub: 'machine-client',
      client_id: 'machine-client',
      scope: 'dms:capabilities:read',
      iat: now,
      exp: now + 300,
      jti: randomUUID(),
    };
    const sign = (claims: JWTPayload = {}, type = 'at+jwt') =>
      new SignJWT({ ...base, ...claims })
        .setProtectedHeader({ alg: 'RS256', typ: type, kid: 'fixture-key' })
        .sign(privateKey);
    expect((await verifyMachineToken(await sign(), keys, issuer, audience)).clientId).toBe(
      'machine-client',
    );
    await expect(
      verifyMachineToken(await sign({ iat: now - 20, exp: now - 1 }), keys, issuer, audience),
    ).rejects.toMatchObject({ response: { code: 'MACHINE_TOKEN_EXPIRED' }, status: 401 });
    for (const claims of [
      { iss: 'https://untrusted.test' },
      { aud: 'userinfo' },
      { aud: [audience, 'another-resource'] },
      { exp: now - 1 },
      { exp: now + 600 },
      { iat: now + 60 },
      { client_id: 'different-client' },
      { sid: 'user-session' },
      { cnf: { jkt: 'unsupported-dpop' } },
      { scope: 'dms:admin' },
    ]) {
      await expect(
        verifyMachineToken(await sign(claims), keys, issuer, audience),
      ).rejects.toThrow();
    }
    await expect(
      verifyMachineToken(await sign({}, 'JWT'), keys, issuer, audience),
    ).rejects.toThrow();
    const good = await sign();
    const parts = good.split('.');
    parts[2] = `${parts[2]?.[0] === 'A' ? 'B' : 'A'}${parts[2]?.slice(1)}`;
    await expect(verifyMachineToken(parts.join('.'), keys, issuer, audience)).rejects.toThrow();
    const symmetric = await new SignJWT(base)
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid: 'fixture-key' })
      .sign(new TextEncoder().encode('test-only-symmetric-key-with-thirty-two-characters'));
    await expect(verifyMachineToken(symmetric, keys, issuer, audience)).rejects.toThrow();
  });
});
