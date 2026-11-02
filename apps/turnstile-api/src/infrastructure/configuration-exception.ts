import { HttpException } from '@nestjs/common';
import {
  CONFIGURATION_ERROR_STATUS,
  type ConfigurationErrorDto,
  configurationErrorSchema,
} from '@thaarei/turnstile-contracts';

// Shared HTTP adapter for the upcoming feature handlers; never accepts raw validation issues.
export class ConfigurationException extends HttpException {
  constructor(error: ConfigurationErrorDto) {
    const safe = configurationErrorSchema.parse(error);
    super(safe, CONFIGURATION_ERROR_STATUS[safe.code]);
  }
}
