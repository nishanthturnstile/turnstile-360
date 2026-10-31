import { existsSync } from 'node:fs';
import { z } from 'zod';
import { createApplication } from './bootstrap.js';

if (existsSync('.env')) process.loadEnvFile();

const environment = z
  .object({
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  })
  .parse(process.env);

const app = await createApplication();
await app.listen(environment.PORT, environment.HOST);
