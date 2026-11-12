import { endpoint, json } from '../../../../../server/http.ts';
import { readCode } from '../../../../../server/module-service.ts';
export const dynamic = 'force-dynamic';
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => json(await readCode(request.headers, (await context.params).id)));
}
