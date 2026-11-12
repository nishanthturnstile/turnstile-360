import { body, json, machineEndpoint } from '../../../../../server/http.ts';
import { machineStatus } from '../../../../../server/machine-service.ts';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return machineEndpoint(async () =>
    json(await machineStatus(request.headers, await body(request, 4096))),
  );
}
