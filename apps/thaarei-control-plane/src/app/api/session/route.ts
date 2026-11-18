import { requireStaff } from '../../../server/access.ts';
import { endpoint, json } from '../../../server/http.ts';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(async () => json(await requireStaff(request.headers)));
}
