import { body, endpoint, json } from '../../../../server/http.ts';
import { installationIntentStatus } from '../../../../server/installation-intent-service.ts';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return endpoint(async () => json(await installationIntentStatus(await body(request, 20000))));
}
