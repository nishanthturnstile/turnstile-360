import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useState } from 'react';
import { ButtonLink } from '@/components/button-link';
import { Notice } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const swatches = [
  {
    name: 'Background',
    token: 'background / foreground',
    className: 'bg-background text-foreground',
  },
  { name: 'Card', token: 'card / card-foreground', className: 'bg-card text-card-foreground' },
  {
    name: 'Primary',
    token: 'primary / primary-foreground',
    className: 'bg-primary text-primary-foreground',
  },
  {
    name: 'Secondary',
    token: 'secondary / secondary-foreground',
    className: 'bg-secondary text-secondary-foreground',
  },
  { name: 'Muted', token: 'muted / muted-foreground', className: 'bg-muted text-muted-foreground' },
  {
    name: 'Accent',
    token: 'accent / accent-foreground',
    className: 'bg-accent text-accent-foreground',
  },
];

/** Development-only catalogue: real primitives, fixture text, no account or API access. */
export default function DesignSystem() {
  const [dark, setDark] = useState(false);
  const [visible, setVisible] = useState(false);
  return (
    <div className={cn('design-system', dark && 'dark')}>
      <main className="design-system-content">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <Badge variant="secondary">Turnstile 360 · Design system</Badge>
            <h1 className="page-title mt-5">One shared foundation.</h1>
            <p className="max-w-2xl text-muted-foreground">
              Live components for design and development. Maia shapes, mauve neutrals, emerald
              actions, and considered typography from preset biekTCUvD.
            </p>
          </div>
          <Button variant="outline" aria-pressed={dark} onClick={() => setDark(!dark)}>
            {dark ? 'Preview light theme' : 'Preview dark theme'}
          </Button>
        </header>
        <Separator />
        <section aria-labelledby="colors-heading" className="flex flex-col gap-4">
          <h2 id="colors-heading" className="section-title">
            Semantic colors
          </h2>
          <p className="text-sm text-muted-foreground">
            Each surface uses its paired foreground. Accent marks subtle interaction surfaces;
            primary identifies the main action. Destructive color is reserved for errors and
            removal.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {swatches.map(({ name, token, className }) => (
              <div
                key={name}
                className={cn(
                  'flex min-h-28 flex-col justify-end gap-2 rounded-xl border p-4',
                  className,
                )}
              >
                <p className="font-medium">{name}</p>
                <code className="text-xs">{token}</code>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Badge>Primary</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
        </section>
        <Separator />
        <section aria-labelledby="type-heading" className="flex flex-col gap-4">
          <h2 id="type-heading" className="section-title">
            Typography & rhythm
          </h2>
          <p className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            A familiar place. A fresh start.
          </p>
          <p className="max-w-2xl leading-relaxed">
            Noto Sans gives headings a clear hierarchy. IBM Plex Sans carries body text, labels and
            controls. Both variable fonts are bundled locally.
          </p>
          <p className="text-sm text-muted-foreground">
            4px spacing unit · 16–32px content gaps · responsive layout · shared Maia radii
          </p>
        </section>
        <Separator />
        <section aria-labelledby="actions-heading" className="flex flex-col gap-4">
          <h2 id="actions-heading" className="section-title">
            Actions
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button>
              Primary action
              <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" aria-hidden="true" />
            </Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Text action</Button>
            <Button variant="destructive">Destructive</Button>
            <Button disabled>Disabled</Button>
            <Button disabled>Saving…</Button>
          </div>
          <ButtonLink variant="link" className="w-fit" href="/forgot-password">
            Example navigation link
          </ButtonLink>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="xs">Extra small</Button>
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" variant="outline" aria-label="Example icon action">
              <HugeiconsIcon icon={ArrowUpRight01Icon} aria-hidden="true" />
            </Button>
          </div>
        </section>
        <section aria-labelledby="forms-heading" className="flex flex-col gap-4">
          <h2 id="forms-heading" className="section-title">
            Forms & states
          </h2>
          <div className="grid items-start gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Input patterns</CardTitle>
                <CardDescription>
                  Visible labels, helpful context and native autocomplete.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="sample-email">Email address</FieldLabel>
                    <Input
                      id="sample-email"
                      type="email"
                      placeholder="name@example.com"
                      autoComplete="off"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="sample-password">Password</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        id="sample-password"
                        type={visible ? 'text' : 'password'}
                        defaultValue="Example phrase only"
                        autoComplete="off"
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          aria-pressed={visible}
                          aria-label={visible ? 'Hide sample password' : 'Show sample password'}
                          onClick={() => setVisible(!visible)}
                        >
                          {visible ? 'Hide' : 'Show'}
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                    <FieldDescription>Example content only; nothing is submitted.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="sample-notes">Notes</FieldLabel>
                    <Textarea id="sample-notes" placeholder="Additional context…" />
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Validation & availability</CardTitle>
                <CardDescription>
                  Errors include text; disabled fields retain their labels.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field data-invalid>
                    <FieldLabel htmlFor="sample-invalid">Email address</FieldLabel>
                    <Input
                      id="sample-invalid"
                      defaultValue="incomplete@"
                      aria-invalid="true"
                      aria-describedby="sample-error"
                    />
                    <FieldError id="sample-error">Enter a complete email address.</FieldError>
                  </Field>
                  <Field data-disabled>
                    <FieldLabel htmlFor="sample-disabled">Unavailable field</FieldLabel>
                    <Input id="sample-disabled" disabled value="Not editable" />
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
          </div>
        </section>
        <section aria-labelledby="feedback-heading" className="flex flex-col gap-4">
          <h2 id="feedback-heading" className="section-title">
            Feedback & loading
          </h2>
          <div className="grid items-start gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-4">
              <Notice message="Example error: your changes could not be saved. Please try again." />
              <Notice success message="Example confirmation: your changes were saved." />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Loading content</CardTitle>
                <CardDescription>
                  Reserve space and announce loading once. Honor reduced motion.
                </CardDescription>
              </CardHeader>
              <CardContent aria-hidden="true" className="flex flex-col gap-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </CardContent>
              <CardFooter>
                <Badge variant="outline">Example state</Badge>
              </CardFooter>
            </Card>
          </div>
        </section>
        <Separator />
        <footer className="text-sm text-muted-foreground">
          Development reference · Components and tokens are the source of truth. Maintenance and
          handoff guidance: <code>docs/design-system.md</code>. Check keyboard focus, narrow layouts
          and both themes before handing off changes.
        </footer>
      </main>
    </div>
  );
}
