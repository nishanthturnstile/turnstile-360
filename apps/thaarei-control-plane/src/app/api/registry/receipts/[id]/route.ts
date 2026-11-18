import { endpoint, json } from '../../../../../server/http.ts';
import { getReceipt } from '../../../../../server/registry-service.ts';
export const dynamic = 'force-dynamic';
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => json(await getReceipt(request.headers, (await context.params).id)));
}
