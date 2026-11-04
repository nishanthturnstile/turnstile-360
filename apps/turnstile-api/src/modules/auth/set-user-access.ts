import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accessAssignmentSchema,
  CONFIGURATION_LIMITS,
  TURNSTILE_PERMISSIONS,
} from '@thaarei/turnstile-contracts';
import { withProductOperator } from '../../infrastructure/database/product-operator.js';
import { AccessInvariantError, replaceLegacyAccess } from '../access/access-transactions.js';

// Private replacement command. Canonical initialization is required; recovery
// inventory is never read or written as an independent live authority source.
export async function setUserAccess(input: unknown, environment = process.env) {
  const value = accessAssignmentSchema.parse(input);
  const permissions = TURNSTILE_PERMISSIONS.filter((permission) =>
    value.permissions.includes(permission),
  );
  return withProductOperator(environment, async (client, installation) => {
    const result = await replaceLegacyAccess(client, installation.tenant_id, {
      ...value,
      permissions,
    });
    return {
      action: 'set-user-access',
      at: new Date().toISOString(),
      tenantId: installation.tenant_id,
      applicationId: installation.application_id,
      ...value,
      permissions,
      ...result,
    };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.stdin.isTTY || process.argv.length !== 2)
      throw new Error('Supply private JSON input');
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > CONFIGURATION_LIMITS.bodyBytes)
        throw new Error('Input too large');
    }
    console.log(JSON.stringify(await setUserAccess(JSON.parse(input))));
  } catch (error) {
    if (error instanceof AccessInvariantError) {
      console.error(JSON.stringify({ code: error.code }));
      process.exitCode = 2;
    } else {
      console.error(
        'Product access assignment failed; check private input, initialized installation and dedicated operator connection',
      );
      process.exitCode = 1;
    }
  }
}
