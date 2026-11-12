import { body, checkOrigin, endpoint, json } from '../../../../../../../server/http.ts';
import { enforceModuleVersion } from '../../../../../../../server/module-enforcement-service.ts';
export const dynamic = 'force-dynamic';
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    checkOrigin(request.headers);
    return json(
      await enforceModuleVersion(
        request.headers,
        (await context.params).id,
        await body(request, 4096),
      ),
    );
  });
}
