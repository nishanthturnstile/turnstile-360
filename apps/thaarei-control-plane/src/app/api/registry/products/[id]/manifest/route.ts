import { z } from 'zod';
import { endpoint, json } from '../../../../../../server/http.ts';
import { setupExport } from '../../../../../../server/machine-service.ts';
export const dynamic = 'force-dynamic';
export function GET(
  request: Request,
  context: RouteContext<'/api/registry/products/[id]/manifest'>,
) {
  return endpoint(async () =>
    json(
      await setupExport(request.headers, z.uuid().parse((await context.params).id)),
      200,
      new Headers({ 'content-disposition': 'attachment; filename=deployment-manifest.json' }),
    ),
  );
}
