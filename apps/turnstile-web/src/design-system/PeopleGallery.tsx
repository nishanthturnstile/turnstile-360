import { Notice } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
export function PeopleGallery() {
  return (
    <section className="flex flex-col gap-5" aria-label="People administration examples">
      <h2 className="section-title">People and scoped access</h2>
      <Card>
        <CardHeader>
          <CardTitle>Example member</CardTitle>
          <CardDescription>Active · Verified display · Inert gallery fixture</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Badge>Unit manager</Badge>
          <p>Read and manage units · Example organization / North / Operations</p>
          <p>
            Includes child units. Role names describe assignments; permissions and scope determine
            access.
          </p>
          <Notice message="Saved access changed. Keep the draft, reload current data, then review again." />
          <Notice success message="Saved. Current access has been refreshed." />
        </CardContent>
      </Card>
      <Notice message="Delivery is uncertain. Check the current command outcome before making another change." />
    </section>
  );
}
