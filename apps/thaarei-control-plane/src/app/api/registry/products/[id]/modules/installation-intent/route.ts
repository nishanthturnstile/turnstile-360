import { body, checkOrigin, endpoint, json } from '../../../../../../../server/http.ts';
import { issueInstallationIntent } from '../../../../../../../server/installation-intent-service.ts';
export const dynamic = 'force-dynamic';
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    checkOrigin(request.headers);
    return json(
      await issueInstallationIntent(
        request.headers,
        (await context.params).id,
        await body(request, 8192),
      ),
    );
  });
}
