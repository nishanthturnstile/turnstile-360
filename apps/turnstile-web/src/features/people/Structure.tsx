import {
  scopedCommandResultSchema,
  scopedMoveImpactSchema,
  scopedMoveRequestSchema,
  scopedUnitDetailSchema,
  scopedUnitsResponseSchema,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';
import { useEffect, useRef, useState } from 'react';
import { ContentLoading } from '@/components/content-loading';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useUnsavedEntries } from '../configuration/shared';
import { PeopleActivity, usePeopleActivity } from './activity';
import { canReadUnits, message, PeopleError, request } from './client';
import { Pager, Search, usePage } from './shared';
export function ScopedStructure({
  session,
  onCheck,
}: {
  session: UserSessionDto;
  onCheck: (fresh?: boolean) => Promise<boolean>;
}) {
  const active = usePeopleActivity() && canReadUnits(session);
  return (
    <>
      {!active && (
        <Notice message="Unit reading permission is required to view structure. Your unsaved entries are kept on this page." />
      )}
      <PeopleActivity value={active}>
        <div hidden={!active} inert={!active}>
          <Units session={session} onCheck={onCheck} />
        </div>
      </PeopleActivity>
    </>
  );
}
function Units({
  session,
  onCheck,
}: {
  session: UserSessionDto;
  onCheck: (fresh?: boolean) => Promise<boolean>;
}) {
  const [search, setSearch] = useState(''),
    [cursors, setCursors] = useState<string[]>([]),
    [selected, setSelected] = useState<{
      id: string;
      snapshot: ReturnType<typeof scopedUnitsResponseSchema.parse>;
    }>();
  const page = usePage(
    `/api/structure/units?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}${cursors.length ? `&cursor=${encodeURIComponent(cursors.at(-1) ?? '')}` : ''}`,
    scopedUnitsResponseSchema,
    session.access?.fingerprint,
  );
  return (
    <>
      <Search
        onChange={(s) => {
          setSearch(s);
          setCursors([]);
        }}
      />
      {page.loading && <ContentLoading label="Loading authorized structure…" />}
      {!!page.failure && <Notice message={message(page.failure)} />}
      <Button variant="outline" onClick={page.refresh}>
        Reload structure
      </Button>
      {page.value && (
        <>
          <p className="text-sm text-muted-foreground">
            Only authorized units are actionable. Ancestors supply path context.
          </p>
          {page.value.units.map((u) => {
            const labels = new Map(
              [...(page.value?.units ?? []), ...(page.value?.ancestors ?? [])].map((x) => [
                x.id,
                x.name,
              ]),
            );
            return (
              <Card key={u.id}>
                <CardHeader>
                  <CardTitle>
                    <h2 className="break-words">{u.name}</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="break-words">
                    {u.ancestorIds.map((id) => labels.get(id) ?? id).join(' / ')} / {u.name}
                  </p>
                  <Button
                    className="max-w-full"
                    variant="outline"
                    disabled={!!selected}
                    onClick={() => page.value && setSelected({ id: u.id, snapshot: page.value })}
                  >
                    <span className="truncate">Manage {u.name}</span>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
          <Pager
            total={page.value.total}
            next={page.value.nextCursor}
            previous={!!cursors.length}
            onNext={() => setCursors((c) => [...c, page.value?.nextCursor ?? ''])}
            onPrevious={() => setCursors((c) => c.slice(0, -1))}
          />
        </>
      )}
      {selected && (
        <UnitEditor
          key={selected.id}
          id={selected.id}
          snapshot={selected.snapshot}
          session={session}
          saved={async () => {
            setSelected(undefined);
            if (await onCheck(true)) page.refresh();
          }}
          close={() => setSelected(undefined)}
        />
      )}
    </>
  );
}
function UnitEditor({
  id,
  snapshot: initialSnapshot,
  session,
  saved,
  close,
}: {
  id: string;
  snapshot: ReturnType<typeof scopedUnitsResponseSchema.parse>;
  session: UserSessionDto;
  saved: () => Promise<void>;
  close: () => void;
}) {
  const active = usePeopleActivity();
  const [snapshot] = useState(initialSnapshot);
  const unit = snapshot.units.find((u) => u.id === id);
  const [name, setName] = useState(unit?.name ?? ''),
    [parent, setParent] = useState(id),
    [type, setType] = useState('department');
  const [failure, setFailure] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false);
  const [observed, setObserved] = useState(false);
  const [draft, setDraft] = useState<{
    path: string;
    method: string;
    body: unknown;
    key: string;
  }>();
  const [impact, setImpact] = useState<ReturnType<typeof scopedMoveImpactSchema.parse>>();
  const clean = useUnsavedEntries(true);
  const versions = {
    expectedAccessRevision: snapshot.accessRevision,
    expectedOrganizationRevision: snapshot.revision,
  };
  const context = `${active}:${session.access?.fingerprint}:${session.csrfToken}`;
  const previousContext = useRef(context);
  useEffect(() => {
    if (previousContext.current === context) return;
    previousContext.current = context;
    setImpact(undefined);
    // Uncertain commands retain their key/body and must still use current-state readback.
    if (!unknown) setDraft(undefined);
  }, [context, unknown]);
  async function propose(kind: 'rename' | 'create' | 'delete' | 'move') {
    if (!active || busy) return;
    setBusy(true);
    setFailure(undefined);
    setImpact(undefined);
    const body =
      kind === 'rename'
        ? { ...versions, name }
        : kind === 'create'
          ? { ...versions, name, type, parentId: parent }
          : kind === 'delete'
            ? versions
            : { command: { ...versions, id, parentId: parent }, confirmation: null };
    const action: { path: string; method: string; body: unknown; key: string } = {
      path:
        kind === 'create'
          ? '/api/structure/units'
          : `/api/structure/units/${id}${kind === 'move' ? '/parent' : ''}`,
      method: kind === 'create' ? 'POST' : kind === 'delete' ? 'DELETE' : 'PATCH',
      body,
      key: crypto.randomUUID(),
    };
    try {
      if (kind === 'move') {
        const preview = await request('/api/structure/move-impact', scopedMoveImpactSchema, {
          method: 'POST',
          csrf: session.csrfToken,
          body: { ...versions, id, parentId: parent },
        });
        setImpact(preview);
        action.body = {
          command: { ...versions, id, parentId: parent },
          confirmation: preview.confirmation,
        };
      }
      setDraft(action);
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!active || busy || !draft) return;
    setBusy(true);
    try {
      await request(draft.path, scopedCommandResultSchema, {
        method: draft.method,
        csrf: session.csrfToken,
        key: draft.key,
        body: draft.body,
      });
    } catch (e) {
      setUnknown(!(e instanceof PeopleError) || (e.status >= 500 && e.reason !== 'readiness'));
      setObserved(false);
      if (e instanceof PeopleError && (e.status < 500 || e.reason === 'readiness')) {
        setDraft(undefined);
        setImpact(undefined);
      }
      setFailure(e);
      return;
    } finally {
      setBusy(false);
    }
    // The mutation is confirmed. A failed context reload cannot make it uncertain.
    clean();
    await saved();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="break-words">Manage {unit?.name}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!!failure && <Notice message={message(failure)} />}
        <FieldSet disabled={busy || unknown || !!draft}>
          <Field>
            <FieldLabel htmlFor="unit-name">Unit name</FieldLabel>
            <Input
              id="unit-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDraft(undefined);
              }}
            />
          </Field>
          <ParentChoice snapshot={snapshot} session={session} value={parent} onChange={setParent} />
          <Field>
            <FieldLabel htmlFor="unit-type">New unit type</FieldLabel>
            <NativeSelect id="unit-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="department">Department</option>
              <option value="site">Site / Plant</option>
            </NativeSelect>
          </Field>
        </FieldSet>
        <p>
          All operations are checked against current unit and relationship permissions. A context
          ancestor does not grant management access.
        </p>
        {unknown && draft ? (
          <>
            <p>
              The result is uncertain. Read current command status before making another change.
            </p>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void request(`/api/structure/commands/${draft.key}`, scopedCommandResultSchema)
                  .then(() => {
                    clean();
                    return saved();
                  })
                  .catch(setFailure)
                  .finally(() => setBusy(false));
              }}
            >
              Check command status
            </Button>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => {
                setBusy(true);
                void (async () => {
                  const current = await request(
                    `/api/structure/units/${id}`,
                    scopedUnitDetailSchema,
                  );
                  setObserved(true);
                  if (
                    current.revision !== snapshot.revision ||
                    current.accessRevision !== snapshot.accessRevision
                  )
                    throw new PeopleError(409, 'STRUCTURE_CONFLICT', 'revision');
                  if (draft.path.endsWith('/parent')) {
                    const command = scopedMoveRequestSchema.parse(draft.body).command;
                    const preview = await request(
                      '/api/structure/move-impact',
                      scopedMoveImpactSchema,
                      {
                        method: 'POST',
                        csrf: session.csrfToken,
                        body: command,
                      },
                    );
                    setImpact(preview);
                    setDraft({ ...draft, body: { command, confirmation: preview.confirmation } });
                  }
                  setFailure(undefined);
                  setUnknown(false);
                })()
                  .catch(setFailure)
                  .finally(() => setBusy(false));
              }}
            >
              Read current state and review the same command
            </Button>
            <p className="text-sm text-muted-foreground">
              Compare the reloaded structure with this draft. Confirmation keeps the same command
              key; nothing is replayed automatically.
            </p>
          </>
        ) : draft ? (
          <>
            <h3 className="section-title">
              Confirm {draft.method === 'DELETE' ? 'deletion' : 'structure change'}
            </h3>
            {impact && (
              <p>
                {impact.affectedMemberCount} members and {impact.affectedInvitationCount}{' '}
                invitations affected.{' '}
                {impact.accessChanges ? 'Access will change.' : 'Access coverage is unchanged.'}
              </p>
            )}
            <Button
              disabled={busy || !!(impact && Date.parse(impact.expiresAt) <= Date.now())}
              onClick={() => void save()}
            >
              Confirm and save
            </Button>
            <Button disabled={busy} variant="outline" onClick={() => setDraft(undefined)}>
              Back to draft
            </Button>
          </>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy} onClick={() => void propose('rename')}>
              Review rename
            </Button>
            <Button disabled={busy} onClick={() => void propose('create')}>
              Review new unit
            </Button>
            <Button disabled={busy || parent === id} onClick={() => void propose('move')}>
              Review move
            </Button>
            <Button disabled={busy} variant="destructive" onClick={() => void propose('delete')}>
              Review deletion
            </Button>
          </div>
        )}
        <Button
          disabled={busy || (unknown && !observed)}
          variant="outline"
          onClick={() => {
            clean();
            close();
          }}
        >
          Cancel
        </Button>
      </CardContent>
    </Card>
  );
}

function ParentChoice({
  snapshot,
  session,
  value,
  onChange,
}: {
  snapshot: ReturnType<typeof scopedUnitsResponseSchema.parse>;
  session: UserSessionDto;
  value: string;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const page = usePage(
    `/api/structure/units?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    scopedUnitsResponseSchema,
    session.access?.fingerprint,
  );
  const [retained, setRetained] = useState(snapshot);
  const rows = new Map(
    [
      ...snapshot.ancestors,
      ...snapshot.units,
      ...retained.ancestors,
      ...retained.units,
      ...(page.value?.ancestors ?? []),
      ...(page.value?.units ?? []),
    ].map((u) => [u.id, u]),
  );
  return (
    <div className="flex flex-col gap-3">
      <Search
        onChange={(q) => {
          setSearch(q);
          setCursor(null);
        }}
      />
      {!!page.failure && <Notice message={message(page.failure)} />}
      <Field>
        <FieldLabel htmlFor="unit-parent">Parent for new unit or move destination</FieldLabel>
        <NativeSelect
          id="unit-parent"
          className="max-w-full"
          value={value}
          onChange={(e) => {
            setRetained(page.value ?? snapshot);
            onChange(e.target.value);
          }}
        >
          {[...rows.values()].map((u) => (
            <option key={u.id} value={u.id}>
              {'ancestorIds' in u
                ? [...u.ancestorIds.map((a) => rows.get(a)?.name ?? a), u.name].join(' / ')
                : `${u.name} (path context)`}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {page.value?.nextCursor && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setCursor(page.value?.nextCursor ?? null)}
        >
          More destinations
        </Button>
      )}
      <p className="text-sm text-muted-foreground">
        New units use this parent. Moves require a different destination. Context alone does not
        permit either operation.
      </p>
    </div>
  );
}
