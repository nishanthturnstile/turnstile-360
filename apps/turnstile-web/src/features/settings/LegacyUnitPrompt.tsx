import { ButtonLink } from '@/components/button-link';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfiguration } from '../configuration/useConfiguration';

/** Optional manager-only suggestion; canonical reads never gate an already completed Home. */
export function LegacyUnitPrompt() {
  const { snapshot, loading, failure } = useConfiguration();
  if (
    loading ||
    failure ||
    !snapshot ||
    snapshot.setup.state !== 'completed' ||
    snapshot.setup.requirementVersion !== 1 ||
    snapshot.units.length !== 1 ||
    snapshot.units[0]?.type !== 'organization'
  )
    return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Add your first site or department</h2>
        </CardTitle>
        <CardDescription>
          Your workspace is already activated. Add a unit whenever you need one.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <ButtonLink href="/structure" variant="outline">
          Add an optional unit
        </ButtonLink>
      </CardFooter>
    </Card>
  );
}
