import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorityKeyCommandSchema as schema } from '@thaarei/dms-contracts/private';
import { symmetricEncrypt } from 'better-auth/crypto';
import { generateExportedKeyPair } from 'better-auth/plugins/jwt';
import { withFreshOperatorIdentity, withOperatorRead } from '../access/operator-context.js';
import { captureAuthorityEvent, insertSecurityEvent } from '../audit/security-event.js';
import { createAuthority } from './authority-instance.js';
import { createRecoveryDelivery } from './recovery-delivery.js';

export async function manageSigningKeys(raw: unknown, environment = process.env) {
  const input = schema.parse(raw);
  return withFreshOperatorIdentity(
    environment,
    input,
    async ({ subjectId, admin, authPool, config }) => {
      if (!admin || config.AUTH_MODE !== 'standalone')
        throw new Error('Standalone verified authority administrator required');
      return withOperatorRead(
        environment,
        config.INSTALLATION_TENANT_ID,
        config.INSTALLATION_CUSTOMER_KEY,
        subjectId,
        async (tx) => {
          const auth = createAuthority(config, authPool, createRecoveryDelivery(config));
          const stagedKeyId = input.action === 'stage' ? randomUUID() : null;
          if (input.action !== 'inspect')
            await captureAuthorityEvent(config, {
              action: `authority.keys.${input.action}`,
              actorKind: 'operator',
              actorId: subjectId,
              subjectId: stagedKeyId ?? (input.keyId as string),
              outcome: 'pending',
            });
          const client = await authPool.connect();
          try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
              `authority-key:${config.AUTH_ISSUER_URL}`,
            ]);
            if (input.action === 'stage') {
              await client.query(
                "DELETE FROM auth.jwks WHERE expires_at<clock_timestamp()-interval '24 hours'",
              );
              if (
                (await client.query('SELECT count(*)::integer AS n FROM auth.jwks')).rows[0].n >= 64
              )
                throw new Error('Signing-key retention required');
              const pair = await generateExportedKeyPair({
                jwks: { keyPairConfig: { alg: 'RS256' } },
              });
              const encrypted = await symmetricEncrypt({
                key: (await auth.$context).secretConfig,
                data: JSON.stringify(pair.privateWebKey),
              });
              await client.query(
                'INSERT INTO auth.jwks(id,public_key,private_key,alg,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$5)',
                [
                  stagedKeyId,
                  JSON.stringify(pair.publicWebKey),
                  JSON.stringify(encrypted),
                  'RS256',
                  new Date(),
                ],
              );
            } else if (input.action === 'activate') {
              const row = (
                await client.query(
                  'SELECT id,created_at,expires_at,alg FROM auth.jwks WHERE id=$1 FOR UPDATE',
                  [input.keyId],
                )
              ).rows[0];
              if (row?.alg !== 'RS256') throw new Error('Staged signing key required');
              if (row.expires_at === null) {
                if (
                  (
                    await client.query(
                      'SELECT id FROM auth.jwks WHERE expires_at IS NULL OR expires_at>now() ORDER BY created_at DESC LIMIT 1',
                    )
                  ).rows[0]?.id !== row.id
                )
                  throw new Error('Superseded signing key');
              } else {
                const stamp = (await client.query('SELECT clock_timestamp() AS now')).rows[0]
                  .now as Date;
                if (
                  row.created_at.getTime() !== row.expires_at.getTime() ||
                  stamp.getTime() - row.created_at.getTime() < 60000 ||
                  stamp.getTime() - row.created_at.getTime() > 86400000
                )
                  throw new Error('Signing key prepublication window required');
                await client.query(
                  'UPDATE auth.jwks SET expires_at=clock_timestamp() WHERE id<>$1 AND (expires_at IS NULL OR expires_at>clock_timestamp())',
                  [row.id],
                );
                await client.query('UPDATE auth.jwks SET expires_at=NULL WHERE id=$1', [row.id]);
              }
            }
            // The authority advertises retired keys for 24h; tokens last at most five minutes.
            if (input.action !== 'inspect')
              await client.query(
                "DELETE FROM auth.jwks WHERE expires_at<clock_timestamp()-interval '24 hours'",
              );
            const rows = (
              await client.query(
                'SELECT id,alg,created_at,expires_at FROM auth.jwks ORDER BY created_at DESC LIMIT 64',
              )
            ).rows;
            await client.query('COMMIT');
            await insertSecurityEvent(tx.client, tx.context.tenantId, {
              action: `authority.keys.${input.action}`,
              actorKind: 'operator',
              actorId: subjectId,
              subjectId: stagedKeyId ?? input.keyId ?? tx.context.tenantId,
              outcome: 'success',
            });
            return {
              stagedKeyId,
              activatedKeyId: input.action === 'activate' ? input.keyId : null,
              keys: rows.map((row) => ({
                id: row.id,
                alg: row.alg,
                createdAt: row.created_at.toISOString(),
                expiresAt: row.expires_at?.toISOString() ?? null,
                activateAfter: new Date(row.created_at.getTime() + 60000).toISOString(),
              })),
            };
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }
        },
      );
    },
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let input = '';
    for await (const part of process.stdin) {
      input += part;
      if (Buffer.byteLength(input) > 4096) throw new Error();
    }
    console.log(JSON.stringify(await manageSigningKeys(JSON.parse(input))));
  } catch {
    console.error(
      'Signing-key operation rejected; verify fresh authority/operator proof and staging window',
    );
    process.exitCode = 1;
  }
}
