import { Injectable } from '@nestjs/common';
import { parseProductEnvironment } from '../../../infrastructure/auth-environment.js';

@Injectable()
export class AuthConfigurationService {
  readonly config: ReturnType<typeof parseProductEnvironment> | undefined;
  readonly configurationError: string | undefined;

  constructor() {
    try {
      this.config = parseProductEnvironment(process.env);
    } catch (error) {
      this.configurationError =
        error instanceof Error ? error.message : 'Invalid auth configuration';
    }
  }
}
