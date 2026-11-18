import { endpoint, json } from '../../../../server/http.ts';
import { listClients } from '../../../../server/registry-service.ts';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return endpoint(async () =>
    json(await listClients(request.headers, Object.fromEntries(new URL(request.url).searchParams))),
  );
}
