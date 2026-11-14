import {
  CONFIGURATION_LIMITS,
  organizationResponseSchema,
  permissionCatalogSchema,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';
import { useMemo, useRef, useState } from 'react';
import { ButtonLink } from '@/components/button-link';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { PeopleActivity, usePeopleActivity } from './activity';
import { canReadUnits, company } from './client';
import { HierarchyWorkbench } from './HierarchyWorkbench';
import { StructureUnitOverview } from './StructureUnitOverview';
import { type StructureIntent, StructureUnitTask, structureMessage } from './StructureUnitTask';
import { usePage } from './shared';
import {
  canAddBelow,
  canEditUnit,
  canManageChildren,
  canManageRoot,
  createDestinationValidator,
} from './structure-affordances';
import { type HierarchyNode, type HierarchySnapshot, hierarchyNodes } from './structure-hierarchy';
import { TaskSheet } from './TaskSheet';
import { useHierarchy } from './use-hierarchy';

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
      <div hidden={active}>
        <Notice message="Unit reading permission is required to view structure. Your unsaved entries are kept on this page." />
      </div>
      <PeopleActivity value={active}>
        <div className="hierarchy-owner" hidden={!active} inert={!active}>
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
  const active = usePeopleActivity();
  const page = useHierarchy();
  const nodes = useMemo(() => (page.value ? hierarchyNodes(page.value) : []), [page.value]);
  const [selectedId, setSelectedId] = useState<string>();
  const origin = useRef<HTMLElement | null>(null);
  const selected = nodes.find((n) => n.id === selectedId);
  const [task, setTask] = useState<{
    id: string;
    action: StructureIntent;
    snapshot: HierarchySnapshot;
    root?: HierarchyNode;
    type?: 'site' | 'department';
    parent?: string;
  }>();
  const root = nodes.find((n) => n.type === 'organization');
  const disabled = page.loading || !!page.failure;
  function select(id?: string) {
    if (id)
      origin.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedId(id);
  }
  function closeOverview() {
    setSelectedId(undefined);
    if (origin.current?.isConnected) origin.current.focus({ preventScroll: true });
  }
  function act(action: StructureIntent, id: string, parent?: string) {
    if (!page.value || disabled) return;
    setTask({ id, action, snapshot: page.value, ...(parent ? { parent } : {}) });
  }
  const taskNode =
    task &&
    (nodes.find((n) => n.id === task.id) ??
      hierarchyNodes(task.snapshot).find((n) => n.id === task.id) ??
      task.root);
  const taskAllowed =
    !!taskNode &&
    !!page.value &&
    (task?.action === 'create'
      ? canManageChildren(session, taskNode)
      : canEditUnit(session, taskNode));
  return (
    <>
      <HierarchyWorkbench
        nodes={nodes}
        total={page.value?.total ?? 0}
        selectedId={selected?.id}
        disabled={disabled}
        loading={page.loading}
        initialLoading={!page.value && page.loading}
        onRefresh={page.refresh}
        onSelect={select}
        canAdd={(node) => canAddBelow(session, node, nodes.length)}
        onAdd={(id) => act('create', id)}
        canMove={(node) => canEditUnit(session, node) && node.type === 'department'}
        moveTargets={(id) => {
          const validate = createDestinationValidator(session, nodes, id);
          return new Set(nodes.filter((n) => !validate(n)).map((n) => n.id));
        }}
        onMove={(id, parent) => {
          setSelectedId(id);
          act('move', id, parent);
        }}
        createAction={
          canManageRoot(session) && page.value ? (
            root ? (
              <Button
                disabled={disabled || !!task || nodes.length >= CONFIGURATION_LIMITS.units}
                title={
                  nodes.length >= CONFIGURATION_LIMITS.units
                    ? 'The hierarchy has no capacity for another unit.'
                    : undefined
                }
                onClick={() =>
                  setTask({
                    id: root.id,
                    action: 'create',
                    snapshot: page.value as HierarchySnapshot,
                    type: 'site',
                  })
                }
              >
                Add site
              </Button>
            ) : (
              <RootAction
                snapshot={page.value}
                disabled={disabled || !!task}
                onCreate={(node) =>
                  setTask({
                    id: node.id,
                    action: 'create',
                    snapshot: page.value as HierarchySnapshot,
                    root: node,
                    type: 'site',
                  })
                }
              />
            )
          ) : undefined
        }
        inspector={
          selected && !task
            ? (focus) => (
                <StructureUnitOverview
                  key={selected.id}
                  node={selected}
                  nodes={nodes}
                  editable={canEditUnit(session, selected)}
                  addable={canAddBelow(session, selected, nodes.length)}
                  disabled={disabled}
                  onAction={(action) => act(action, selected.id)}
                  onSelect={select}
                  onFocus={() => focus(selected.id)}
                  onClose={closeOverview}
                  organizationLink={
                    selected.type === 'organization' &&
                    company(session, 'turnstile:configuration:manage')
                  }
                  accessLink={
                    !selected.context && company(session, 'turnstile:people:manage') ? (
                      <MembersLink session={session} node={selected} />
                    ) : undefined
                  }
                />
              )
            : undefined
        }
        feedback={
          <>
            {page.refreshing && (
              <p className="hierarchy-status" role="status">
                Updating hierarchy… Existing units stay visible.
              </p>
            )}
            {!!page.failure && (
              <div className="hierarchy-feedback">
                <Notice message={structureMessage(page.failure)} />
              </div>
            )}
            {!page.value && page.loading && page.progress && (
              <p className="hierarchy-status" role="status">
                Loaded {page.progress.loaded} of {page.progress.total} authorized units…
              </p>
            )}
          </>
        }
      />
      {task && (
        <PeopleActivity value={active && taskAllowed}>
          <TaskSheet label="Edit organization unit">
            <StructureUnitTask
              id={task.id}
              action={task.action}
              initialSnapshot={task.snapshot}
              rootNode={task.root}
              initialType={task.type}
              initialParent={task.parent}
              session={session}
              close={() => setTask(undefined)}
              onSaved={async () => {
                if (await onCheck(true)) {
                  page.refresh();
                  setTask(undefined);
                  setSelectedId(undefined);
                }
              }}
            />
          </TaskSheet>
        </PeopleActivity>
      )}
    </>
  );
}
function RootAction({
  snapshot,
  disabled,
  onCreate,
}: {
  snapshot: HierarchySnapshot;
  disabled: boolean;
  onCreate: (node: HierarchyNode) => void;
}) {
  const profile = usePage('/api/organization', organizationResponseSchema, snapshot.revision);
  const root = profile.value?.organization;
  return (
    <>
      <Button
        disabled={disabled || !root?.rootId || profile.value?.revision !== snapshot.revision}
        onClick={() => {
          if (root?.rootId && root.name)
            onCreate({
              id: root.rootId,
              name: root.name,
              type: 'organization',
              parentId: null,
              ancestorIds: [],
              context: true,
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
function MembersLink({ session, node }: { session: UserSessionDto; node: HierarchyNode }) {
  const catalog = usePage(
    '/api/people/catalog',
    permissionCatalogSchema,
    session.access.fingerprint,
  );
  return catalog.value?.memberAssignmentFilters ? (
    <div className="hierarchy-access-link">
      <ButtonLink
        variant="outline"
        size="sm"
        href={`/people/members?unitId=${encodeURIComponent(node.id)}`}
      >
        Members with access
      </ButtonLink>
      <p className="panel-help">
        View saved role coverage for this unit. Membership status is shown separately; this is not
        employee headcount.
      </p>
    </div>
  ) : null;
}
