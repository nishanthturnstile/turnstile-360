import { endpoint, json } from '../../../server/http.ts';
import { listReports } from '../../../server/report-service.ts';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return endpoint(async () =>
    json(await listReports(request.headers, Object.fromEntries(new URL(request.url).searchParams))),
  );
}
