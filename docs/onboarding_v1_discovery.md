# Turnstile 360 Version 1 configuration discovery

Inspected on 2026-11-01 using the authorized administrator login. This inventory
records the observable Version 1 interface. The
[onboarding proposal](onboarding_design_proposal.md) evaluates these capabilities
against the current product scope and proposes their new homes.

## Coverage and evidence limits

All four requested URLs were accessible after authentication. Eight directly related
routes were also inspected through their local navigation. Inspection included all
tabs, opening create/edit forms, reading selectors, changing unsaved conditional
choices, downloading the user CSV template, opening all 21 RACI matrix views, and
selecting an organization for a populated analytics result.

No configuration was saved, account or delegation created, CSV uploaded, passkey
registered, message sent, or delete/reset/revoke/extend operation executed. Save
buttons and UI statements establish available controls, not successful persistence,
authorization enforcement, delivery, or workflow execution. The existing demo
installation cannot establish fresh-database or first-login behavior. Account/contact
records and credentials are intentionally omitted from this inventory.

| Requested area                                                                 | Inspected sections                                                                                      | Related routes inspected                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [Admin Settings](https://demo.turnstile360.com/admin-settings)                 | Company, Hierarchy, White Label, Risk Matrix; both matrix variants                                      | `/sso-management`, `/notification-settings`, `/security` |
| [Tenant Settings](https://demo.turnstile360.com/tenant-settings)               | Hierarchy, ID Naming, Risk Matrix, Manpower, Safety Metrics; 4×4 selection                              | None                                                     |
| [User Management](https://demo.turnstile360.com/user-management)               | List/filter controls, CSV import and template, user editor, temporary demo creation form, demo activity | `/role-management`, `/raci-matrix`, `/delegation`        |
| [Organization Structure](https://demo.turnstile360.com/organization-structure) | Tree, create form at all five levels, unit types, dates, node editor                                    | `/employee-unit-mapping`, `/org-rollup-analytics`        |

Related forms with empty datasets were inspected in their available empty/create
states. Destructive controls were identified without invoking them. The complete
post-upload import validation/results flow, demo extension/revocation behavior,
populated delegation operations and provider authentication remain unverified.

## Admin Settings

The outer Settings navigation contains General, SSO, Notifications and Security & MFA.
General contains four inner tabs. Its description calls these platform settings,
although most fields concern this organization's product configuration.

| Section     | Fields and controls                                                                                                                            | Business purpose                             | Dependencies and observations                                                                                                                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company     | Organization ID, read-only and system assigned; editable Company Name; Save Company Settings                                                   | Identify the organization in the application | This is a display name, not evidence of legal entity, registered address, tax or contact requirements. Identity must remain independent of name edits.                                                                                                                            |
| Hierarchy   | Five text labels: Level 1–5 Name; Save Hierarchy Settings; industry examples                                                                   | Adapt organization terminology               | Values shown were Plant / Site, Department, Sub-Department, Station / Location, Activity / Work Area. The node form labels level 5 Employee, a visible mismatch. No depth/type/relationship editor appears here.                                                                  |
| White Label | Logo file upload or logo URL; max 2 MB guidance; primary and secondary color pickers plus hex fields; custom domain; Save White Label Settings | Branding and appearance                      | An enterprise-plan activation notice appears. Enforcement, upload processing and custom-domain provisioning were not verified. Domains also have deployment/TLS implications.                                                                                                     |
| Risk Matrix | 3×3 and 5×5 selectors; per-band minimum score, maximum score, color picker and hex field; calculated preview; Save Risk Matrix Settings        | Classify severity × likelihood scores        | 5×5 shows Low 1–4, Medium 5–9, High 10–16, Extreme 17–25. Selecting 3×3 shows Low 1–2, Medium 3–4, High 6–9. The missing score 5 is not a possible product in a 3×3 multiplication matrix; future validation should cover reachable scores explicitly. No persistence was tested. |

Hierarchy examples describe manufacturing, hospital and retail structures. They are
guidance rather than selectable presets. The fifth example entity can be a person,
which contributes to ambiguity between units and employees.

### SSO configuration

[SSO Management](https://demo.turnstile360.com/sso-management) lists connections with
name, protocol, provider, active status, an Edit button and unlabeled icon controls.
One Azure/SAML connection was displayed as active. Simultaneously, a warning reported
missing WorkOS server credentials and named `WORKOS_API_KEY`, `WORKOS_CLIENT_ID` and
`WORKOS_REDIRECT_URI`. An active badge therefore does not establish working SSO.

The Add SSO Connection dialog contains:

- Connection Name, marked required.
- Identity Provider: Okta, Azure Active Directory, Google Workspace, OneLogin,
  Ping Identity, JumpCloud, Generic SAML 2.0 or Generic OIDC.
- Protocol: SAML 2.0 or OpenID Connect.
- Company Domain, with guidance that matching email domains prompt SSO.
- WorkOS Connection ID and WorkOS Organization ID.
- Set as default for organization; Cancel and Create Connection.

The Edit dialog exposes Connection Name, Active and Default for organization, plus
Cancel and Save Changes. The page explains service-provider-initiated and
identity-provider-initiated login. No provider round trip, connection test, toggle
or credential operation was executed. The business need is enterprise authentication;
the WorkOS implementation is not a requirement for the new product.

### Notifications

[Notification Settings](https://demo.turnstile360.com/notification-settings) combines
provider health, individual preferences, organization templates and delivery history.
Email is labeled SendGrid and Configured, with total sent and delivery rate. SMS is
labeled Twilio and Not Configured, with guidance naming its required environment
variables. Send Test is available; it was not invoked because it can send a message.

| Tab            | Available configuration or data                                                                                                                                                                                        | Purpose and limits                                                                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| My Preferences | Enable Email Notifications; Incident Alerts, Audit Notifications, Training Reminders, CAPA Actions, Emergency Alerts; Enable SMS Notifications; Emergency Only; phone number and Save; Daily Digest and Weekly Summary | Personal notification selection. The SMS phone/Save controls were disabled in the inspected state. This tab should not be interpreted as tenant-wide notification policy. Changes were not saved.                                                    |
| Templates      | Add Template; six email templates, each with View                                                                                                                                                                      | Add Template produced no observable form during inspection. Every existing template's View dialog was opened. The dialogs expose Subject, Email Body and variable names; subject/body values appeared empty. Editing or creation is not established. |
| History        | Recent notifications sent from this organization                                                                                                                                                                       | Empty state: no notifications sent yet. Populated row fields, filters and retry controls could not be inspected.                                                                                                                                     |

| Template          | Variables displayed                                         |
| ----------------- | ----------------------------------------------------------- |
| CAPA Assigned     | `capa_title`, `due_date`, `priority`                        |
| Cylinder Test Due | `cylinder_id`, `gas_type`, `test_type`, `due_date`          |
| Document Expiring | `document_name`, `expiry_date`, `days_remaining`            |
| Incident Created  | `incident_type`, `location`, `severity`, `reporter`, `date` |
| Permit Approved   | `permit_type`, `location`, `valid_until`, `approver`        |
| Training Due      | `training_name`, `due_date`                                 |

### Security and MFA

[Security](https://demo.turnstile360.com/security) is an account passkey screen:
optional Device Name, Register passkey, and enrolled passkey count/list. Guidance
mentions Touch ID, Face ID, Windows Hello and hardware keys, with multiple devices
supported. It states MFA is required for administrators and asks the current admin
to enroll; the count was zero while other administration pages remained accessible.
That observation does not prove how MFA is enforced elsewhere. Enrollment, recovery,
removal and policy editing were not exercised or established by this screen.

## Tenant Settings

The [Tenant Settings](https://demo.turnstile360.com/tenant-settings) description
explicitly groups naming, hierarchy labels, risk matrix, manpower and safety metrics.
References such as “§3.1” appear in the UI, but their underlying Version 1 specification
was not supplied. They are not current repository requirement identifiers.

| Tab            | Fields and actions                                                                                                                                  | Business purpose and dependency                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hierarchy      | Nine labels: HO, REGION, PLANT, DEPARTMENT, SUB_DEPARTMENT, AREA, LOCATION, MACHINE, EMPLOYEE; Save; Reset to default                               | Organization terminology. Overlaps with the separate five-level editor and the organization node taxonomy. Synchronization is unverified.                                                                 |
| ID Naming      | Ten editable patterns; individual save and reset icons; placeholders `{YYYY}`, `{NNNN}` described as a per-organization counter, and `{plant_code}` | Generate business-readable references. Site codes, counter scope, uniqueness and change rules are dependencies; these are not exposed here. Save/reset icons have no accessible names.                    |
| Risk Matrix    | Size 3×3, 4×4 or 5×5; Acceptable Threshold; comma-separated Consequence Labels; comma-separated Likelihood Labels; Save; Reset to default           | Risk acceptability and axis terminology. Different controls from Admin Settings' risk bands/colors. Selecting 4×4 retained the five existing labels in the unsaved form; server validation is unverified. |
| Manpower       | Category chips with removal affordances; new-category field; Add; Save; Reset to default                                                            | Workforce categorization for operational reporting. Visible categories: permanent, third_party, contractual, temporary, internal, external. These mix employment arrangement and affiliation.             |
| Safety Metrics | LTIF, TRIFR, Fatalities, Near miss count, HiPo count, First aid count; individual checkboxes; Save; Reset to default                                | Choose metrics on the organization safety dashboard. All six were checked. Formula definitions, denominators and reporting periods are not configured on this tab.                                        |

The displayed risk threshold was 6. Consequence labels were Negligible, Minor,
Moderate, Major and Catastrophic; likelihood labels were Rare, Unlikely, Possible,
Likely and Almost Certain. These are demo values, not accepted product defaults.

| ID pattern key       | Default pattern shown as placeholder |
| -------------------- | ------------------------------------ |
| PERMIT               | `PMT-{plant_code}-{YYYY}-{NNNN}`     |
| RISK_ASSESSMENT      | `RA-{plant_code}-{YYYY}-{NNNN}`      |
| INCIDENT             | `INC-{plant_code}-{YYYY}-{NNNN}`     |
| INCIDENT_REPORT      | `INC-{plant_code}-{YYYY}-{NNNN}`     |
| INVESTIGATION_REPORT | `INV-{plant_code}-{YYYY}-{NNNN}`     |
| MOC                  | `MOC-{plant_code}-{YYYY}-{NNNN}`     |
| CAPA                 | `CAPA-{plant_code}-{YYYY}-{NNNN}`    |
| LOTO                 | `LOTO-{plant_code}-{YYYY}-{NNNN}`    |
| TRAINING_CERT        | `CERT-{plant_code}-{YYYY}-{NNNN}`    |
| MOCKDRILL_REPORT     | `DRILL-{plant_code}-{YYYY}-{NNNN}`   |

One current pattern differed from its placeholder, confirming the distinction
between configured data and displayed defaults. No document-approval numbering
pattern was present among these ten controls.

## User Management

[User Management](https://demo.turnstile360.com/user-management) has Users, Roles,
RACI Matrix and Delegation in its local navigation. The list displays user identity,
role, department, contact, status and actions; totals for users, active users,
imports done and imported users; search by name/email/employee ID; role filter;
and page/count navigation. Filter choices are Admin, Manager, Supervisor, Safety
Officer, Auditor, Employee and Viewer, plus All Roles. Filtering correctness was
not established by a successful filtered result.

The list also contains roles outside that selector, including operational power_user,
quality manager, safety manager and superadmin. The User editor contains Full Name,
disabled Email, Role, Department, Job Title, Phone and Location, with Cancel and
Save Changes. Its role selector has the same seven choices as the filter; its
initial displayed role was blank for an existing operational power_user. This is a
visible consistency issue, not proof that saving would change the role.

### User import

Download Template produces `user_import_template.csv`. The downloaded header is:

```text
email,full_name,first_name,last_name,role,department,job_title,phone,employee_id,manager_email,location
```

Bulk Import opens a file/drop area, template download and “Required column: email”
guidance. Import was not run. Duplicate handling, role validation, invitations,
password setup, reporting-manager resolution, location mapping, atomicity, per-row
errors and retry behavior remain unverified. A free-text Department/Location in an
account record is not evidence of a relationship to an organization node.

No ordinary Add User or Invite User action was visible on the inspected Users page.
The prominently available creation action instead creates temporary demo access.

### Demo access

Create Temporary Demo Access collects Company Name and optional Contact Name.
The dialog states activation must happen within 14 days and access lasts seven
days from the first successful login. It warns the account can modify production
business records while administration is blocked. Generate Credentials is the
commit action and was not invoked.

Demo rows show pending/active/expired/revoked states, activation/access deadlines,
and Extend, Revoke and Activity controls where available. Activity opens Time,
Action, Request and Status columns; the inspected record had no activity rows.
Extension/revocation were not invoked. These sales/support lifecycle controls do
not establish a customer provisioning or ordinary user-invitation workflow.

### Roles and permissions

[Role Management](https://demo.turnstile360.com/role-management) lists role name,
description, System badge where applicable, permission count and summaries, View,
Edit and delete-icon controls. The nine system roles are Administrator, Auditor,
Employee, Quality Manager, Safety Manager, Safety Officer, Super Administrator,
Supervisor and Viewer (Read Only). One custom role was also visible. System Edit
and delete controls were disabled; custom Edit was enabled.

Create Role and custom Edit use Role Details and Permissions tabs. Details collect
Role Name, marked required, and Description. Permissions expose grouped action
checkboxes and selected/total counts. View shows the granted actions. The
Administrator View was inspected; the full creation catalog contains 106 actions:

| Permission group        | Available actions                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| Incident Management     | View, create, edit, delete, assign, close/resolve, export, view all bypassing ownership            |
| Audit Management        | View, create, edit, delete, schedule, assign auditors, approve findings, export                    |
| Training Management     | View records, create/edit/delete programs, assign training, approve completion, issue certificates |
| Document Control        | View, create, edit, delete, approve, publish, archive                                              |
| Permit to Work          | View, create, edit, delete, approve, issue, close                                                  |
| Lockout/Tagout          | View/create/edit/delete procedures, apply/remove LOTO, authorize personnel                         |
| Job Safety Analysis     | View, create, edit, delete, approve                                                                |
| Risk Management         | View, create, edit, delete, approve, manage mitigation actions                                     |
| CAPA Management         | View, create, edit, delete, assign, verify effectiveness, close                                    |
| Management of Change    | View, create, edit, delete, approve, implement                                                     |
| Organization Management | View, create, edit, delete units                                                                   |
| User Management         | View, create, edit, delete, assign roles, bulk import                                              |
| Role Management         | View, create, edit, delete                                                                         |
| Reports & Analytics     | View reports, create custom reports, export, view dashboards                                       |
| System Settings         | View, edit, manage notifications, manage integrations                                              |
| ISO Certification       | View standards, manage certifications, conduct ISO audits                                          |
| Safety Equipment        | View, add, edit, delete, record inspections                                                        |
| Behavior Based Safety   | View, create, edit, delete observations                                                            |
| HiPo Management         | View incidents, assess potential, escalate, manage Life Saving Rules                               |

These permissions describe Version 1's wider suite. They do not authorize importing
those modules or roles into the current product.

### RACI matrices

[RACI Matrix](https://demo.turnstile360.com/raci-matrix) describes Accountable,
Responsible, Consulted and Informed. Every matrix has View Matrix and Edit.
All 21 views were opened. Each has fixed columns Plant Head, Dept Head,
Sub-Dept Incharge, Line Incharge and Employee. The Document Control editor
exposes Module Name, Module Description, step name/description, Add Step,
and one assignment selector per column. Choices are None,
R, A, C, I and A/R. Save Changes and Cancel complete the form.

| Module                          | Workflow steps displayed in order                                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Document Control                | Create Draft Document; Submit for Review; Review Document; Approve Document; Request Changes; Publish Final Version; Make Document Obsolete   |
| Risk Management                 | Identify Risk; Initial Risk Rating; Approve Final Risk Rating; Assign Risk Owner; Define Controls; Approve Controls; Create Mitigation Action |
| Incident Management             | Report Incident; Classify Incident; Decide Investigation; Assign Investigator; Conduct RCA; Generate CAPA; Approve Closure                    |
| CAPA Management                 | Create CAPA; Assign CAPA Owner; Implement CAPA; Submit Evidence; Verify CAPA; Approve Closure                                                 |
| Action Management               | Create Action; Assign Action Owner; Complete Action; Verify Action; Escalation (Overdue)                                                      |
| Inspection Management           | Create Template; Execute Inspection; Upload Evidence; Identify Issues; Approve Inspection Report                                              |
| Compliance Management           | Generate ROL/ROR; Validate Applicability; Assign Compliance Owners; Submit Evidence; Approve Compliance Status; Handle Non-Compliance         |
| Training Management             | Create Training; Schedule Training; Attend Training; Verify Competency                                                                        |
| Crisis Management               | Raise Crisis Alert; Evaluate Crisis Severity; Assign Response Team; Execute Response Actions; Approve Crisis Closure                          |
| Supplier Management             | Add Supplier; Evaluate Supplier; Approve Supplier                                                                                             |
| Contract Management             | Create Contract; Approve Contract; Renewal Decisions                                                                                          |
| Asset Management                | Create Asset; Maintain Asset; Approve Disposal                                                                                                |
| Blockchain Audit Trail          | Record Approval on Blockchain; Record State Transition; Verify Document Hash; Query Audit Trail                                               |
| Environmental Management        | Identify Environmental Aspects; Assess Environmental Impact; Track Waste Generation; Manage Waste Disposal; Monitor Energy Consumption        |
| ESG & Sustainability Reporting  | Collect ESG Data; Calculate ESG Score; Generate ESG Report; Approve ESG Disclosure                                                            |
| Safety Management               | Create Job Safety Analysis; Request Permit to Work; Approve Permit to Work; Perform LOTO; Conduct Safety Observation                          |
| ISO Certification Management    | Define ISO Scope; Conduct Gap Analysis; Implement ISO Requirements; Conduct Internal Audit; Prepare for Certification                         |
| Management of Change            | Initiate Change Request; Risk Assessment for Change; Approve Change; Implement Change; Verify Change Effectiveness                            |
| Contractor & Vendor Management  | Register Contractor; Conduct Safety Induction; Monitor Contractor Performance; Evaluate Contractor                                            |
| Emergency & Business Continuity | Develop Emergency Response Plan; Conduct Emergency Drill; Business Impact Analysis; Create BC Plan; Activate Emergency Response               |
| Predictive Analytics & AI       | Configure Predictive Models; Run AI Analysis; Review AI Insights; Action on Predictions                                                       |

For Document Control, draft creation assigns R to Employee; review assigns A/R to
Dept Head; approval, publication and obsolescence assign A to Plant Head and R to
Dept Head. These displayed assignments do not establish executable routing,
separation of duties, quorum, delegation handling or business-state enforcement.
The blockchain description is a Version 1 claim; no blockchain execution or
immutability was verified.

### Delegation

[Delegation](https://demo.turnstile360.com/delegation) displays totals for all,
active, pending, expired and actions taken. My Delegations, Received and Currently
Active tabs explain outgoing, incoming and currently effective authority; all
three were empty for this user despite historical totals.

Create Delegation contains Delegate To user selector, Reason, Start Date, End
Date, Scope Type and optional Notes. Reasons are Annual Leave, Medical Leave,
Business Trip, Training, Personal Leave and Other. Start/end are marked required;
the start date is prefilled. All scope variants were inspected:

- Full Authority (All Permissions): no further selection.
- Specific Modules: Permit to Work, Incident Management, Audits, Training,
  Document Control, CAPA, Management of Change, Risk Management.
- Specific Permissions: Approve Permits, Issue Permits, Close Permits, Close
  Incidents, Approve Audits, Approve Documents, Verify CAPAs, Approve MOCs.

Cancel and Create Delegation are available. Effective permission calculation,
recipient eligibility, acceptance, revocation, overlapping delegations and date
boundary rules were not verified. The recipient list included demo accounts in
several states; backend eligibility is unknown.

## Organization Structure

[Organization Structure](https://demo.turnstile360.com/organization-structure)
displays a tree, unit name, configured level label, unit type and owner contact
details. Counters show Total Nodes, Plants, Departments and Employees. Add Node,
Edit node and Delete node controls are available. The page describes flexible
hierarchy management and materialized paths; storage strategy is not established
by UI wording.

Create Organization Node contains Level, Name, Unit Type, optional Valid From/To
calendar pickers, Owner Name, Owner Email and Owner Phone. Level 1 has no parent
selector; levels 2–5 require a parent from the immediately preceding level in
the UI. The available levels are Plant / Site, Department, Sub-Department,
Station / Location and Employee. The form can auto-derive unit type from level.
Edit Organization Node marks Level immutable and exposes the other details.
No dedicated site-code field or linked user picker for the owner was visible.

The 23 unit types are Organization, Head Office, Region / Geography, Business
Unit / Division, Plant / Site, Project Site (Construction), Warehouse / Logistics,
Laboratory, Temporary / Shutdown Site, Department, Floor, Building,
Sub-Department, Production Line, Contractor Zone, Manufacturing Cell,
Area / Safety Zone, Utility Area, Machine / Equipment, Vehicle / Fleet, Location,
Workstation and Storage Rack. Category annotations group them as core, site, org,
structure, production, external, equipment and location.

Tree records visibly combine different level and type labels. For example, a
Plant / Site level can show type Organization; a Department level can show type
Plant. This is evidence of distinct concepts and potentially confusing rendering,
not proof of corrupt data. The “Employee” level is especially inconsistent with
the separately available people-to-unit mapping.

### Employee mapping

[Employee Mapping](https://demo.turnstile360.com/employee-unit-mapping) supports
one person linked to multiple units, with role and effective dates. Its list has
Employee, Org Unit, Role, Effective and Actions columns; filters for employee ID,
unit name/path and role; New Mapping; edit/delete icons. Some rows display email
addresses and others opaque identifiers, limiting administrator readability.

Create and Edit Mapping contain Employee ID / User ID as pasted text, Org Unit,
Role, Valid From and Valid To. The unit picker supports search by name, type or
path and displays ancestry. Role choices are Primary, Secondary, Supervisor,
Member, Visitor and Contractor. Create/Update, Cancel and Close are available.
Mapping uniqueness, overlapping effective ranges, person existence and resulting
access rights are unverified; membership must not be assumed to grant permission.

### Roll-up analytics

[Org-Unit Analytics](https://demo.turnstile360.com/org-rollup-analytics) uses a
searchable unit picker with name/type/path. Selecting an existing root produced
its type, path, subtree size and metrics: total/open incidents, total/high risks,
total/overdue audits, total/open CAPA and total/overdue actions. It has initial
selection and loading states. No date-range or formula configuration was visible.
The need is reporting across descendants, dependent on a coherent unit tree and
correct business-record assignment; calculation correctness was not independently tested.

## Cross-screen findings

| Finding                                 | Observed evidence                                                                                                  | Design implication                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Fragmented hierarchy                    | Five admin labels, nine tenant labels, five node levels, 23 unit types and separate people mapping                 | One organization configuration; distinguish names, types, parent relationships and memberships                     |
| Fragmented risk policy                  | Admin risk bands/colors and tenant size/threshold/axis labels expose different models                              | One versioned risk policy when Risk Management is implemented                                                      |
| Overlapping people information          | User department/location strings, unit owner contacts, an Employee tree level and employee mapping                 | Reference people and units by identity; keep contact data and memberships separate                                 |
| Inconsistent role vocabulary            | Existing list roles exceed editor/filter choices; RACI uses management positions; membership has another role list | Separate authorization roles, organizational positions and workflow responsibilities                               |
| Operational and personal settings mixed | Notifications combines server provider status, My Preferences and templates; Security is per-account               | Separate account settings, product administration and private operations                                           |
| Missing dependencies in forms           | ID patterns need plant codes; no code field in node form; RACI columns fixed to five positions                     | Configure dependencies where the feature uses them; validate resolvable references                                 |
| Large assumed scope                     | 21 RACI modules, 106 permissions, enterprise white label, demo sales access                                        | Preserve business questions; do not import unapproved modules or commercial rules                                  |
| Essential setup journey unobservable    | No setup checklist, review/activation, persisted progress or waiting-user screen in inspected administration UI    | Introduce a short explicit product onboarding flow; fresh-install behavior still requires implementation and tests |

The proposed classification, dependency rules, replacements and roadmap are in the
[design proposal](onboarding_design_proposal.md). Neither document treats a visible
Version 1 control as a current product commitment.
