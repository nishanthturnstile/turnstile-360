import { endpoint, json } from '../../../../../server/http.ts';
import { reportHistory } from '../../../../../server/report-service.ts';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () =>
    json(
      await reportHistory(
        request.headers,
        (await context.params).id,
        Object.fromEntries(new URL(request.url).searchParams),
      ),
    ),
  );
}
