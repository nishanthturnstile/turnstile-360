import 'server-only';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { origin } from '@thaarei/control-plane-contracts';
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { z } from 'zod';
import { protectedSecret } from './config.ts';
import { digest } from './machine-signing.ts';

async function main() {
  // Private, uncached maintenance command. Never expose through a route or browser bundle.
  const env = z
    .object({
      CONTROL_PLANE_MIGRATION_DATABASE_URL: z.string().url(),
      CONTROL_PLANE_RECOVERY_MARKER_FILE: z.string(),
      CONTROL_PLANE_SIGNING_KEY_FILE: z.string(),
      CONTROL_PLANE_PUBLIC_KEYS_OUTPUT_FILE: z.string(),
      CONTROL_PLANE_PUBLIC_ORIGIN: origin,
    })
    .parse(process.env);
  if (new URL(env.CONTROL_PLANE_MIGRATION_DATABASE_URL).username !== 'control_plane_migrator')
    throw new Error('Dedicated central migrator required');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1024) throw new Error('Input too large');
  }
  const command = z
    .object({
      action: z.enum(['initialize', 'reconcile', 'prepare-signing-key']),
      reason: z.string().trim().min(1).max(300),
    })
    .strict()
    .parse(JSON.parse(input));
  if (command.action === 'prepare-signing-key' || command.action === 'initialize') {
    for (const path of [
      env.CONTROL_PLANE_SIGNING_KEY_FILE,
      env.CONTROL_PLANE_PUBLIC_KEYS_OUTPUT_FILE,
    ])
      if (!isAbsolute(path)) throw new Error('Absolute protected output required');
    const { privateKey, publicKey } = await generateKeyPair('RS256', {
      modulusLength: 3072,
      extractable: true,
    });
    const kid = randomUUID();
    await writeFile(
      env.CONTROL_PLANE_SIGNING_KEY_FILE,
      JSON.stringify({ kid, privateKey: await exportPKCS8(privateKey) }),
      { flag: 'wx', mode: 0o600 },
    );
    await writeFile(
      env.CONTROL_PLANE_PUBLIC_KEYS_OUTPUT_FILE,
      JSON.stringify({
        version: 1,
        revision: 1,
        issuer: env.CONTROL_PLANE_PUBLIC_ORIGIN,
        keys: [{ kid, pem: await exportSPKI(publicKey), status: 'active', lastIssuedAt: null }],
      }),
      { flag: 'wx', mode: 0o600 },
    );
  }
  if (command.action !== 'prepare-signing-key') {
    const marker = digest(protectedSecret(env.CONTROL_PLANE_RECOVERY_MARKER_FILE));
    const pool = new Pool({ connectionString: env.CONTROL_PLANE_MIGRATION_DATABASE_URL, max: 1 });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(860021)');
      if (command.action === 'initialize')
        await db.query(
          'INSERT INTO control_plane.machine_authority(slot,marker_digest) VALUES(1,$1)',
          [marker],
        );
      else {
        // A central restore never trusts restored approvals/cached credentials. Staff must
        // pair a fresh epoch and explicitly approve again after this protected reconciliation.
        await db.query('SELECT id FROM control_plane.registry_product ORDER BY id FOR UPDATE');
        await db.query(
          "UPDATE control_plane.registry_product SET policy_state=CASE WHEN policy_state='approved' THEN 'suspended' ELSE policy_state END,revision=revision+1,pairing_verified_at=NULL,policy_reason=$1,policy_changed_at=clock_timestamp()",
          [command.reason],
        );
        await db.query(
          'UPDATE control_plane.machine SET revoked_at=clock_timestamp(),current_acknowledged_at=NULL',
        );
        await db.query(
          'UPDATE control_plane.pairing SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL',
        );
        await db.query('UPDATE control_plane.machine_authority SET marker_digest=$1 WHERE slot=1', [
          marker,
        ]);
        await db.query(
          "INSERT INTO control_plane.staff_audit(id,actor_id,subject_id,action,reason,details) VALUES($1,'private-operator','machine-authority','machine.restore-reconciled',$2,$3)",
          [randomUUID(), command.reason, JSON.stringify({ productsRequireFreshPairing: true })],
        );
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
      await pool.end();
    }
  }
  console.log(
    'Private machine authority operation completed; distribute public trust through the protected operator channel.',
  );
}
main().catch(() => {
  console.error(
    'Private machine authority operation failed; preserve protected files and inspect the saved outcome before retrying.',
  );
  process.exitCode = 1;
});
