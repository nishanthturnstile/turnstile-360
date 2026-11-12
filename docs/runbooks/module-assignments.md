# Central Turnstile module assignment

MOD-I03 adds desired module selection to a registered Turnstile product. Admin and
Operator with current MFA can save/review/approve; Viewer reads. The owning architecture
is [centrally managed modules](../../architecture.md#proposed-centrally-managed-turnstile-modules).
Assignment does not install images or grant new module rights. Approving an explicit removal
now restricts existing authority through the [transition workflow](module-transitions.md).

## Staff workflow

1. Open Clients, choose the client and installation, then choose **Modules and dependencies**
   on its Turnstile product. DMS has no module assignment control.
2. Choose a published catalogue. A draft catalogue and unsigned metadata cannot be assigned.
   The list loads 50 published summaries at a time. Saved assignments keep their exact
   catalogue even when it is outside the current list page.
3. Core modules are fixed. Select Individual modules with checkboxes or the keyboard.
   Solid graph arrows and the equivalent text links identify mandatory dependencies;
   dashed arrows identify optional integrations. Required extra Individual modules are
   proposed visibly and are not silently approved. Deselecting a module still required
   by a selected dependant leaves it in the proposed closure and shows why.
4. Enter a reason and choose **Review and save draft**. Inspect the complete resolved set,
   including additional dependencies. Explicitly confirm it, then save the draft.
   Saving does not replace the approved desired assignment.
5. Enter the approval reason and choose **Review desired approval**. Confirm the same saved
   set again to approve it as the desired assignment. Unsaved edits disable approval.
   Product policy or assignment changes require a reload, a new reviewed draft and a
   current revision; a stale approval never substitutes a different selection.

Approval records immutable desired metadata. It grants no customer role or permission,
does not approve product activation and does not prove installation. Reclassification
creates a new catalogue; publication does not rewrite any installation's assignment.
There is no client-wide apply/default operation.

## State and compatibility

The view separates the saved draft, approved desired assignment, verified delivery,
authenticated installed claim and central allowed IDs. Legacy v1 supplies no module rights;
selected installations use the [v2 decision protocol](module-decisions.md). The legacy
`observed`/`effective` projection fields remain null: the page separately exposes current
`inventory` and `authority`, without claiming customer application or user permissions.
Full acknowledgement/effective status integration remains MOD-I09.

A desired selection shows **Awaiting package** without verified matching
artifact evidence. A product already paired with the existing v1 protocol also shows
**Upgrade required**. A suspended/rejected product shows **Restricted** independently of
the saved assignment. Preparing a legacy product's desired target does not activate it;
the reviewed upgrade and v2 compatibility floor follow the decision/transition runbooks.

The status projection also defines Ready for setup, Awaiting activation, Active and
Inventory mismatch for later owning verified adapters. Unit tests exercise these facts;
no staff endpoint accepts fabricated package/observation/effective input to reach them.
Current live handlers cannot show Active from assignment approval or ordinary product
approval alone. Current active-basis/removal commands are validated against persisted
authority; they cannot expand it. See the transition runbook for immediate restrictive
approval followed by separate package installation and staff activation.

## Operations and recovery

Owning generated migration 0012 and privilege migration 0013 add immutable assignment
snapshots and product-bound draft/desired pointers. Apply them through the established
private central migration procedure before deploying the new release. Application startup
does not run migrations. Keep existing volumes, staff and registry records.

`GET/POST /api/registry/products/[id]/modules` admits staff. Mutations require canonical
origin/CSRF, live Admin/Operator/current MFA, the full registered binding, a reason and
the current registry product revision. Request JSON is bounded to 32 KiB. A strict
`{type:"assignment.draft"|"assignment.approve", command:<shared assignmentCommand>}`
envelope contains no executable input, credentials or observation writer.

`command.expectedRevision` is the registry product revision. Both saves and approvals
advance it once, so product policy/pairing and assignment changes conflict coherently.
The new snapshot's revision is that resulting product revision. Gaps between approved
assignment revisions are expected. Advancing it does not change product policy state,
approval history. Draft saves grant no module authority; desired approvals can restrict
existing module authority atomically. Existing v1 grants remain foundation policy only.

The operation ID identifies the immutable snapshot and receipt. Profile creation and
canonical hashing happen before the short staff/product transaction. Snapshot, current
pointer, registry revision, registry audit and module receipt commit together. Approval
checks the saved draft revision and exact requested/resolved/profile/basis facts and the
existing recovery authority. Runtime cannot update/delete snapshots or move pointers
across products/kinds; Viewer never receives pairing material from this API.

On a lost response retain the tab and retry the same operation/body. Reauthenticate in
another tab if MFA expires. Receipt recovery requires current write role/MFA but returns
only the historical outcome; the UI separately reloads canonical current state. A retry
after a later narrowing/suspension cannot reapply or resurrect the old assignment.
Changed inputs require a new operation after reload/review. Before abandoning an attempted
request, the UI explicitly warns that it may have committed.

## Verification boundary

The central fixture runs the actual production Next handlers through HTTPS/proxy with
PostgreSQL and admitted sessions. It checks published-catalogue/closed-dependency
selection, full bindings, roles/MFA/CSRF, competing edits, atomic audit rollback, lost
approval/draft replies, immutable storage, cross-product pointer fences, later desired
removal/suspension replay and independent installations. Chromium drives keyboard
selection, dependency review, draft save and desired approval against those handlers.
Only that disposable browser context bypasses its test certificate; Node verifies the
fixture CA. No private customer environment is altered by these tests.

Exact production-image/live migration/target rollout remains a separate release check.
Selected customer image/access qualification follows the delivery, access and transition runbooks.
