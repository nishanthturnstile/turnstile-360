import { body, checkOrigin, endpoint, json } from '../../../server/http.ts';
import { executeRegistry } from '../../../server/registry-service.ts';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return endpoint(async () => {
    checkOrigin(request.headers);
    return json(await executeRegistry(request.headers, await body(request)));
  });
}
