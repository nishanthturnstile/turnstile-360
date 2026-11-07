import { body, json, machineEndpoint } from '../../../../../server/http.ts';
import { activate } from '../../../../../server/machine-service.ts';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return machineEndpoint(async () => json(await activate(await body(request, 32768))));
}
