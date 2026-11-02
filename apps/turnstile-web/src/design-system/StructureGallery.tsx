import { useState } from 'react';
import { ContentLoading } from '@/components/content-loading';
import { Notice } from '@/components/notice';
import { Field, FieldLabel } from '@/components/ui/field';
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
/** Uses the production presentation with inert commands; never reads identity or APIs. */
export function StructureGallery() {
  const [state, setState] = useState('populated');
  const [selected, setSelected] = useState<string>();
  const [message, setMessage] = useState('');
  return (
    <section aria-labelledby="structure-gallery-heading" className="flex flex-col gap-5">
      <h2 id="structure-gallery-heading" className="section-title">
        Visual structure editor
      </h2>
      <Field className="max-w-xs">
        <FieldLabel htmlFor="structure-gallery-state">Example state</FieldLabel>
        <NativeSelect
          id="structure-gallery-state"
          className="w-full"
          value={state}
          onChange={(event) => {
            setState(event.target.value);
            setMessage('');
          }}
        >
          {['empty', 'populated', 'loading', 'selected', 'invalid-move', 'conflict', 'narrow'].map(
            (value) => (
              <NativeSelectOption value={value} key={value}>
                {value.replaceAll('-', ' ')}
              </NativeSelectOption>
            ),
          )}
        </NativeSelect>
      </Field>
      {state === 'loading' ? (
        <ContentLoading label="Loading structure…" shape="list" />
      ) : (
        <div className={cn(state === 'narrow' && 'max-w-xs')}>
          {state === 'invalid-move' && (
            <Notice message="A unit cannot move into its own descendant. The saved tree remains unchanged." />
          )}
          {state === 'conflict' && (
            <Notice message="Saved structure changed. Read it back and compare the intended destination before explicitly retrying." />
          )}
          {message && <Notice success message={message} />}
          <StructureTree
            units={state === 'empty' ? units.slice(0, 1) : units}
            selectedId={state === 'selected' ? (selected ?? 'example-department') : selected}
            onSelect={setSelected}
            onAdd={() => setMessage('Fixture: add under the chosen parent.')}
            onAction={() => setMessage('Fixture: open the selected unit’s inline editor.')}
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
