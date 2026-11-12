import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/server/auth.generated.ts',
    './src/server/staff.schema.ts',
    './src/server/registry.schema.ts',
    './src/server/machine.schema.ts',
    './src/server/report.schema.ts',
    './src/server/module.schema.ts',
    './src/server/module-assignment.schema.ts',
  ],
  out: './database',
});
