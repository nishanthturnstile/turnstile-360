import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  organizationResponseSchema,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useUnsavedEntries } from '../configuration/shared';
import { AccessEmpty, AccessInspector, Reload, StructureOutline } from './AccessViews';
import { PeopleActivity, usePeopleActivity } from './activity';
import { canManageUnit, canReadUnits, company, message, PeopleError, request } from './client';
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
  const [view, setView] = useState('outline');
  const [search, setSearch] = useState(''),
    [cursors, setCursors] = useState<string[]>([]),
    [selected, setSelected] = useState<{
      id: string;
      editable: boolean;
      snapshot: ReturnType<typeof scopedUnitsResponseSchema.parse>;
    }>();
  const page = usePage(
    `/api/structure/units?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}${cursors.length ? `&cursor=${encodeURIComponent(cursors.at(-1) ?? '')}` : ''}`,
    scopedUnitsResponseSchema,
    session.access?.fingerprint,
  );
  const root = page.value?.ancestors.find((u) => u.type === 'organization');
  const companyManager =
    company(session, 'turnstile:configuration:manage') ||
    company(session, 'turnstile:units:manage');
  const canManage = (id: string) => {
    if (id === root?.id) return companyManager;
    const unit =
      page.value?.units.find((u) => u.id === id) ??
      selected?.snapshot.units.find((u) => u.id === id);
    return !!unit && canManageUnit(session, id, unit.ancestorIds);
  };
  return (
    <div className="access-workbench" data-editing={!!selected}>
      <section className="access-surface" aria-label="Structure directory">
        <div className="access-toolbar">
          <Search
            placeholder="Find a site or department…"
            onChange={(s) => {
              setSearch(s);
              setCursors([]);
            }}
          />
          <Field className="access-filter">
            <FieldLabel className="sr-only" htmlFor="structure-view">
              Structure view
            </FieldLabel>
            <NativeSelect
              id="structure-view"
              value={view}
              onChange={(e) => setView(e.target.value)}
            >
              <option value="outline">Outline</option>
              <option value="chart">Chart</option>
            </NativeSelect>
          </Field>
          {!root && companyManager && page.value && (
            <EmptyRootAction
              snapshot={page.value}
              onSelect={(id, snapshot) => setSelected({ id, snapshot, editable: true })}
            />
          )}
          {root && companyManager && (
            <Button
              disabled={!!selected || page.loading}
              onClick={() =>
                page.value && setSelected({ id: root.id, snapshot: page.value, editable: true })
              }
            >
              Add site
            </Button>
          )}
          <Reload label="Reload structure" loading={page.loading} onClick={page.refresh} />
        </div>
        <div className="access-surface-heading">
          <div>
            <h2>Organization hierarchy</h2>
            <p>Sites and departments, connected by their parent relationships.</p>
          </div>
        </div>
        {page.loading && <ContentLoading label="Loading authorized structure…" />}
        {!!page.failure && <Notice message={message(page.failure)} />}
        {page.value && (
          <>
            {page.value.units.length ? (
              <div className="access-structure-view" data-view={view}>
                <StructureOutline
                  canManage={canManage}
                  key={`${search}:${cursors.at(-1) ?? ''}`}
                  snapshot={page.value}
                  selectedId={selected?.id}
                  disabled={!!selected || page.loading}
                  onSelect={(id) =>
                    page.value && setSelected({ id, snapshot: page.value, editable: canManage(id) })
                  }
                />
              </div>
            ) : (
              <AccessEmpty
                title={search ? 'No matching units' : 'No units available'}
                description={
                  search
                    ? 'Try another name. Search shows matching units and their ancestor paths.'
                    : 'Units appear here when they are available within your access. Organization setup is managed in Settings.'
                }
              />
            )}
            <Pager
              total={page.value.total}
              next={page.value.nextCursor}
              previous={!!cursors.length}
              onNext={() => setCursors((c) => [...c, page.value?.nextCursor ?? ''])}
              onPrevious={() => setCursors((c) => c.slice(0, -1))}
            />
          </>
        )}
        <p className="access-caption">
          Showing units within your access. Path context shows ancestry only. Manage a unit to
          review changes or add a child.
        </p>
      </section>
      {selected && (
        <AccessInspector key={selected.id} label="Unit details">
          {selected.editable ? (
            <PeopleActivity
              value={
                canManage(selected.id) ||
                (companyManager &&
                  selected.snapshot.ancestors.some(
                    (u) => u.id === selected.id && u.type === 'organization',
                  ))
              }
            >
              {!canManage(selected.id) && !companyManager && (
                <Notice message="Your editing access changed. Refresh session and access to check it. Your draft is retained." />
              )}
              <div
                hidden={!canManage(selected.id) && !companyManager}
                inert={!canManage(selected.id) && !companyManager}
              >
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
              </div>
            </PeopleActivity>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>
                  {selected.snapshot.units.find((u) => u.id === selected.id)?.name}
                </CardTitle>
                <CardDescription>
                  Read-only unit. Your current access does not permit editing.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={() => setSelected(undefined)}>
                  Close details
                </Button>
              </CardContent>
            </Card>
          )}
        </AccessInspector>
      )}
    </div>
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
  const unit =
    snapshot.units.find((u) => u.id === id) ??
    snapshot.ancestors.find((u) => u.id === id && u.type === 'organization');
  const isRoot = unit?.type === 'organization';
  const labels = new Map([...snapshot.ancestors, ...snapshot.units].map((u) => [u.id, u.name]));
  const unitPath = unit
    ? [
        ...('ancestorIds' in unit ? unit.ancestorIds : []).map((ancestor) => labels.get(ancestor)),
        unit.name,
      ].join(' / ')
    : '';

  const [action, setAction] = useState<'rename' | 'create' | 'move' | 'delete'>(
    isRoot ? 'create' : 'rename',
  );
  const [name, setName] = useState(isRoot ? '' : (unit?.name ?? '')),
    [parent, setParent] = useState(id),
    [type, setType] = useState(isRoot ? 'site' : 'department');
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
    <Card variant="panel" className="access-panel">
      <CardHeader className="access-panel-header">
        <div className="access-panel-kicker">Organization structure</div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="access-panel-close"
          aria-label="Close panel"
          disabled={busy || (unknown && !observed)}
          onClick={() => {
            if (
              (draft || name !== (isRoot ? '' : (unit?.name ?? '')) || parent !== id) &&
              !window.confirm('Discard this unsaved unit draft?')
            )
              return;
            clean();
            close();
          }}
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
        <CardTitle>
          <h2 className="break-words">Manage {unit?.name}</h2>
        </CardTitle>
        <CardDescription>{unitPath}</CardDescription>
      </CardHeader>
      <CardContent className="access-panel-body flex flex-col gap-5">
        {!!failure && <Notice message={message(failure)} />}
        <FieldSet disabled={busy || unknown || !!draft}>
          <Field>
            <FieldLabel htmlFor="unit-action">Action</FieldLabel>
            <NativeSelect
              id="unit-action"
              value={action}
              onChange={(e) => {
                const value = e.target.value as typeof action;
                setAction(value);
                setName(value === 'rename' ? (unit?.name ?? '') : '');
                setParent(id);
              }}
            >
              {!isRoot && <option value="rename">Rename unit</option>}
              <option value="create">Add a child unit</option>
              {!isRoot && <option value="move">Move to another parent</option>}
              {!isRoot && <option value="delete">Delete unit</option>}
            </NativeSelect>
          </Field>
          {(action === 'rename' || action === 'create') && (
            <Field>
              <FieldLabel htmlFor="unit-name">Unit name</FieldLabel>
              <Input id="unit-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          {(action === 'create' || action === 'move') && (
            <ParentChoice
              snapshot={snapshot}
              session={session}
              value={parent}
              onChange={setParent}
            />
          )}
          {action === 'create' && (
            <Field>
              <FieldLabel htmlFor="unit-type">New unit type</FieldLabel>
              <NativeSelect id="unit-type" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="department">Department</option>
                <option value="site">Site / Plant</option>
              </NativeSelect>
            </Field>
          )}
        </FieldSet>
        <p className="text-sm text-muted-foreground">
          {action === 'delete'
            ? `Delete ${unit?.name}? Only unused leaf units can be removed. The server checks assignments, invitations and setup protections.`
            : action === 'move'
              ? 'Moving a unit can change inherited access. Review the current impact before confirming.'
              : action === 'create'
                ? `Add a new unit below ${unit?.name}, or choose another authorized parent.`
                : 'Names change without changing saved access assignments.'}
        </p>
      </CardContent>
      <CardFooter className="access-panel-footer">
        <div className="access-unit-actions">
          {' '}
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
                variant={draft.method === 'DELETE' ? 'destructive' : 'default'}
                onClick={() => void save()}
              >
                Confirm and save
              </Button>
              <Button disabled={busy} variant="outline" onClick={() => setDraft(undefined)}>
                Back to draft
              </Button>
            </>
          ) : (
            <Button
              disabled={
                busy ||
                (action === 'move' && parent === id) ||
                ((action === 'rename' || action === 'create') && !name.trim())
              }
              variant={action === 'delete' ? 'destructive' : 'default'}
              onClick={() => void propose(action)}
            >
              {action === 'rename'
                ? 'Review rename'
                : action === 'create'
                  ? 'Review new unit'
                  : action === 'move'
                    ? 'Review move'
                    : 'Review deletion'}
            </Button>
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
        </div>
      </CardFooter>
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

function EmptyRootAction({
  snapshot,
  onSelect,
}: {
  snapshot: ReturnType<typeof scopedUnitsResponseSchema.parse>;
  onSelect: (id: string, snapshot: ReturnType<typeof scopedUnitsResponseSchema.parse>) => void;
}) {
  const profile = usePage('/api/organization', organizationResponseSchema, snapshot.revision);
  const root = profile.value?.organization;
  return (
    <>
      <Button
        disabled={!root?.rootId || profile.value?.revision !== snapshot.revision}
        onClick={() => {
          if (root?.rootId && root.name)
            onSelect(root.rootId, {
              ...snapshot,
              ancestors: [
                ...snapshot.ancestors,
                { id: root.rootId, type: 'organization', name: root.name, actionable: false },
              ],
            });
        }}
      >
        Add site
      </Button>
      {!!profile.failure && (
        <Notice message="Organization context could not be loaded. Reload structure to try again." />
      )}
    </>
  );
}
