import { HttpException } from '@nestjs/common';
import type { AuthErrorCode } from '@thaarei/turnstile-contracts/runtime';

export function authError(status: number, code: AuthErrorCode): never {
  throw new HttpException({ code }, status);
}
