import { HttpException } from '@nestjs/common';

export class AccessContextChangedException extends HttpException {
  constructor(requestId: string, accessRevision: number) {
    super({ code: 'ACCESS_CONTEXT_CHANGED', requestId, reason: 'state', accessRevision }, 409);
  }
}
