import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CONFIGURATION_LIMITS,
  configurationNameKey,
  scopedCommandResultSchema,
  scopedMoveImpactSchema,
  scopedMoveRequestSchema,
  scopedUnitsResponseSchema,
  type UserSessionDto,
  unitNameSchema,
} from '@thaarei/turnstile-contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { useUnsavedEntries } from '../configuration/shared';
import { unitPath } from '../configuration/structure-model';
import { usePeopleActivity } from './activity';
import { message, PeopleError, request } from './client';
import {
  canAddBelow,
  createDestinationValidator,
  knownDeleteRestriction,
} from './structure-affordances';
import {
  type HierarchyNode,
  type HierarchySnapshot,
  hierarchyNodes,
  loadScopedHierarchy,
} from './structure-hierarchy';
import { useTaskConfirm, useTaskDismiss } from './TaskSheet';

export type StructureIntent = 'rename' | 'create' | 'move' | 'delete';
type Result = ReturnType<typeof scopedCommandResultSchema.parse>;
type Draft = { path: string; method: string; body: unknown; key: string };

export function structureMessage(error: unknown) {
  if (error instanceof PeopleError && error.code.startsWith('STRUCTURE_')) {
    if (error.reason === 'capacity')
      return 'The configured hierarchy capacity has been reached. Remove an unused unit before adding another.';
    if (error.reason === 'duplicate_name')
      return 'A unit with this name already exists under the selected parent. Choose a different name.';
    if (error.reason === 'reference_in_use')
      return 'This unit is used by saved access or an actionable invitation. Update those references before deleting it.';
    if (error.reason === 'required_unit')
      return 'Keep at least one site or department directly under the organization.';
    if (error.status === 409)
      return 'Saved structure or access changed. Reload saved context, compare it with your draft, then review again.';
    if (error.status === 400)
      return 'Check the unit name, type and parent. The server also checks limits and current access.';
    if (error.status === 404)
      return 'This unit is no longer available with your current access. Your draft is kept; reload saved context to compare.';
  }
  return message(error);
}

/** Owns captured command versions and receipts. Loading or camera changes cannot replay a write. */
export function StructureUnitTask({
  id,
  action,
  initialSnapshot,
  rootNode,
  initialType = 'department',
  initialParent,
  session,
  onSaved,
  close,
}: {
  id: string;
  action: StructureIntent;
  initialSnapshot: HierarchySnapshot;
  rootNode?: HierarchyNode | undefined;
  initialType?: 'site' | 'department' | undefined;
  initialParent?: string | undefined;
  session: UserSessionDto;
  onSaved: (result: Result) => Promise<void>;
  close: () => void;
}) {
  const active = usePeopleActivity();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const nodes = useMemo(() => {
    const rows = hierarchyNodes(snapshot);
    return rootNode && !rows.some((n) => n.id === rootNode.id) ? [...rows, rootNode] : rows;
  }, [snapshot, rootNode]);
  const unit = nodes.find((n) => n.id === id);
  const [name, setName] = useState(action === 'rename' ? (unit?.name ?? '') : '');
  const [parent, setParent] = useState(initialParent ?? (action === 'create' ? id : ''));
  const [type, setType] = useState<'site' | 'department'>(initialType);
  const [parentSearch, setParentSearch] = useState('');
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [observed, setObserved] = useState(false);
  const [draft, setDraft] = useState<Draft>();
  const [impact, setImpact] = useState<ReturnType<typeof scopedMoveImpactSchema.parse>>();
  const [expired, setExpired] = useState(false);
  const [confirmed, setConfirmed] = useState<Result>();
  const writing = useRef(false);
  const confirmDiscard = useTaskConfirm();
  const destination = nodes.find((n) => n.id === parent);
  const dirty =
    !!draft ||
    uncertain ||
    (action === 'rename' && name !== (unit?.name ?? '')) ||
    (action === 'create' && (!!name || parent !== id || type !== initialType)) ||
    (action === 'move' && !!parent);
  const clean = useUnsavedEntries(!confirmed && (dirty || busy));
  const dismiss = () => {
    if (busy || (uncertain && !observed)) return;
    const discard = () => {
      clean();
      close();
    };
    if (dirty && !confirmed)
      confirmDiscard(
        'Discard this unit draft? Saved structure and access will remain unchanged.',
        discard,
      );
    else discard();
  };
  useTaskDismiss(dismiss);
  const context = `${active}:${session.access.fingerprint}:${session.csrfToken}`;
  const previousContext = useRef(context);
  useEffect(() => {
    if (previousContext.current === context) return;
    previousContext.current = context;
    // An in-flight/uncertain command keeps its exact body/key across authority changes.
    if (!writing.current && !uncertain) {
      setDraft(undefined);
      setImpact(undefined);
    }
  }, [context, uncertain]);
  useEffect(() => {
    setExpired(false);
    if (!impact) return;
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, Date.parse(impact.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [impact]);

  const validateDestination = useMemo(
    () => createDestinationValidator(session, nodes, id),
    [session, nodes, id],
  );
  const parents = useMemo(
    () =>
      nodes.map((node) => ({
        node,
        reason:
          action === 'move'
            ? validateDestination(node)
            : canAddBelow(session, node, nodes.length)
              ? undefined
              : 'Creating a child requires managed descendant coverage and an available level.',
      })),
    [nodes, session, action, validateDestination],
  );
  const eligibleParents = parents.filter((p) => !p.reason);
  const parentOptions = eligibleParents.filter(
    (p) =>
      unitPath(nodes, p.node.id)
        .toLocaleLowerCase()
        .includes(parentSearch.trim().toLocaleLowerCase()) || p.node.id === parent,
  );
  const validName = unitNameSchema.safeParse(name);
  const duplicate =
    (action === 'create' || action === 'rename') &&
    nodes.some(
      (n) =>
        !n.context &&
        n.id !== (action === 'rename' ? id : undefined) &&
        n.parentId === (action === 'rename' ? unit?.parentId : parent) &&
        configurationNameKey(n.name) === configurationNameKey(name),
    );
  const restriction =
    action === 'delete'
      ? knownDeleteRestriction(nodes, id)
      : action === 'move'
        ? destination
          ? validateDestination(destination)
          : 'Choose a new parent.'
        : action === 'create'
          ? !destination
            ? 'Choose a parent.'
            : !canAddBelow(session, destination, nodes.length)
              ? nodes.length >= CONFIGURATION_LIMITS.units
                ? 'The hierarchy has reached its configured unit limit.'
                : 'You cannot add a child below this parent. Check managed coverage and the depth limit.'
              : type === 'site' && destination.type !== 'organization'
                ? 'A Site / Plant belongs directly under the organization.'
                : undefined
          : undefined;
  const title =
    action === 'create'
      ? `Add ${type === 'site' ? 'site' : 'department'}`
      : action === 'rename'
        ? 'Rename unit'
        : action === 'move'
          ? 'Move unit'
          : 'Delete unit';
  const oldPath = unit ? unitPath(nodes, id) : 'Opened unit is no longer available';
  const nextPath =
    action === 'move' || action === 'create'
      ? `${unitPath(nodes, parent)} / ${action === 'create' ? name : (unit?.name ?? '')}`
      : action === 'rename'
        ? `${unit?.ancestorIds.map((a) => nodes.find((n) => n.id === a)?.name ?? 'Unavailable').join(' / ')} / ${name}`
        : oldPath;
  const versions = {
    expectedAccessRevision: snapshot.accessRevision,
    expectedOrganizationRevision: snapshot.revision,
  };
  async function propose() {
    if (
      !active ||
      busy ||
      restriction ||
      duplicate ||
      ((action === 'create' || action === 'rename') && !validName.success)
    )
      return;
    setBusy(true);
    setFailure(undefined);
    setImpact(undefined);
    const body =
      action === 'rename'
        ? { ...versions, name }
        : action === 'create'
          ? { ...versions, name, type, parentId: parent }
          : action === 'delete'
            ? versions
            : { command: { ...versions, id, parentId: parent }, confirmation: null };
    const next: Draft = {
      path:
        action === 'create'
          ? '/api/structure/units'
          : `/api/structure/units/${id}${action === 'move' ? '/parent' : ''}`,
      method: action === 'create' ? 'POST' : action === 'delete' ? 'DELETE' : 'PATCH',
      body,
      key: crypto.randomUUID(),
    };
    try {
      if (action === 'move') {
        const preview = await request('/api/structure/move-impact', scopedMoveImpactSchema, {
          method: 'POST',
          csrf: session.csrfToken,
          body: { ...versions, id, parentId: parent },
        });
        setImpact(preview);
        next.body = {
          command: { ...versions, id, parentId: parent },
          confirmation: preview.confirmation,
        };
      }
      setDraft(next);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!active || busy || !draft || expired || confirmed) return;
    setBusy(true);
    writing.current = true;
    setFailure(undefined);
    let result: Result;
    try {
      result = await request(draft.path, scopedCommandResultSchema, {
        method: draft.method,
        body: draft.body,
        key: draft.key,
        csrf: session.csrfToken,
      });
    } catch (error) {
      const unknown =
        !(error instanceof PeopleError) || (error.status >= 500 && error.reason !== 'readiness');
      setUncertain(unknown);
      setObserved(false);
      setFailure(error);
      if (!unknown) {
        setDraft(undefined);
        setImpact(undefined);
      }
      setBusy(false);
      return;
    } finally {
      writing.current = false;
    }
    // A failed refresh cannot turn a confirmed mutation into an uncertain one.
    setConfirmed(result);
    clean();
    try {
      await onSaved(result);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }
  async function readHierarchy() {
    return loadScopedHierarchy(
      (cursor, signal) =>
        request(
          `/api/structure/units?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          scopedUnitsResponseSchema,
          { signal },
        ),
      new AbortController().signal,
    );
  }
  async function reloadContext() {
    if (!active || busy) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const current = await readHierarchy();
      const currentNode = hierarchyNodes(current).find((n) => n.id === id);
      if (!currentNode && !(action === 'create' && rootNode))
        throw new PeopleError(404, 'STRUCTURE_NOT_FOUND');
      setSnapshot(current);
      setDraft(undefined);
      setImpact(undefined);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }
  async function checkReceipt() {
    if (!active || busy || !draft) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const result = await request(
        `/api/structure/commands/${draft.key}`,
        scopedCommandResultSchema,
      );
      setConfirmed(result);
      setUncertain(false);
      clean();
      await onSaved(result);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }
  async function reconcile() {
    if (!active || busy || !draft) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const current = await readHierarchy();
      setObserved(true);
      if (
        current.revision !== snapshot.revision ||
        current.accessRevision !== snapshot.accessRevision
      )
        throw new PeopleError(409, 'STRUCTURE_CONFLICT', 'revision');
      if (draft.path.endsWith('/parent')) {
        const command = scopedMoveRequestSchema.parse(draft.body).command;
        const preview = await request('/api/structure/move-impact', scopedMoveImpactSchema, {
          method: 'POST',
          csrf: session.csrfToken,
          body: command,
        });
        setImpact(preview);
        setDraft({ ...draft, body: { command, confirmation: preview.confirmation } });
      }
      setUncertain(false);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card variant="panel" className="access-panel">
      <CardHeader className="access-panel-header">
        <div className="access-panel-kicker">
          Organization structure{draft ? ' · Review' : ' · Draft'}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="access-panel-close"
          aria-label="Close panel"
          disabled={busy || (uncertain && !observed)}
          onClick={dismiss}
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription>{oldPath}</CardDescription>
      </CardHeader>
      <CardContent className="access-panel-body flex flex-col gap-5">
        {!!failure && <Notice message={structureMessage(failure)} />}
        {confirmed ? (
          <p role="status" className="panel-help">
            This change is saved. Reload the structure to see its current state; no change will be
            sent again.
          </p>
        ) : uncertain ? (
          <Notice message="The result is uncertain. Check the saved command or read current state before another confirmation. Your exact command and draft are kept." />
        ) : draft ? (
          <section className="structure-change-review" aria-label="Review structure change">
            <h3 className="section-title">
              {action === 'delete' ? 'Review deletion' : 'Review structure change'}
            </h3>
            {action !== 'create' && (
              <div>
                <span>Current path</span>
                <p>{oldPath}</p>
              </div>
            )}
            {action !== 'delete' && (
              <div>
                <span>{action === 'rename' ? 'Updated path' : 'New path'}</span>
                <p>{nextPath}</p>
              </div>
            )}
            {action === 'create' && <p>Type: {type === 'site' ? 'Site / Plant' : 'Department'}</p>}
            {action === 'move' && (
              <p>
                {
                  nodes.filter(
                    (n) => n.id === id || n.ancestorIds.some((ancestor) => ancestor === id),
                  ).length
                }{' '}
                visible units in this branch. Hidden units, if any, are checked by the server.
              </p>
            )}
            {impact && (
              <div>
                <p>
                  {impact.affectedMemberCount} members and {impact.affectedInvitationCount}{' '}
                  invitations affected.
                </p>
                <p>
                  {impact.accessChanges
                    ? 'Inherited access will change.'
                    : 'Access coverage is unchanged.'}
                </p>
              </div>
            )}
            {action === 'delete' && (
              <p>
                Delete {unit?.name}? Only unused leaf units can be removed. The server checks saved
                access, actionable invitations and setup protections.
              </p>
            )}
            {expired && (
              <Notice message="This move review expired. Return to the draft and review current impact again." />
            )}
          </section>
        ) : (
          <>
            <FieldSet disabled={busy}>
              <FieldGroup>
                {(action === 'rename' || action === 'create') && (
                  <Field data-invalid={!!name && (!validName.success || duplicate)}>
                    <FieldLabel htmlFor="unit-name">Unit name</FieldLabel>
                    <Input
                      id="unit-name"
                      value={name}
                      aria-invalid={!!name && (!validName.success || duplicate)}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={
                        type === 'site'
                          ? 'e.g. North manufacturing plant'
                          : 'e.g. Quality assurance'
                      }
                    />
                    <FieldDescription>
                      {duplicate
                        ? 'A visible unit with this name already exists under this parent.'
                        : 'Use a clear name, up to 120 characters.'}
                    </FieldDescription>
                  </Field>
                )}
                {(action === 'create' || action === 'move') && (
                  <>
                    <Field>
                      <FieldLabel htmlFor="structure-parent-search">
                        Find a parent by name or path
                      </FieldLabel>
                      <Input
                        id="structure-parent-search"
                        type="search"
                        value={parentSearch}
                        onChange={(e) => setParentSearch(e.target.value)}
                        placeholder="Search available destinations…"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="unit-parent">
                        {action === 'move' ? 'New parent' : 'Parent unit'}
                      </FieldLabel>
                      <NativeSelect
                        id="unit-parent"
                        value={parent}
                        onChange={(e) => {
                          const next = nodes.find((n) => n.id === e.target.value);
                          setParent(e.target.value);
                          if (action === 'create' && next?.type !== 'organization')
                            setType('department');
                        }}
                      >
                        <option value="">Choose a parent…</option>
                        {parent && !eligibleParents.some((p) => p.node.id === parent) && (
                          <option value={parent} disabled>
                            {destination
                              ? unitPath(nodes, parent)
                              : 'Previous destination is unavailable'}
                          </option>
                        )}
                        {parentOptions.map((p) => (
                          <option key={p.node.id} value={p.node.id}>
                            {unitPath(nodes, p.node.id)}
                          </option>
                        ))}
                      </NativeSelect>
                      <FieldDescription>
                        {!eligibleParents.length
                          ? 'No eligible destinations are currently available within your management coverage.'
                          : action === 'move'
                            ? 'The current parent, this unit, descendants and known invalid destinations are excluded.'
                            : 'Creating a child requires managed descendant coverage. The server checks current limits and references.'}
                      </FieldDescription>
                    </Field>
                  </>
                )}
                {action === 'create' && (
                  <Field>
                    <FieldLabel htmlFor="unit-type">New unit type</FieldLabel>
                    <NativeSelect
                      id="unit-type"
                      value={type}
                      onChange={(e) => setType(e.target.value as typeof type)}
                    >
                      {destination?.type === 'organization' && (
                        <option value="site">Site / Plant</option>
                      )}
                      <option value="department">Department</option>
                    </NativeSelect>
                    <FieldDescription>
                      {destination?.type === 'organization'
                        ? 'Sites and departments may sit directly under the organization.'
                        : 'Only departments can be created below a site or department.'}
                    </FieldDescription>
                  </Field>
                )}
              </FieldGroup>
            </FieldSet>
            {action === 'rename' && (
              <p className="panel-help">
                Current saved name: {unit?.name}. Renaming preserves the unit identity and saved
                access assignments.
              </p>
            )}
            {action === 'delete' && (
              <p>
                Delete {unit?.name}? Only unused leaf units can be removed. Saved access, child
                units and actionable invitations can prevent deletion.
              </p>
            )}
            {restriction && (
              <p className="panel-help" role="status">
                {restriction}
              </p>
            )}
          </>
        )}
      </CardContent>
      <CardFooter className="access-panel-footer">
        <div className="structure-task-actions">
          {confirmed ? (
            <Button disabled={busy} onClick={() => void onSaved(confirmed)}>
              Reload saved structure
            </Button>
          ) : uncertain ? (
            <>
              <Button disabled={busy} onClick={() => void checkReceipt()}>
                Check command status
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void reconcile()}>
                Read current state and review the same command
              </Button>
              <p className="panel-help">
                Nothing is retried automatically. If the saved revisions changed, compare current
                structure before discarding this draft.
              </p>
            </>
          ) : draft ? (
            <>
              <Button
                disabled={busy || expired}
                variant={action === 'delete' ? 'destructive' : 'default'}
                onClick={() => void save()}
              >
                {busy && <Spinner data-icon="inline-start" />}Confirm and save
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDraft(undefined);
                  setImpact(undefined);
                }}
              >
                Back to draft
              </Button>
            </>
          ) : (
            <>
              <Button
                disabled={
                  busy ||
                  !!restriction ||
                  !!duplicate ||
                  ((action === 'create' || action === 'rename') && !validName.success) ||
                  (action === 'rename' && name === unit?.name)
                }
                variant={action === 'delete' ? 'destructive' : 'default'}
                onClick={() => void propose()}
              >
                {busy && <Spinner data-icon="inline-start" />}
                {action === 'create'
                  ? 'Review new unit'
                  : action === 'rename'
                    ? 'Review rename'
                    : action === 'move'
                      ? 'Review move'
                      : 'Review deletion'}
              </Button>
              {!!failure && (
                <Button variant="outline" disabled={busy} onClick={() => void reloadContext()}>
                  Reload saved context
                </Button>
              )}
            </>
          )}
          <Button variant="outline" disabled={busy || (uncertain && !observed)} onClick={dismiss}>
            Cancel
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
