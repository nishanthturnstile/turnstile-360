# Turnstile 360 web design system

Designers and developers use the same working components at
[localhost:23600/design-system](http://localhost:23600/design-system) while the
Compose development stack is running (`pnpm dev`). The gallery includes light/dark
preview, semantic surfaces, typography, button variants/sizes, form states, feedback
and loading. Native selection includes normal and invalid field examples. It uses fixture text and makes no account/API requests. The gallery's
module and route are excluded from production builds; the product currently opens
in light mode. No theme preference is stored.

The accepted stack, preset identity, ownership and technical boundaries live in
[architecture.md](../../architecture.md#web-design-system). Implementation and dated
verification live in [IN_PROGRESS.md](../../IN_PROGRESS.md). This guide defines how to
use and maintain that system; it does not authorize new product workflows.

## Sources of truth

| Concern                                         | Authoritative source                                                            | Working rule                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Palette, light/dark roles, fonts, radius        | [src/index.css](../../apps/turnstile-web/src/index.css)                         | Edit semantic variables here; do not copy raw colors into screens or maintain a second token file. |
| Registry, primitive base, style, icons, aliases | [components.json](../../apps/turnstile-web/components.json)                     | Keep CLI output consistent with the accepted architecture.                                         |
| Component appearance and interaction            | [components/ui](../../apps/turnstile-web/src/components/ui)                     | Use component variants; change shared primitives when the change should apply everywhere.          |
| Product compositions                            | [components](../../apps/turnstile-web/src/components), feature UI               | Compose primitives and keep product-specific behavior with its feature.                            |
| Shared visual review                            | [DesignSystem.tsx](../../apps/turnstile-web/src/design-system/DesignSystem.tsx) | Add representative states when a reusable pattern changes.                                         |
| Installed versions                              | [Web manifest](../../apps/turnstile-web/package.json), root lockfile            | Use exact versions and pnpm; commit the lockfile with dependency changes.                          |

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
success state. Chart and unused sidebar tokens are retained from the preset. Delivered
workspace navigation uses the shared background/foreground and border roles; chart tokens
do not imply implemented chart features. Red chart colors are a
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

Use `NativeSelect`/`NativeSelectOption` for finite supported lists such as time zones and
fixed unit types. Keep visible labels, associated errors and native keyboard behavior.
`NativeSelect` applies `className` to its wrapper (which owns the full-width layout and
the trailing icon); style the control itself through the wrapper or a future explicit
control prop rather than expecting `className` to reach the `<select>`.

Use `FieldGroup`/`Field` for forms, `FieldSet`/`FieldLegend` for related controls,
and `FieldDescription`/`FieldError` for associated help/errors. Invalid controls need
`aria-invalid` and `aria-describedby`; their Field needs `data-invalid`. Pending fields
use `data-disabled` and the control's `disabled`. Password reveal composes `InputGroup`,
`InputGroupInput`, `InputGroupAddon` and `InputGroupButton` with an accessible name and
pressed state. Group addons never replace the input's visible label.

Configuration edits use explicit save/cancel. A removal confirmation names the saved
unit and its ancestry, with a destructive final action and an ordinary Cancel action.
Keep the selected editor visible for validation or uncertain-response readback; never
announce removal before the API confirms it. The gallery includes a fixture-only example.

Compose cards from Header/Title/Description, Content and Footer as needed. Put a real
heading inside `CardTitle` when it introduces a page section. Use `Notice` for shared
error/status callouts, `Badge` for short status labels, `Separator` for dividers, and
`Skeleton` for pending content. Announce loading once, mark decorative skeletons
`aria-hidden`, and keep authenticated startup neutral until the backend verifies the
session. Use shared `ContentLoading` for form, list and overview placeholders, and
`PendingContent` to retain mounted content/drafts during navigation or a read retry.
Keep navigation outside these boundaries. Use `LoadingStatus` for small server checks;
compose a decorative `Spinner` into the active action for saves/readback. Do not add
artificial delays or replace existing form entries with skeletons during a save. All
loading indicators respect reduced motion. The gallery includes all three shapes and
an action spinner. Changing presentation must preserve existing auth/session/permission behavior.

Users keeps its header and subtab navigation visible during verified tab transitions.
Only cold tab content uses a list placeholder. Cached results remain visible during a
background update with a small status message, as demonstrated by the Roles gallery.
Do not substitute rows from a different filter while that filter loads. Cache policy,
authority boundaries and invalidation are defined in architecture.md.

This project uses Base UI. Navigation uses the shared `ButtonLink` composition,
which renders a router link with native anchor semantics and the same `buttonVariants` as actions:
`<ButtonLink href="/path" variant="outline">…</ButtonLink>`. Base UI's non-native
Button applies button semantics even to rendered anchors, so reserve it for actions
and custom action triggers. Use real links for navigation and buttons for actions.
Check current component documentation before adding a new interaction; Radix `asChild`
examples use a different API.

Workspace layout and scroll ownership follow the
[architecture](../../architecture.md#web-navigation-and-scroll-ownership). Use `AppLink`
for ordinary text navigation and `ButtonLink` for button appearance; reserve
`window.location` for full auth/identity navigation. Setup uses the shared `SetupProgress` composition above its independently scrolling form;
its current-step state also appears in the fixture-only gallery. Keep neutral entry and
incomplete setup/waiting outside completed workspace navigation. Place page content in `ScrollRegion`
and keep persistent navigation outside its scrolling area. Settings owns its compact section row and nested
content pane; avoid adding a document scrollbar or keying the whole shell
by URL. The gallery's bounded navigation example demonstrates independent scrolling.

Completed workspaces compose `WorkspaceNavigation` with real `ButtonLink` destinations.
Use its transient collapse control, named icon links and generated Tooltip. At narrow
widths the generated Sheet supplies focus trapping, dismissal and a visible title.
Close on accepted router navigation so a cancelled dirty-form warning preserves the menu
and draft. Keep collapse state in memory. Settings sections remain a horizontal link row
at every width, with the Settings label on its own preceding line in every section,
including Structure. Keep this shared header consistent while the chart owns its canvas.
The gallery uses this same navigation
with inert anchor destinations; it reads no account or configuration data.

Use the generated Empty composition for honest dashboard availability, with actions only
for delivered destinations. The optional first-unit suggestion belongs only to managers
of completed v1 organizations without a non-root unit; it uses canonical configuration,
never a second onboarding model or browser storage.

## Onboarding structure editing and gallery

Completed workspaces use the canonical scoped Structure destination described under
Access directories below. Its scoped adapter now reuses the camera/layout helpers with
its own guarded workflows; the floating onboarding tools described here remain separate.

The legacy `StructureTree` presentation serves onboarding and inert gallery examples through the owning
`StructureEditor` controller. Use contextual + / Add below to infer the parent and allowed
type. Selecting a connected card opens its details and actions; Add a unit opens the
same creation form in the floating tools panel. Keep explicit rename Save/Cancel and named unused-leaf removal. The root’s
name always comes from Organization; show full paths when names repeat.

The default chart places parents above their children and draws connections on a quiet
dotted surface. the managed gallery example gives the chart its available content width and height, beneath
a compact heading and persistent navigation. Avoid a second map title, permanent inspector
column, page scrollbar or explanatory section below the canvas.

The chart's fixed navigation bar provides a Hand toggle, zoom out/in, clickable zoom
percentage (reset to 100%) and Fit chart. Drag empty space to pan; Hand mode permits panning
from cards too. Space plus drag works with the canvas focused, and middle-button drag
also pans. Scroll/trackpad movement pans; Ctrl/Command plus scroll zooms at the pointer in
10-percentage-point steps, matching +/− buttons and keys (for example, 74% → 84% → 94%).
Touch users can drag the canvas or pinch with two fingers. Focus the canvas for arrow-key
pan, +/− zoom, 0 reset and Home to fit. Escape ends a camera gesture and returns to selection.
Keep these controls available while tools are collapsed, without moving cards relative
to their connections. Navigation must never submit an organization mutation. Fit accounts
for the tools panel; filtered results fit into view. No-result messaging stays fixed.

One nonmodal floating **Structure tools** panel contains search, the view selector and
selected-unit operations. It starts collapsed in the managed gallery example; selecting a card or its + opens
it. Onboarding opens its first-unit form initially. Use the generated Base UI Collapsible
with `keepMounted`: collapsing is transient and must preserve create/rename/move drafts,
validation, pending writes and readback controls. A failed hidden write reopens its editor.
The panel scrolls independently within the canvas at narrow widths. It takes no layout
column; Fit chart and selection account for its occupied area on wider canvases.

Automatic positions come only from visible canonical parentage; camera pan/zoom, branch
collapse and outline scroll are transient. Compact outline uses one bordered list with dense, equal-height rows,
leading branch chevrons/ancestry guides, aligned direct-child counts and horizontal Add/Move
controls. Wide lists align unit types in a separate column; narrow lists place the type
under the name. Truncate long names visually while keeping their full path in the named
Details button and selected-unit panel. Indent only the identity, preserving action/count
alignment across depths. Deep lists scroll within the canvas rather than the page; totals
occupy a separate footer so they never obscure the rows. Keep
unit row keys stable across parent changes and selected ancestor paths expanded. Search
shows matches plus ancestors; disable drag while filtered. The selected unit has a concise
purpose/path and contextual rename/move/remove actions. The creation form supports repeated
additions and, in the managed gallery example, explicit valid-parent selection. Use the Card `embedded` variant
for these compositions inside the floating surface; avoid nested rings and rounded cards.

Routine create/rename/remove/move confirmations use an accessible quiet announcement and
the saved chart/input state, without a persistent generic Alert. Errors and uncertain
writes retain visible contextual Notices and their explicit recovery actions. Never show
Load latest / Refresh session as routine post-save actions. Unit-type guidance is available
on demand inside the tools panel; it does not imply membership, access or workflow setup.

Moves always use one old/new-path preview and Confirm move, from either Move to… or a
pointer/touch handle. The chart owns touch gestures for its camera; its dedicated move
handle retains separate gesture ownership. Outline touch scrolling remains native, with
touch-action restricted on its move handle. Highlight valid targets without moving target geometry. Escape,
pointer cancellation or dropping outside a valid target cancels without a write. Keep
Move to… complete for keyboard and click/tap users. Never replace saved cards before a
server confirmation or announce success before it. A conflict/uncertain response retains
the destination and requires explicit readback before another confirmation.

The gallery's structure example switches between empty, populated, loading, selected,
tools-open, adding, draft, long-name, wide, navigation, invalid-move, conflict and narrow states, plus
outline, outline-long-name, outline-deep and outline-narrow examples.
Its draft example preserves the input when tools collapse. Surface buttons keep card
content readable while editing disables their actions. It uses the production presentation with inert
fixture commands; it performs no account/API requests. Do not add persistent coordinates,
sibling sorting, an additional palette or a diagram dependency for this composition.

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
5. Run the [workspace verification](../standards/workspace.md#verification), plus
   `pnpm test:browser:auth` for changes touching authentication controls/layout or bundled
   fonts. Record actual results and any limits in `IN_PROGRESS.md` before handoff.

## People patterns

People uses independent Members, Invitations, Roles and Structure sections within the
existing workspace shell. Directory rows and task inspectors expose identity freshness, invitation delivery, actual role
permissions and all independent grant sources. Scope controls use canonical paths and an
explicit Include child units checkbox; a role name never substitutes for its permissions.
The People gallery uses fixed examples without account data or network requests.

Editors keep drafts in memory with explicit discard and dirty-navigation protection. Show
localized loading and bounded errors, retain input after conflicts, and show saved data only
after owning-service confirmation. Impact review precedes access changes; uncertain outcomes
offer command readback without automatic replay.
Same-subject permission/session recovery retains mounted draft owners while hiding/inerting
blocked content and pausing loaders. Fresh access invalidates old reviews; sign-out or a
different subject clears drafts. Full document navigation ends these memory-only entries.
Use the generated Base UI Checkbox with
FieldLabel for scope and permission choices. Long names wrap and native controls retain
keyboard/touch behavior within the existing responsive layout and reduced-motion rules.
Run `pnpm test:browser:people` for the owning HTTPS/OIDC/SMTP administration, scoped-manager
and recipient journeys; retain the authentication browser regression check above.

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
reduced-motion behavior. Sheet/Tooltip/Empty/Collapsible are generated through the same pinned CLI;
Sheet uses the semantic foreground overlay token and all three use the shared `cn` helper.
Existing Button customizations are preserved. Biome enables Tailwind directives for web CSS only.
Dependency-boundary validation resolves the same `@/` alias as TypeScript and Vite
through the root `tsconfig.boundaries.json` (its resolver plugin uses repository-relative paths).

Keep the bundled [third-party notices](../../apps/turnstile-web/public/third-party-notices.txt)
with the web assets when updating components, icons or fonts. The root proprietary
LICENSE remains authoritative for Thaarei-owned code.

## Access directories

Users directories and scoped Structure compose the shared access surface and compact
toolbar. Users task sheets overlay full-width directories at desktop and fill the phone
viewport. Structure uses a bounded chart workspace with a desktop overview and guarded
task sheets. Use `RoleTable` and the scoped `HierarchyWorkbench` from the People feature for
these domain presentations; the development gallery demonstrates them with inert fixtures.
Retain drafts under the existing session/access boundary. Users modal sheets contain
focus and return it to the initiating control; Escape, outside dismissal and Close share
the same guard. Hidden or unauthorized tasks remain inert. Structure overviews focus
their named region on desktop and become sheets on phones. Explicit task buttons separate
rename, child creation, moves and deletion; browsing never starts a rename draft.

Role directories use concise permission counts and previews, with full permissions in the editor; system and protected status use explicit
text. On phones the table retains identity and View; permission details remain in the
selected editor. Organization outlines use nested lists with named expand/collapse buttons
and `aria-expanded`/`aria-controls`. A branch retains its own row when collapsed. Only the
returned units receive Manage actions; ancestor context never receives an action. Result
counts exclude ancestor context and describe the authorized API result set, not all units
in the organization. Empty states explain search/access without implying hidden data exists.

Completed-workspace Structure has one scoped editor, with outline/chart presentations of
the complete authorized hierarchy and contextual ancestry. The hierarchy query assembles
100-unit pages only when their organization/Access revisions agree; a failed or cancelled
batch never replaces the previously verified view. Settings links to it; old URLs redirect.
People sections contain Members, Invitations and Roles only. A single Users sidebar
entry under People & access opens the authorized default section; see the
[People UI architecture](../../architecture.md#people-and-scoped-structure-ui-um-i10). Active links use explicit primary emphasis and aria-current in both
navigation areas. General settings combines company name and time zone. Unit readers get
View and a read-only inspector; eligible managers get mutation controls. Role action
selection exposes only the intended operation before review.

`HierarchyWorkbench` owns the completed-workspace chart, outline, local search, branch
focus and breadcrumbs. Use one compact heading/toolbar above an internally bounded
canvas. Desktop opens Chart; phones open Outline. Both use the same scoped normalized
nodes, with dashed ancestor-only cards and counts explicitly limited to visible authorized
units. Preserve selection/camera while data refreshes. Fit and focus account for the
desktop overview without narrowing/reflowing the chart. Camera gestures never submit
commands. Reuse the native camera/layout helpers; keep onboarding's full configuration
controller separate. The scoped gallery renders the production composition with inert
commands and empty, scoped, loading, refreshing, conflict, wide and narrow examples.

Unit selection opens an overview, with deliberate Add department/Rename/Move/Delete
tasks. Context ancestors never gain unit-management buttons; a company manager's global
Add site remains independently authorized. Child creation requires descendant coverage
and a legal level/type. Destination choices omit self, descendants, the current parent
and known scope/type/depth/name conflicts. Explain visible non-leaf removal restrictions,
while the server checks hidden references/current state. Search parent choices by full
path. Review shows old/new paths, legal type and real move-impact counts. Keep exact
command keys through uncertain outcomes and offer uncached receipt/current-hierarchy
readback; do not automatically replay. Explicit stale-context reload preserves intended
fields for comparison and re-review. Only real edits/reviews mark navigation dirty.

Members use the MemberTable and MemberOverview compositions: person/contact, explicit
membership status, and each saved role's coverage. Keep member status distinct from
identity freshness and show suspended roles as saved assignments, not active access.
Open in overview mode; Edit access deliberately enters the transient assignment form.
Keep suspension/reactivation in a separate named section with impact confirmation.
Retained imported access must remain visible; account IDs and retired import history
belong in secondary details. Keep role and coverage labels above their controls and put
long permission previews behind disclosure. Do not invent global metrics from a paged or
filtered member list. Directory actions stay disabled through post-save access refresh.

Use the shared Card `panel` variant for access inspectors. Keep one task header/close,
a scrollable body and a persistent footer inside the Users sheet at every viewport.
Keep keyboard focus rings and use the shared AlertDialog for dirty dismissal. The
Structure overview/task sheets retain the same fixed header, scrolling body and action footer.
Review/uncertain-save actions share that footer while retaining the owning review state.
Prevent closing a pending or uncertain write; deliberate Cancel discards only transient
changes. Role-action switching must not silently lose dirty fields. Group permissions by
purpose and label required/company choices. New assignments require an explicit role
choice. Invite member opens the owning composer directly from Members or Invitations.
Bulk invitations use a bounded task with the same assignment composition, associated
recipient errors, explicit review and per-recipient outcomes. Dismissal is separate from
successful-save notification. Role View opens an overview; Duplicate opens an editable
new custom-role draft. Review shows added/removed permissions and assignments. Keep
mobile invitation delivery and expiry available, and test internal table overflow as
well as document width. Section navigation uses semantic AppLinks without button styles.
See the [People UI architecture](../../architecture.md#people-and-scoped-structure-ui-um-i10)
for filtering, usage-count visibility and durable-command recovery rules.

CSV import tasks compose the shared task sheet, fields, assignment review, progress and
row-result table. Show progress counts with text; preserve independent invitation/mail
status, show explicit cancellation consequences and keep long filenames/addresses wrapped.
