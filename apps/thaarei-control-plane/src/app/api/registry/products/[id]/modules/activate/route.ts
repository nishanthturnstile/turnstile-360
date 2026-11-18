import { z } from 'zod';
import { body, checkOrigin, endpoint, json } from '../../../../../../../server/http.ts';
import { activateModules } from '../../../../../../../server/module-transition-service.ts';
export const dynamic = 'force-dynamic';
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    checkOrigin(request.headers);
    return json(
      await activateModules(
        request.headers,
        z.uuid().parse((await context.params).id),
        await body(request, 16384),
      ),
    );
  });
}
