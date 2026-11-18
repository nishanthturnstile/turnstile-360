import type { extractionUnitSchema } from '@thaarei/dms-contracts/public';
import type { z } from 'zod';
import type { CoordinatorTx } from './work-state.js';
// Staged alongside immutable acceptance; only the run's final promoted stage is visible.
export async function stageSearchIndex(
  tx: CoordinatorTx,
  runId: string | null,
  stageId: string,
  units: z.infer<typeof extractionUnitSchema>[],
  incomplete = false,
) {
  if (!runId) return;
  const chunks: { unitId: string; kind: string; source: unknown; text: string }[] = [];
  let partial = incomplete || units.some((unit) => !['TEXT', 'EMPTY'].includes(unit.state));
  for (const unit of units) {
    if (unit.state === 'OMITTED' || !unit.text) continue;
    if (unit.state !== 'TEXT') partial = true;
    const text = Buffer.from(unit.text, 'utf8').toString('utf8').replaceAll('\0', '');
    if (text !== unit.text) partial = true;
    const characters = Array.from(text);
    for (let offset = 0; offset < characters.length; offset += 4096) {
      if (chunks.length === 8192) {
        partial = true;
        break;
      }
      chunks.push({
        unitId: unit.id,
        kind: unit.kind,
        source: unit.source,
        text: characters.slice(offset, offset + 4096).join(''),
      });
    }
    if (chunks.length === 8192) {
      partial = true;
      break;
    }
  }
  await tx.client.query(
    'INSERT INTO dms.search_generation(stage_id,tenant_id,run_id,status) VALUES($1,$2,$3,$4)',
    [stageId, tx.context.tenantId, runId, partial ? 'PARTIAL' : 'READY'],
  );
  // Batches bound parameter/JSON allocation independently from the complete artifact.
  for (let start = 0; start < chunks.length; start += 128)
    await tx.client.query(
      `INSERT INTO dms.search_chunk(stage_id,tenant_id,ordinal,unit_id,kind,source,text) SELECT $1,$2,$4::integer+(x.n-1)::integer,x.v->>'unitId',x.v->>'kind',x.v->'source',x.v->>'text' FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY x(v,n)`,
      [stageId, tx.context.tenantId, JSON.stringify(chunks.slice(start, start + 128)), start],
    );
}
