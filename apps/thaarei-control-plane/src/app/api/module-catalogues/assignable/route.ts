import { endpoint, json } from '../../../../server/http.ts';
import { listAssignmentCatalogues } from '../../../../server/module-assignment-service.ts';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return endpoint(async () =>
    json(
      await listAssignmentCatalogues(
        request.headers,
        Object.fromEntries(new URL(request.url).searchParams),
      ),
    ),
  );
}
