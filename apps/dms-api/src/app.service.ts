import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getApplicationInfo(): { name: string } {
    return { name: 'Thaarei DMS API' };
  }
}
