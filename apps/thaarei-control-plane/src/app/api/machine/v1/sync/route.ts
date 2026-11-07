import { body, json, machineEndpoint } from '../../../../../server/http.ts';
import { sync } from '../../../../../server/machine-service.ts';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return machineEndpoint(async () => json(await sync(request.headers, await body(request, 32768))));
}
