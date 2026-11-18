import { endpoint } from '../../../../../../../server/http.ts';
import { exportDeliveryRequest } from '../../../../../../../server/module-assignment-service.ts';
export const dynamic = 'force-dynamic';
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(
    async () =>
      new Response(
        JSON.stringify(await exportDeliveryRequest(request.headers, (await context.params).id)),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Content-Disposition': 'attachment; filename="turnstile-module-build-request.json"',
          },
        },
      ),
  );
}
