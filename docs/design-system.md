# Turnstile 360 web design system

Designers and developers use the same working components at
[localhost:23600/design-system](http://localhost:23600/design-system) while the
Compose development stack is running (`pnpm dev`). The gallery includes light/dark
preview, semantic surfaces, typography, button variants/sizes, form states, feedback
and loading. It uses fixture text and makes no account/API requests. The gallery's
module and route are excluded from production builds; the product currently opens
in light mode. No theme preference is stored.

The accepted stack, preset identity, ownership and technical boundaries live in
[architecture.md](../architecture.md#web-design-system). Implementation and dated
verification live in [IN_PROGRESS.md](../IN_PROGRESS.md). This guide defines how to
use and maintain that system; it does not authorize new product workflows.

## Sources of truth

| Concern                                         | Authoritative source                                                         | Working rule                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Palette, light/dark roles, fonts, radius        | [src/index.css](../apps/turnstile-web/src/index.css)                         | Edit semantic variables here; do not copy raw colors into screens or maintain a second token file. |
| Registry, primitive base, style, icons, aliases | [components.json](../apps/turnstile-web/components.json)                     | Keep CLI output consistent with the accepted architecture.                                         |
| Component appearance and interaction            | [components/ui](../apps/turnstile-web/src/components/ui)                     | Use component variants; change shared primitives when the change should apply everywhere.          |
| Product compositions                            | [components](../apps/turnstile-web/src/components), feature UI               | Compose primitives and keep product-specific behavior with its feature.                            |
| Shared visual review                            | [DesignSystem.tsx](../apps/turnstile-web/src/design-system/DesignSystem.tsx) | Add representative states when a reusable pattern changes.                                         |
| Installed versions                              | [Web manifest](../apps/turnstile-web/package.json), root lockfile            | Use exact versions and pnpm; commit the lockfile with dependency changes.                          |

The preset builder is [biekTCUvD](https://ui.shadcn.com/create?preset=biekTCUvD).
The builder records the starting preset; the checked-in tokens and components describe
the actual application, including reviewed local adaptations. Design-tool libraries
should use the same semantic names, variants and state names. No Figma library or
automatic design-tool synchronization is configured by this change.

## Design language

Use `background/foreground` for the page, `card/card-foreground` for content surfaces,
`primary/primary-foreground` for the principal action, and
`secondary/secondary-foreground` for supporting actions. `muted/muted-foreground`
serves supporting text and quiet surfaces. `accent/accent-foreground` is a subtle
interaction surface, not the brand action color. Use `border`, `input` and `ring`
for boundaries, controls and focus. Always pair a surface with its foreground;
never communicate state through color alone.

Errors and destructive actions use the destructive variants. Ordinary confirmations
use a neutral `Alert` with `role="status"`; do not treat the brand green as a universal
success state. Chart and sidebar tokens are retained from the preset for future use;
they do not imply implemented chart or navigation features. Red chart colors are a
data palette, independent of error meaning. Additional status roles require a shared
token/variant decision, light/dark review and matching examples.

IBM Plex Sans is the body/control face; Noto Sans is the heading face. Both are
self-hosted variable fonts with system sans-serif fallback and swap loading. Existing
page titles use the shared `.page-title` style (30–38px, weight 600); section titles
use `.section-title` (20px, weight 600). Body copy uses 16px; controls and supporting
text use the primitive's 14px defaults; compact metadata uses 12px. Use a 4px spacing
unit with 16–32px content gaps, and the configured Maia radius scale. Avoid local
font, color or radius overrides on component instances.

Keep one clear main action per form. Maia buttons and text controls are rounded;
content cards use their own shared radius. Use Hugeicons for interface icons,
passing icon objects to `HugeiconsIcon`, with `data-icon="inline-start"` or
`data-icon="inline-end"` inside buttons. Preserve the existing Turnstile brand mark.

## Developer patterns

Import primitives through `@/components/ui/*`. Use `className` for layout and
component props for appearance. Conditional classes use `cn` from `@/lib/utils`.
Avoid custom button/input/callout/card markup and page-specific copies of primitives.

```tsx
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

<form onSubmit={submit} aria-busy={busy}>
  <FieldGroup>
    <Field data-disabled={busy}>
      <FieldLabel htmlFor="email">Email address</FieldLabel>
      <Input id="email" type="email" autoComplete="email" required disabled={busy} />
    </Field>
    <Button type="submit" disabled={busy}>
      {busy ? 'Saving…' : 'Save'}
    </Button>
  </FieldGroup>
</form>;
```

Use `FieldGroup`/`Field` for forms, `FieldSet`/`FieldLegend` for related controls,
and `FieldDescription`/`FieldError` for associated help/errors. Invalid controls need
`aria-invalid` and `aria-describedby`; their Field needs `data-invalid`. Pending fields
use `data-disabled` and the control's `disabled`. Password reveal composes `InputGroup`,
`InputGroupInput`, `InputGroupAddon` and `InputGroupButton` with an accessible name and
pressed state. Group addons never replace the input's visible label.

Compose cards from Header/Title/Description, Content and Footer as needed. Put a real
heading inside `CardTitle` when it introduces a page section. Use `Notice` for shared
error/status callouts, `Badge` for short status labels, `Separator` for dividers, and
`Skeleton` for pending content. Announce loading once, mark decorative skeletons
`aria-hidden`, and keep authenticated startup neutral until the backend verifies the
session. Changing presentation must preserve existing auth/session/permission behavior.

This project uses Base UI. Navigation uses the shared `ButtonLink` composition,
which renders a native anchor with the same `buttonVariants` as actions:
`<ButtonLink href="/path" variant="outline">…</ButtonLink>`. Base UI's non-native
Button applies button semantics even to rendered anchors, so reserve it for actions
and custom action triggers. Use real links for navigation and buttons for actions.
Check current component documentation before adding a new interaction; Radix `asChild`
examples use a different API.

## Designer and developer handoff

1. Start from the live gallery. Identify the semantic role and existing component/variant
   before proposing a new style. Use the same names in design files and implementation.
2. Describe a reusable change once: intended use, token or primitive affected, required
   variants, and default/hover/focus/disabled/pending/invalid states. Include narrow
   layouts, long text and recovery/error behavior when relevant.
3. Update the authoritative CSS or primitive, then its gallery example and consumers
   in the same change. Do not introduce a parallel palette or redraw an existing
   primitive just for one screen. Add feature-specific compositions only where needed.
4. Review keyboard order, visible focus, input labels, contrast, 320px layouts, touch
   use and light/dark previews. The application remains light by default until a
   separately agreed theme-switching flow exists. Motion should be short and restrained;
   reduced-motion mode removes movement and loading pulses.
5. Run the [workspace verification](standards/workspace.md#verification), plus
   `pnpm test:browser:auth` for changes touching authentication controls/layout or bundled
   fonts. Record actual results and any limits in `IN_PROGRESS.md` before handoff.

## CLI maintenance

Run shadcn commands from `apps/turnstile-web`. The installed CLI version and libraries
are pinned in its manifest; routine work uses `pnpm exec shadcn` for reproducibility.
The initial setup used the owner's `pnpm dlx shadcn@latest` request (resolved to 4.23.0),
initialized the missing config with `init --preset biekTCUvD --base base --no-monorepo`,
then ran `apply --preset biekTCUvD --yes`. Primitives came from the `@shadcn` registry.

```bash
pnpm exec shadcn info --json
pnpm exec shadcn preset resolve --json
pnpm exec shadcn docs button
pnpm exec shadcn search @shadcn -q dialog
pnpm exec shadcn add @shadcn/dialog --dry-run
```

Install components when they are needed; do not bulk-install a speculative library.
Review generated files, dependencies and licenses, then format with Biome. Before
updating an existing primitive, inspect `add --dry-run` and `add --diff` and merge
deliberately. A full `apply` can replace component/CSS/font customizations. Agree the
intended scope before switching presets; do not rerun it as routine maintenance.

Current local adaptations are explicit label content/association and stable error keys
for Biome, narrowly explained accessibility lint suppressions for upstream composite
groups, explicit button/badge transition properties, button press feedback, and
reduced-motion behavior. Biome enables Tailwind directives for web CSS only.
Dependency-boundary validation resolves the same `@/` alias as TypeScript and Vite
through the root `tsconfig.boundaries.json` (its resolver plugin uses repository-relative paths).

Keep the bundled [third-party notices](../apps/turnstile-web/public/third-party-notices.txt)
with the web assets when updating components, icons or fonts. The root proprietary
LICENSE remains authoritative for Thaarei-owned code.
