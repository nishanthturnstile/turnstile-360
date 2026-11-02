import { configurationValidationError } from '@thaarei/turnstile-contracts';
import type { z } from 'zod';
import { ConfigurationException } from './configuration-exception.js';

export function parseConfiguration<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new ConfigurationException(configurationValidationError(result.error));
  return result.data;
}
