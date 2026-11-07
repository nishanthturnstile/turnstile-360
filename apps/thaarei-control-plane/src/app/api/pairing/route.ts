import { body, checkOrigin, endpoint, json } from '../../../server/http.ts';
import { executePairing } from '../../../server/machine-service.ts';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return endpoint(async () => {
    checkOrigin(request.headers);
    return json(await executePairing(request.headers, await body(request)));
  });
}
