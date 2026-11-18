import { MAX_CATALOGUE_BODY_BYTES } from '../../../contracts/module-catalogues.ts';
import { body, checkOrigin, endpoint, json } from '../../../server/http.ts';
import { executeCatalogue, listCatalogues } from '../../../server/module-service.ts';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return endpoint(async () =>
    json(
      await listCatalogues(request.headers, Object.fromEntries(new URL(request.url).searchParams)),
    ),
  );
}
export function POST(request: Request) {
  return endpoint(async () => {
    checkOrigin(request.headers);
    return json(
      await executeCatalogue(request.headers, await body(request, MAX_CATALOGUE_BODY_BYTES)),
    );
  });
}
