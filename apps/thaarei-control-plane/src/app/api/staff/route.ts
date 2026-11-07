import { body, checkOrigin, endpoint, json } from '../../../server/http.ts';
import { admitStaff, changeStaff, listStaff } from '../../../server/staff-service.ts';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return endpoint(async () => json(await listStaff(request.headers)));
}
export async function POST(request: Request) {
  return endpoint(async () => {
    checkOrigin(request.headers);
    return json(await admitStaff(request.headers, await body(request)), 201);
  });
}
export async function PATCH(request: Request) {
  return endpoint(async () => {
    checkOrigin(request.headers);
    return json(await changeStaff(request.headers, await body(request)));
  });
}
