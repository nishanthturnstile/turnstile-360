import { useState } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { NativeSelect } from '@/components/ui/native-select';
import { HierarchyWorkbench } from '@/features/people/HierarchyWorkbench';
import { StructureUnitOverview } from '@/features/people/StructureUnitOverview';
import type { HierarchyNode } from '@/features/people/structure-hierarchy';

const nodes: HierarchyNode[] = [
  {
    id: 'gallery-root',
    name: 'Example Manufacturing',
    type: 'organization',
    parentId: null,
    ancestorIds: [],
    context: true,
  },
  {
    id: 'gallery-north',
    name: 'North Manufacturing',
    type: 'site',
    parentId: 'gallery-root',
    ancestorIds: ['gallery-root'],
    context: false,
  },
  {
    id: 'gallery-south',
    name: 'South Distribution',
    type: 'site',
    parentId: 'gallery-root',
    ancestorIds: ['gallery-root'],
    context: false,
  },
  {
    id: 'gallery-quality',
    name: 'Quality assurance and continuous improvement',
    type: 'department',
    parentId: 'gallery-north',
    ancestorIds: ['gallery-root', 'gallery-north'],
    context: false,
  },
  {
    id: 'gallery-ops',
    name: 'Operations',
    type: 'department',
    parentId: 'gallery-north',
    ancestorIds: ['gallery-root', 'gallery-north'],
    context: false,
  },
  {
    id: 'gallery-other',
    name: 'Operations',
    type: 'department',
    parentId: 'gallery-south',
    ancestorIds: ['gallery-root', 'gallery-south'],
    context: false,
  },
];
/** Actual scoped presentation, fixture-only commands and no account/API access. */
export function ScopedHierarchyGallery() {
  const [state, setState] = useState('populated');
  const [selectedId, setSelectedId] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const selected = nodes.find((n) => n.id === selectedId);
  const source =
    state === 'empty' || state === 'loading'
      ? []
      : state === 'scoped'
        ? nodes
            .filter((n) => n.id !== 'gallery-south' && n.id !== 'gallery-other')
            .map((n) => (n.id === 'gallery-north' ? { ...n, context: true } : n))
        : state === 'wide'
          ? [
              ...nodes,
              ...Array.from(
                { length: 40 },
                (_, i): HierarchyNode => ({
                  id: `gallery-wide-${i}`,
                  name: `Regional site ${i + 1}`,
                  type: 'site',
                  parentId: 'gallery-root',
                  ancestorIds: ['gallery-root'],
                  context: false,
                }),
              ),
            ]
          : nodes;
  return (
    <section className="flex flex-col gap-5" aria-label="Scoped hierarchy workspace examples">
      <h2 className="section-title">Scoped Structure workspace</h2>
      <Field className="max-w-xs">
        <FieldLabel htmlFor="scoped-hierarchy-example">Example state</FieldLabel>
        <NativeSelect
          id="scoped-hierarchy-example"
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setSelectedId(undefined);
          }}
        >
          {[
            'populated',
            'scoped',
            'empty',
            'loading',
            'refreshing',
            'conflict',
            'wide',
            'narrow',
          ].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="scoped-hierarchy-gallery" data-narrow={state === 'narrow'}>
        <HierarchyWorkbench
          key={state}
          nodes={source}
          total={source.filter((n) => !n.context).length}
          selectedId={selectedId}
          onSelect={setSelectedId}
          canAdd={(n) => !n.context}
          onAdd={() =>
            setAnnouncement('Fixture: opens the guarded department task. No unit is saved.')
          }
          onRefresh={() => setAnnouncement('Fixture: refresh uses only the authorized read cache.')}
          initialLoading={state === 'loading'}
          loading={state === 'loading' || state === 'refreshing'}
          createAction={
            <Button
              onClick={() =>
                setAnnouncement('Fixture: opens site creation with the organization as parent.')
              }
            >
              Add site
            </Button>
          }
          feedback={
            state === 'conflict' ? (
              <Notice message="Structure changed while loading its pages. Reload to see one consistent revision." />
            ) : state === 'refreshing' ? (
              <p className="hierarchy-status" role="status">
                Updating hierarchy… Existing units stay visible.
              </p>
            ) : undefined
          }
          inspector={
            selected
              ? (focus) => (
                  <StructureUnitOverview
                    node={selected}
                    nodes={source}
                    editable={!selected.context}
                    addable={!selected.context}
                    disabled={false}
                    onAction={() => setAnnouncement('Fixture: opens a focused reviewed task.')}
                    onSelect={setSelectedId}
                    onFocus={() => focus(selected.id)}
                    onClose={() => setSelectedId(undefined)}
                  />
                )
              : undefined
          }
        />
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {announcement ||
          'Chart, outline, search, branch navigation and overview use the production components.'}
      </p>
    </section>
  );
}
