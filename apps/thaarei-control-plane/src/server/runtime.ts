import 'server-only';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createTransport } from 'nodemailer';
import { Pool } from 'pg';
import * as schema from './auth.generated.ts';
import { authOptions } from './auth-options.ts';
import { parseConfig } from './config.ts';

function createRuntime() {
  const config = parseConfig(process.env);
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
  });
  // Never log database URLs, auth tokens, email destinations or raw errors.
  pool.on('error', () => console.error('Control-plane database connection unavailable'));
  const smtp = new URL(config.smtpUrl);
  const mail = createTransport({
    host: smtp.hostname,
    port: Number(smtp.port || (smtp.protocol === 'smtps:' ? 465 : 587)),
    secure: smtp.protocol === 'smtps:',
    requireTLS: config.production,
    ...(smtp.username
      ? {
          auth: {
            user: decodeURIComponent(smtp.username),
            pass: decodeURIComponent(smtp.password),
          },
        }
      : {}),
    tls: { rejectUnauthorized: true },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });
  const auth = betterAuth({
    ...authOptions(
      config,
      async (to, subject, url) => {
        await mail.sendMail({
          from: config.smtpFrom,
          to,
          subject,
          text: `${subject}\n\n${url}\n\nIf you did not request this, contact your administrator.`,
        });
      },
      () => mail.verify(),
    ),
    database: drizzleAdapter(drizzle({ client: pool, schema }), {
      provider: 'pg',
      schemaName: 'control_plane',
      schema,
      transaction: true,
    }),
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const member = await pool.query(
              'SELECT 1 FROM control_plane.staff WHERE user_id=$1 AND active',
              [session.userId],
            );
            if (!member.rowCount)
              throw new APIError('UNAUTHORIZED', { message: 'Access unavailable' });
            return { data: session };
          },
        },
      },
    },
  });
  return { config, pool, auth };
}
type Runtime = ReturnType<typeof createRuntime>;
const state = globalThis as typeof globalThis & { centralRuntime?: Runtime };
export function runtime(): Runtime {
  state.centralRuntime ??= createRuntime();
  return state.centralRuntime;
}
