import { handleAuth } from '../../../../server/auth-http.ts';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return handleAuth(request, (await context.params).path.join('/'));
}
export const POST = GET;
