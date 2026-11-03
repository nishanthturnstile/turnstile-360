import { useState } from 'react';
import { ContentLoading } from '@/components/content-loading';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { StructureTree } from '@/features/configuration/StructureTree';
import type { StructureUnit } from '@/features/configuration/structure-model';
import { cn } from '@/lib/utils';

const units: StructureUnit[] = [
  {
    id: 'example-root',
    type: 'organization',
    name: 'Example organization',
    parentId: null,
    ancestorIds: [],
  },
  {
    id: 'example-site',
    type: 'site',
    name: 'North office',
    parentId: 'example-root',
    ancestorIds: ['example-root'],
  },
  {
    id: 'example-department',
    type: 'department',
    name: 'Operations',
    parentId: 'example-site',
    ancestorIds: ['example-root', 'example-site'],
  },
  {
    id: 'example-other',
    type: 'department',
    name: 'Operations',
    parentId: 'example-root',
    ancestorIds: ['example-root'],
  },
];
const deepUnits: StructureUnit[] = [...units];
for (let depth = 3; depth < 8; depth += 1) {
  const parent = deepUnits.at(-1);
  // Start below the site's department, then continue to the configured depth limit.
  const previous = depth === 3 ? units[2] : parent;
  if (previous)
    deepUnits.push({
      id: `deep-${depth}`,
      type: 'department',
      name: depth === 7 ? 'Regional quality assurance and continuous improvement' : `Team ${depth}`,
      parentId: previous.id,
      ancestorIds: [...previous.ancestorIds, previous.id],
    });
}
/** Uses the production presentation with inert commands; never reads identity or APIs. */
export function StructureGallery() {
  const [state, setState] = useState('populated');
  const [selected, setSelected] = useState<string>();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  return (
    <section aria-labelledby="structure-gallery-heading" className="flex flex-col gap-5">
      <h2 id="structure-gallery-heading" className="section-title">
        Organization structure and contextual details
      </h2>
      <Field className="max-w-xs">
        <FieldLabel htmlFor="structure-gallery-state">Example state</FieldLabel>
        <NativeSelect
          id="structure-gallery-state"
          className="w-full"
          value={state}
          onChange={(event) => {
            setState(event.target.value);
            setSelected(undefined);
            setToolsOpen(
              [
                'selected',
                'tools-open',
                'adding',
                'draft',
                'outline',
                'outline-long-name',
              ].includes(event.target.value),
            );
            setAdding(['adding', 'draft'].includes(event.target.value));
            setDraft(event.target.value === 'draft' ? 'Regional operations' : '');
            setMessage('');
          }}
        >
          {[
            'empty',
            'populated',
            'loading',
            'selected',
            'tools-open',
            'adding',
            'draft',
            'long-name',
            'wide',
            'navigation',
            'invalid-move',
            'conflict',
            'narrow',
            'outline',
            'outline-long-name',
            'outline-deep',
            'outline-narrow',
          ].map((value) => (
            <NativeSelectOption value={value} key={value}>
              {value.replaceAll('-', ' ')}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {state === 'navigation' && (
        <p className="text-sm text-muted-foreground">
          Explore this wide chart with canvas drag, Hand mode, scroll/pinch zoom and keyboard
          navigation. Fit chart restores the overview. These gestures change only the view.
        </p>
      )}
      {state === 'loading' ? (
        <ContentLoading label="Loading structure…" shape="list" />
      ) : (
        <div
          className={cn(
            'structure-gallery-example',
            ['narrow', 'outline-narrow'].includes(state) && 'max-w-xs',
          )}
        >
          {state === 'invalid-move' && (
            <Notice message="A unit cannot move into its own descendant. The saved tree remains unchanged." />
          )}
          {state === 'conflict' && (
            <Notice message="Saved structure changed. Read it back and compare the intended destination before explicitly retrying." />
          )}
          {message && (
            <p role="status" className="sr-only">
              {message}
            </p>
          )}
          <StructureTree
            key={state}
            initialView={state.startsWith('outline') ? 'outline' : 'cards'}
            units={
              state === 'empty'
                ? units.slice(0, 1)
                : ['long-name', 'outline-long-name'].includes(state)
                  ? units.map((unit) =>
                      unit.id === 'example-site'
                        ? {
                            ...unit,
                            name: 'North manufacturing and regional distribution operations campus',
                          }
                        : unit,
                    )
                  : ['wide', 'navigation'].includes(state)
                    ? [
                        ...units,
                        ...Array.from(
                          { length: 12 },
                          (_, index): StructureUnit => ({
                            id: `wide-${index}`,
                            name: `Regional office ${index + 1}`,
                            type: 'site',
                            parentId: 'example-root',
                            ancestorIds: ['example-root'],
                          }),
                        ),
                      ]
                    : ['outline-deep', 'outline-narrow'].includes(state)
                      ? deepUnits
                      : units
            }
            selectedId={state === 'selected' ? (selected ?? 'example-department') : selected}
            toolsOpen={toolsOpen}
            onToolsOpenChange={setToolsOpen}
            disabled={draft !== ''}
            hasDraft={draft !== ''}
            createPanel={
              adding ? (
                <Card size="sm" variant="embedded">
                  <CardHeader>
                    <CardTitle>
                      <h3>New unit</h3>
                    </CardTitle>
                    <CardDescription>
                      Fixture form for reviewing expanded and collapsed drafts.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <Field>
                      <FieldLabel htmlFor="fixture-unit-name">Example unit name</FieldLabel>
                      <Input
                        id="fixture-unit-name"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder="e.g. Operations"
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => setMessage('Fixture: no organization data was changed.')}
                      >
                        Add unit
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setDraft('');
                          setAdding(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : undefined
            }
            onSelect={(id) => {
              setSelected(id);
              setAdding(false);
            }}
            onAdd={(id) => {
              setSelected(id);
              setAdding(true);
              setToolsOpen(true);
              setMessage('');
            }}
            onAction={() => setMessage('Fixture: open the selected unit’s focused editor.')}
            onDrop={() =>
              setMessage('Fixture: preview the old/new paths, then confirm before writing.')
            }
            organizationHref="#structure-gallery-heading"
          />
        </div>
      )}
    </section>
  );
}
