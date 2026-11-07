import { body, json, machineEndpoint } from '../../../../../server/http.ts';
import { rotate } from '../../../../../server/machine-service.ts';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return machineEndpoint(async () =>
    json(await rotate(request.headers, await body(request, 32768))),
  );
}
