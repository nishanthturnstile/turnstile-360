import { endpoint, json } from '../../../server/http.ts';
import { runtime } from '../../../server/runtime.ts';
export const dynamic = 'force-dynamic';
export function GET() {
  return endpoint(async () => {
    await runtime().pool.query('SELECT user_id FROM control_plane.staff LIMIT 1');
    await runtime().pool.query('SELECT id FROM control_plane.registry_client LIMIT 1');
    await runtime().pool.query('SELECT slot FROM control_plane.machine_authority LIMIT 1');
    await runtime().pool.query('SELECT id FROM control_plane.module_code LIMIT 1');
    await runtime().pool.query('SELECT id FROM control_plane.module_catalogue LIMIT 1');
    await runtime().pool.query('SELECT id FROM control_plane.module_assignment_entry LIMIT 1');
    await runtime().pool.query(
      'SELECT product_id FROM control_plane.module_assignment_state LIMIT 1',
    );
    return json({ status: 'ready' });
  });
}
