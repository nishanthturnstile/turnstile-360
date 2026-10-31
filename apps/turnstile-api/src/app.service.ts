import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getApplicationInfo(): { name: string } {
    return { name: 'Turnstile 360 API' };
  }
}
