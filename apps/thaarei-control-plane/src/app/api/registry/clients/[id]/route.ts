import { endpoint, json } from '../../../../../server/http.ts';
import { getClient } from '../../../../../server/registry-service.ts';
export const dynamic = 'force-dynamic';
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => json(await getClient(request.headers, (await context.params).id)));
}
