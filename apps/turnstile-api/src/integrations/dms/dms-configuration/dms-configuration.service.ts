import { Injectable } from '@nestjs/common';
import { parseMachineEnvironment } from '../../../infrastructure/auth-environment.js';

@Injectable()
export class DmsConfigurationService {
  readonly config: ReturnType<typeof parseMachineEnvironment> | undefined;
  readonly configurationError: string | undefined;

  constructor() {
    try {
      this.config = parseMachineEnvironment(process.env);
    } catch (error) {
      this.configurationError =
        error instanceof Error ? error.message : 'Invalid DMS configuration';
    }
  }
}
