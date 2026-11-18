import { endpoint, json } from '../../../../server/http.ts';
import { exportBuildPlan, readCatalogue } from '../../../../server/module-service.ts';
export const dynamic = 'force-dynamic';
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const { id } = await context.params;
    return json(
      new URL(request.url).searchParams.get('buildPlan') === '1'
        ? await exportBuildPlan(request.headers, id)
        : await readCatalogue(request.headers, id),
    );
  });
}
