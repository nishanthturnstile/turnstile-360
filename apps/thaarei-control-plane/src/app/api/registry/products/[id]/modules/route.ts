import { body, checkOrigin, endpoint, json } from '../../../../../../server/http.ts';
import {
  executeAssignment,
  readAssignment,
} from '../../../../../../server/module-assignment-service.ts';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return endpoint(async () =>
    json(await readAssignment(request.headers, (await context.params).id)),
  );
}
export function POST(request: Request, context: Context) {
  return endpoint(async () => {
    checkOrigin(request.headers);
    return json(
      await executeAssignment(
        request.headers,
        (await context.params).id,
        await body(request, 32768),
      ),
    );
  });
}
