# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

The **CS Workflow Tool** (formerly CS Pipeline Tool v2) — an internal workflow-mapping app for Langara
College's Continuing Studies department. It documents how curriculum
documents (Concept Paper, Course Proposal, Program Proposal, Program
Summary, Discontinuation Form) travel through the college's approval
pipeline: who reviews them, who signs, who carries them to which meeting,
and where the files live at each stage.

It is a **reference/design tool, not a tracker**. It maps the shape of the
process itself; it does not track individual in-flight programs.

## Repository shape

The Workflow Map is one file (the Program Tracker, `tracker.html`, is a
second, separate page — see its section below):

- `workflow-tool.html` — ~3,800 lines. HTML + Tailwind (CDN) + React 18
  (UMD) + in-browser Babel + Firebase compat SDKs. No build step, no
  `package.json`, no tests, no CI.

Open the file in a browser to run it. Edits are live on reload.

## Data model

Everything lives in one JSON `store`, synced to Firebase Realtime Database
at path `pipeline` (single shared document — all users edit the same tree).

```
store
├── roles[]            { id, label }                  — PC, CS Admin, Dean, Director
├── projectTypes[]     { id, name, documents[], createdAt, updatedAt }
│   └── documents[]    { id, name, color, orderLabel, steps[] }
│       └── steps[]    { id, stageName, actions[], presenterIds[], carrierIds[],
│                        notes, storageLocation, fileOperation, deliveryMethod,
│                        informationOnly, triggerType, triggerLabel,
│                        syncGroupId, returnToStepId }
│           └── actions[] { id, type, label, person }  — review | approval |
│                                                        consultation |
│                                                        prepared_by | custom
├── templates[]        saved snapshots of a projectType
├── syncGroupMeta      { [groupId]: { name, color } }
└── activeProjectTypeId
```

Key concepts:

- **Project type** — a workflow scenario (New Program, New Courses, Course
  Changes, Discontinuation, Micro-Credential). One is active at a time.
- **Document** — a column in the canvas. Has a colour used throughout the UI.
- **Step** — a stage a document passes through (e.g. "JCCS", "VPE – ELT",
  "CRC – EDCO Approved"). Ordered within its document; order *is* the
  sequence. `presenterIds` = who brings it; `carrierIds` = who moves/files it.
- **Sync group** (`syncGroupId` + `syncGroupMeta`) — the existing mechanism
  for marking that steps in *different* documents are the same real-world
  event (e.g. one JCCS meeting handling three documents at once). Grouped
  steps render with a shared coloured border. **This is the closest thing
  the data model has to a step-centric spine** and is the natural anchor for
  a step-oriented view.
- **Return step** (`returnToStepId`) — models a loop back to an earlier step.
- **Trigger** (`triggerType`) — what causes the step to start: immediate,
  scheduled meeting, manual request, task assigned, or custom.
- **Workflow notes** (`projectType.notes`) — free text about the whole
  workflow. Shared content, so it lives in the store, appears on the published
  page, and counts toward the publication hash (editing it marks a page stale).
- **Storage link** (`step.storageUrl`) — optional URL for the filed location,
  which makes the folder chip clickable on the card and the published page.

## Vocabulary

The UI says **workflow**; the data model says `projectTypes`. That mismatch is
deliberate. Every record in Firebase is keyed on `projectTypes` /
`activeProjectTypeId`, and the localStorage preference keys embed the same
names, so renaming the fields would orphan existing data for no user-visible
gain. **Change display copy freely; do not rename the keys.**

## Icon language

One glyph per meaning, defined once in `ICON_PATHS` (Lucide 1.39 geometry, ISC)
and rendered by the `Icon` component at 24×24 with `currentColor`, so an icon
takes whatever colour its context sets. `iconSvg()` returns the same glyph as a
string for renderers that cannot use JSX.

| Meaning | Lucide name | Meaning | Lucide name |
|---|---|---|---|
| Review | `search` | Trigger: immediate | `corner-down-right` |
| Approval | `thumbs-up` | Trigger: meeting | `calendar-clock` |
| Consultation | `message-circle-question-mark` | Trigger: manual | `hand` |
| Prepared by | `file-pen` | Trigger: task | `clipboard-check` |
| Custom action | `circle-chevron-right` | Trigger: custom | `bell` |
| Storage / filed | `folder-symlink` | Sync group | `link` |
| Return path | `rotate-ccw` | Notes | `notebook-pen` |
| Information only | `info` | | |

A second block in `ICON_PATHS` covers the chrome — `check`, `x`, chevrons,
`pencil`, `copy`, `grip-vertical`, `settings`, `workflow`, `users`,
`archive-restore`, `history`, `log-out`, `globe`, `refresh-cw`, `copy-plus`,
`layout-list`, `route`, `list-chevrons-down-up`, `rows-3`, and the empty-state
glyphs. **There
are no emoji or typographic symbols left anywhere in the app**, and a check
asserts it against `innerText`.

**Use these everywhere** — Documents, Step Flow, the published page, and
anything added later. Emoji were replaced because they rendered at
inconsistent optical sizes and baselines and carried their own colours, which
fought the palette. Do not reintroduce them; `checks.js` asserts they are gone
from card content.

## Chrome

The top bar carries only what is about *this workflow*: a `WORKFLOW` eyebrow,
the name, and a sync line whose refresh button is the status (green synced,
amber saving, red offline — the old pill is gone). Then presence avatars and
Publish, rightmost. The brand block sits **above the sidebar** and is a button,
because it will link to a dashboard later; it deliberately does nothing today.

Both views render the same toolbar row: `ViewToggle`, Details, Row Lock /
Steps shown, Notes, then Save as Template pinned right. The view toggle lives
here rather than the top bar so it sits beside the other view controls.

Manage workflows, Roles & people, Backup & restore, Sign out and Reset to
defaults are all behind one **Settings** button at the foot of the sidebar.

`notesOpenFor` lives in `App`, keyed by workflow id, so the notes panel stays
open across a view switch. The notes themselves are store content; only the
open state is local.

## Column sizing

`.doc-col` was once `min-width` **and** `max-width: 260px`, so five columns
could not fit a 1440px display. Columns are now a CSS grid (`.doc-grid`) that
shares the canvas evenly between `DOC_MIN_WIDTH` (250px) and `DOC_MAX_WIDTH`
(500px) — below the floor they stop shrinking and the canvas scrolls; the
ceiling stops a one-document workflow stretching across the whole display.
Those are constants, not preferences: the flexing is what adapts to the
display, so a Compact/Standard/Wide picker was tried and removed as redundant.
The Add Document column sits **outside** the grid so it does not take an equal
share.

Two things that bite here:

- **`max-width` on a grid track loses to `1fr`.** The wrapper needs the cap too
  (`--doc-cap`, from `docGridCap()`), or columns sail past the ceiling.
- **`1fr` resolves against max-content in a shrink-to-fit box.** Row Lock's band
  is `min-width: max-content`, so its column width is *measured* with a
  `ResizeObserver` rather than left to the grid — every column sat on its
  ceiling otherwise. Any flex ancestor of a max-content canvas also needs
  `min-w-0`, or the whole app grows sideways instead of scrolling.

## Between two steps

The arrow sits in its own left column with the file-operation and trigger lines
stacked beside it, and the group is centred (`.step-link`). The band itself is
the hover target for setting a trigger — the old `⚡+` button cost a row under
every arrow. The add control is **absolutely positioned**: as a grid cell it
squeezed the trigger text into extra lines and cancelled the ~190px the layout
was saving.

## Information only

A dashed card outline — the same convention Step Flow already used — plus a
label sharing the stage name's line, which drops below it when the title is too
long. The label wraps rather than truncating; there is no separator character,
so it reads correctly on either line.

Because the canvas can scroll, it says so: an edge fade and a nudge button on
whichever side has more content, plus a scrollbar wide enough to see.

Everything is keyed by random `uid()` strings. Copying a step or document
always regenerates ids (and clears `returnToStepId`) — see `copyStepToDoc`,
`copyStepToProject`, `copyDocToProject`.

## Component map (top to bottom in the file)

| Lines | Component | Role |
|---|---|---|
| 40–110 | utilities, Firebase config, `normalizeStep`/`normalizeStore` | defaults-filling on every store write |
| 111–284 | seed data | `makeSeedProjectTypes()`, `getDefaultStore()` |
| 285–334 | `LoginScreen` | Firebase email/password auth |
| 336–364 | `useStore` | load → edit → debounced (2s) save |
| 366–412 | `Modal`, `Btn`, `Field` | primitives; `Modal` renders through `ReactDOM.createPortal` |
| 413–672 | `StepForm` | the big step editor modal |
| 673–763 | `CopyToModal`, `CopyDocModal` | cross-document / cross-project copying |
| 765–915 | `StepCard` | one step; drag source & drop target |
| 917–1188 | `DocumentColumn` | one document column; `renderMode` is `'header'` or `'body'` |
| 1190–1413 | `ProjectTypeCanvas` | **Documents view** — horizontal document columns |
| 1415–1600 | editor modals | project types, roles, backup/restore, templates |
| 1602–1750 | `buildStepSpine`, `docTrack`, flow prefs | step-matching + ordering logic for the Step Flow view |
| 1751–1770 | `FlowStepNode` | one cell of the Step Flow matrix |
| 1771–1930 | `StepFlowView` | **Step Flow view** — documents as rows, steps as columns |
| 1932–2060 | `generatePrintHTML` | print/PDF for the Documents view |
| 2062–2222 | `generateFlowPrintHTML` | print/PDF for the Step Flow view |
| 2224–2248 | `usePresence` | live avatars of other signed-in editors |
| 2250–2570 | `App` | sidebar, top bar, view toggle, modal routing |
| 2571–2590 | `Root` | auth gate |

(Line numbers drift with edits — grep for the `// ── Name ──` banner comments.)

## The two views

The top bar toggles between them; `view` state lives in `App`.

- **Documents** (`ProjectTypeCanvas`) — the original, full-detail view. One
  column per document, steps stacked vertically. All editing happens here.
- **Step Flow** (`StepFlowView`) — read-only "at a glance" view. One **row per
  document**, one **column per step**, so you can see each document's whole
  journey as a horizontal track: solid coloured line through steps it goes
  through, dashed grey line through steps it **bypasses**, `▸ START` on its
  first step and `✓ END` on its last.

### How Step Flow matches steps across documents

**By name, deliberately** — not by sync group. Two steps called "JCCS" are the
same stage of the process even if the documents reach it at different
meetings; sync groups mean "the *same* meeting", which is a different question
and is ignored here. `stepKey()` normalizes case, whitespace, and dash
variants, so "VPE – ELT" and "VPE - ELT" collapse into one column.

Column order comes from `buildStepSpine()`: each document's own step sequence
contributes ordering constraints, and a topological sort merges them into one
canonical pipeline. Documents that disagree, or a genuine return loop, fall
back to earliest-position-wins — the sort is cycle-safe and always terminates.

### Row Lock (Documents view)

A toolbar toggle that swaps the Documents canvas from independent flex columns
to **one CSS grid**, so a row band's height is set by its tallest card and
every document lines up on it (`RowLockedCanvas`). Display-only — it writes
nothing to the store.

Bands come from `buildRowBands()`, which keys each step by **sync group if it
has one, otherwise by normalized step name**, then merges the documents'
sequences with the same `topoMerge()` the Step Flow spine uses. The name
fallback is essential, not a nicety: on real data most identical stages are
*not* sync-grouped, and keying on sync groups alone renders a staircase of
one-card rows instead of a table.

`RowLockedCanvas` must be passed the **real** `onUpdateSyncGroupMeta` and
`onDissolveGroup` handlers. It was first wired with no-ops, which made
renaming a sync group from a step opened in Row Lock silently discard itself —
the panel updated from local state and the write went nowhere.

A **narrow left gutter** carries each sync group's name, rotated vertically
(`writing-mode: vertical-rl`) so the column stays 26px wide, tinted with the
group colour and spanning the band. A sync group always collapses to exactly
one band, so the label never needs to span rows.

Every empty cell renders a dashed placeholder box. A document that skips a
band gets a **↓ marker inside that box**, but only between its own first and
last occupied band — before it starts or after it ends the box stays empty,
so "not involved" reads differently from "passes through". Same distinction
the Step Flow view draws horizontally.

Cards in a band are **equal height**: the grid cell stretches, and `StepCard`'s
`fillHeight` prop makes the card and its padding wrapper grow to fill it.
Shorter cards gain whitespace rather than the row looking ragged.

Reordering is disabled while Row Lock is on — bands, not columns, decide
vertical position, so drag would be meaningless. `StepCard` takes a `readOnly`
prop for this: it hides the move/delete/copy/link controls and unsets
`draggable`, but editing a step still works.

### Display preferences (both views)

Each view has a `⚙ Details` toolbar popover that toggles which fields render.
Both are **display-only preferences in `localStorage`**, keyed by project type
id, deliberately *not* in the Firebase store — toggling what you look at never
writes to the shared document or triggers a sync.

| View | Key | Fields | Default |
|---|---|---|---|
| Documents | `cs_pipeline_doc_prefs_v1` | actions, presenters, carriers, storage, trigger, returns, notes (plus the `rowLock` flag) | all **on**, Row Lock off |
| Step Flow | `cs_pipeline_flow_prefs_v1` | same, plus per-step column visibility | all **off** |

The defaults differ on purpose: Documents is the full-detail view, Step Flow
is the at-a-glance one. `storage` also gates the "Document Copied/Moved"
label on the arrows between steps in the Documents view.

If these should ever become shared team settings, they move into `store` and
need a `normalizeStore` default.

### Step Flow view preferences

Per-step visibility and per-detail toggles are **view preferences, stored in
`localStorage`** under `cs_pipeline_flow_prefs_v1`, keyed by project type id —
deliberately *not* in the Firebase store, so toggling what you look at never
writes to the shared document or triggers a sync. All detail toggles default
to **off**; the bare view shows only presence/absence, which is the point.

If these should ever become shared team settings, they move into `store` and
need a `normalizeStore` default.

## Collapsible sidebar (both apps)

Shared code, copied between `workflow-tool.html` and `tracker.html` — keep
them identical: `useNarrow` / `useSidebar`, `RailItem`, `railInitials`, and the
`.rail-*` CSS. Wide windows (`NARROW_BELOW`, 1280px) remember open/closed per
viewer in `localStorage` (`cs_pipeline_sidebar_open_v1`,
`cs_tracker_sidebar_open_v1`). Narrow windows always start as the **rail**
(`RAIL_W`, 64px); opening it slides the full sidebar over the page with a
backdrop that closes it. The rail shows icons and two-letter initials circles
(first letters of the first two words); the Workflow Tool's rail keeps the drag
grip, and the tracker's circle outline is the project's state
(`projectRing()`). Hovering a rail icon floats the full button over it with
the label sliding out — **drawn fixed-position through a portal**, because the
rail scrolls and a scrolling box clips anything that overflows sideways.

## Change history

Every save appends what changed to `pipelineLog/<workflowId>/<push>`
`{ at, by, name, changes: [{ major, text, doc, color }] }`
(`logWorkflowChanges` / `describeWorkflowChanges`, in `useStore`). The diff is
taken against a **baseline** — the last version this tab loaded or saved — and
the baseline is reset on every load and refresh, so a colleague's edits pulled
in by a refresh are never logged as yours. Empty string, null, false and `[]`
all count as "not set", and action ids are ignored, so normalising data never
logs as a change (an early version logged "changed storage link" on every step
because `''` and a missing field compared unequal). `major` marks substantial
changes (steps, documents, tasks, presenters/carriers, meeting group);
notes, storage and trigger wording are minor. A **History** button in the top
bar, left of Publish, opens `WorkflowHistory`, a drawer of the log. Only the
Workflow Map shows it. Covered by the `auth != null` rules.

## Publishing (read-only pages)

`?p=<slug>` renders `PublishedView` instead of the app — **no auth gate**, so
the branch lives at the `ReactDOM.render` call, not inside `Root` (an early
return before `Root`'s hooks would be the same Rules of Hooks bug as `d9297ef`).

A publication is a **snapshot**, not a live mirror: pressing Publish copies
`{ projectType, roles, syncGroupMeta }` to `published/<slug>` and never updates
itself. Republishing writes the same slug, so links already sent keep working.

### Staleness detection

`contentHash()` hashes the snapshot with `stableStringify` (keys sorted —
Firebase key order is not stable, and unsorted keys would produce a different
hash on every load). The hash at publish time is kept in
`store.publications[projectTypeId]`; `publicationStatus()` compares it against
a hash of the live project type and returns `none | current | stale`, which
drives the chip in the top bar.

Because the hash covers only store content, **display preferences never mark a
page stale** — toggling Row Lock or hiding details leaves the chip green. That
is deliberate and is covered by a test.

### Required database rules

Public reads of the snapshot subtree only; everything else still needs auth:

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null",
    "published": { ".read": true }
  }
}
```

Without the `published` rule the app publishes fine but the link shows
"could not be loaded".

### The page

**One continuous document**, not a deck: title, the step matrix **once**, then
a section per document with its cards. Sizing is in `cqw` against
`.pub-page`, so the same markup scales on screen and at print width.

Printing (11 × 8.5 in landscape) packs as many document sections onto a page
as fit. `break-inside: avoid` on `.pub-doc` keeps a section whole, and on
`.pub-row` keeps a row of cards whole; `break-after: avoid` on the heading
stops it being orphaned. On the sample data that is 5 documents over 3 pages
with no section split.

There is no print/export in the app itself any more — printing happens from
the published page.

The print block must force `html, body { background:#fff !important;
min-height:0 !important }`. The app's `<body>` carries Tailwind's
`bg-slate-100 min-h-screen`, which outranks a bare `body { background: white }`
rule and stretches the page past its content — that printed as a solid grey
block filling the unused part of the last page.

Card flow layout is chosen at publish time and stored on the publication:

- `serpentine` — rows alternate direction, so a wrap is a short hop to the card
  directly below, and a **down arrow is literal**.
- `ltr` — every row reads left to right. Here the next card after a row end is
  at the far left of the next row, so a down arrow would point at the wrong
  card; those ends get `↴` / `↳` wrap markers instead.

**Marks that carry meaning are drawn with borders, not backgrounds.** Chrome
does not print background colours unless the viewer ticks "Background
graphics", so the matrix step dots, the colour swatches and the connector
rules are all `border`-based (a filled circle is `width:height:1.2cqw` with a
`.6cqw` border and `box-sizing:border-box`). The step-number badge is outlined
rather than filled for the same reason — white-on-colour would print as
white-on-white. `print-color-adjust: exact` is set on the page as a
belt-and-braces, but nothing load-bearing depends on it.

The published page also sets `document.title` to the project name, since that
becomes the tab label, the bookmark, and the PDF's default filename.

Connectors take the document's colour: `PubFlow` sets `--flow` inline and the
connector CSS reads `var(--flow)`, softened with `opacity: .62`.

**Connectors are a rule plus a head**, built from flex/absolute elements
(`.pub-conn`, `.pub-down`, `.pub-sweep`) — never a bare arrowhead. A version
that drew only the triangle read far weaker than the design, because an
arrowhead alone in a wide gap does not say "movement". The serpentine turn
mirrors the row's slot layout so it lands in the right column; the
left-to-right sweep is drawn as stub-out / run-across / stub-in-with-head.

Avoid SVG `marker` elements for this: a marker is sized in stroke-width units
and will happily draw longer than the segment it terminates, overhanging
backwards past the start of the line and reading as an arrow pointing the
wrong way at narrow widths.

## The Program Tracker (`tracker.html`)

A second page, for **running** workflows rather than mapping them. The Workflow
Map (`workflow-tool.html`) stays the reference/design tool; the tracker
creates *projects* from its workflows and tracks each one's progress. Same
stack, same sign-in, same Firebase project, same icon set (`ICON_PATHS` is
copied into the tracker — keep the two in sync when adding glyphs).

**Status: live.** `/Langara/tracker.html`. The Workflow Map's sidebar links to
it (Program Tracker, above Settings) and the tracker's sidebar links back.

### Data (`tracker/` in Firebase — never writes to `pipeline`)

```
tracker
├── people/<id>        { name, email, roleIds[] }        — added by hand
└── projects/<id>      { name, workflowId, workflowName, sourceHash,
                         documents[] (snapshot), syncGroupMeta,
                         startDate, dueDate, notes, archived,
                         roleAssignments { roleId: [personId] | 'none' },
                         createdAt, createdBy, updatedAt }
    ├── progress/<docId>/<stepId>
    │     { status, round, startDate, dueDate, meetingDate,
    │       assignees[], notes, heldReason, history/<push>,
    │       checks/r<round>/t<actionIndex> { at, by, status } }
    ├── links/<docId>  { url, label, version, at, by, history/<push> }
    │   (batch projects instead of documents[] store: batch: true,
    │    template[] (one workflow copy), items[] { id, name }, sharedDocIds[])
    └── activity/<push>  { at, by, text, kind, docId, step, status }
```

- **Writes go to the narrowest path** (`update` on one cell, `push` for history
  and activity) and the page renders from live `on('value')` listeners. This is
  deliberate: the map's whole-document, last-write-wins save is not safe for
  several people updating statuses at once. Do not switch the tracker to that
  pattern.
- **A project is a snapshot.** `snapshotDocs()` copies the workflow's documents
  and steps **keeping their ids**, so "Update to latest workflow" can carry
  progress over by `docId/stepId`. `sourceHash` detects drift. Progress on
  steps that disappear is kept in the database but no longer shown, and the
  confirm dialog lists them.
- **Firebase drops empty arrays.** `normalizeProject()` / `cellOf()` fill
  defaults on read, and an empty role override is stored as `'none'` so
  "nobody" stays distinct from "use the default".
- **People** match a sign-in by email (`meOf`). A step's people are the holders
  of its roles — the map's `presenterIds` + `carrierIds` **plus every role its
  tasks name** (`taskRoleIds`: "Approval by Dean" → Dean, a whole-word match of
  role labels against the task's label and person text, via `stepRoleIds`) —
  plus anyone added by hand. The map stores who does a task only as free text,
  so without this match a Dean named only in tasks was never tagged.
  `ROLE_LIST` is a module-level copy of the map's roles, set by
  `useTrackerData`, so these helpers need no extra arguments. Role holders come from the project's override, else from each
  person's default `roleIds`.

### Views

The tracker uses the **Workflow Tool's chrome**: brand block above a white
sidebar (Dashboard, the active projects with their %, then Workflow Tool /
Settings — People and Sign out sit inside it, as in the Workflow Tool — at the foot), a top bar of the same fixed `CHROME_BAR_H`
(68px, so the brand's and top bar's bottom borders meet in one line — the
Workflow Tool had a 0.7px step there until it got the same constant), and a
toolbar row of `tb-btn` buttons with the same `ViewToggle` pill.

**Brand colour.** The tracker's highlight is Langara orange `#F15A22`. Rather
than replace every class, a `<script id="tw-brand">` block remaps Tailwind's
`indigo` scale to an orange scale (500 = `#F15A22`, 600 = `#DD4513` for
buttons, where white text needs the extra contrast), so `indigo-*` classes in
`tracker.html` mean brand orange. `dev/tracker-preview.js` reads that block to
compile the offline preview with the same theme. Violet stays the "sent back"
status colour. The Workflow Tool carries the identical `tw-brand` block (read by
`dev/preview.js`); keep the two in sync.

- **Dashboard** — compact one-line tiles (click one to filter to it; click it
  again to return to the default filter), then the
  project list with search and three checkable dropdowns (`MultiSelect`):
  **Status** (project flags from `projectFlags()`; complete and archived hidden
  by default), **People** (you first; Only me / Everyone), **Type** (workflow).
  The old "held up or sent back" and "stale" panels are folded into the Status
  filter. Right column: Needs your attention, a **project status donut**
  (`StatusDonut`, each project counted once by `donutCategory()`, range all /
  12 / 6 months, legend with counts), meetings in the next 14 days, recent
  updates. **Needs your attention** folds a batch into one line ("N steps
  need you"); single projects stay one line per step. **Meetings**
  (`meetingEvents` / `MeetingList`) shows meeting dates only — no due dates —
  one line per event (date + step name) with its project count, expanding to
  the projects. **Recent updates** lists projects updated in the last 14
  days, one line each (when, by whom, how many); clicking expands its latest
  updates with an Open project link.
- **Narrow dashboard** (below 1280px) — Needs your attention first, as a
  compact panel (`Panel compact`: tight header, no explanation, one line per
  item); then one grid of slim one-line cards (32px: icon, number, short
  label) — the stat tiles (toggle filters) and Status / Upcoming / Updates,
  which drop their report panel open below the cards (click again or away to
  close) — sitting right above the projects list they filter. The projects toolbar
  puts search and New project on line 1, the filters on line 2.
- **Project rows** — title, "workflow · Due · Updated", the people on it as
  separate initials; a wide outlined bar with the % at the end of the fill and
  document chips in an equal grid, each filled to its own progress.
- **Recent updates** are grouped by project and thinned (`recentByProject`):
  only the newest checklist tick per project, and entries with the same kind,
  step and status within 10 minutes collapse into one line. Activity entries
  carry `kind`, `docId`, `step`, `status`; `activityKind()` infers them for
  older entries from text.
- **Project** — top bar: eyebrow, name, sync line with dates, the project's
  people, and an amber **Workflow changed** pill. Toolbar: view toggle,
  **Changes** (a right-hand drawer: project activity, and a readable diff of the
  workflow from `workflowDiff()` with the Update button), Project settings.
  A one-line `SummaryBand` holds %, held up, sent back, upcoming dates and the
  timeline.
- **Overview** — documents share one block under a Previous / Now / Up next
  header. Each `StepTrack` holds every step: `SIDE_W` (180px) side cards, a
  current `NowCard` up to `NOW_MAX` (860px; width measured once in `Overview`
  and shared, so every row and the header line up), and upcoming cards after
  it. Rows always **open aligned** (a Start / End placeholder fills a missing
  neighbour), drag or step with the edge buttons, no visible scrollbar, and the
  Now card **snaps** back when dropped near its place (`scroll-snap` proximity,
  turned off mid-drag). `NowCard` has a header line then three sections:
  status & dates (incl. days on step), tasks **tickable on the card**
  (`toggleTask`, shared with the step panel), people with their role plus the
  latest two updates and notes. **Finished documents collapse** to one
  "Complete" line in the document's colour; Show steps expands them.
- **Document file links** — `links/<docId>` { url, label, version, at, by,
  history/<push> }. Saving a new link keeps the previous one in `history`.
- **Full flow** — the Step-Flow-style grid (`FlowGrid`). The chosen view is a
  per-viewer preference in `localStorage` (`cs_tracker_project_view_v1`).
- **Step panel** — status (when held up, an editable multi-line "Held up
  because" box, `HeldReason`), checklist, the map's trigger, storage and notes
  (snapshotted), dates, people (`StepPeople`: Automatic rows labelled with
  their role, Manually tagged rows with ×, and a Tag someone menu), shared notes, send back, history.
- **Tasks** (`TaskRow`, on the step panel and the Now card) each have a status:
  the checkbox toggles complete; ▾ beside it offers not started / in progress
  / held up / skipped / complete, and a set status shows its marker in place
  of the checkbox. Stored at `checks/r<round>/t<index>` `{ at, by, status }`
  (no status = an old tick = complete). Each task shows the initials of whoever
  holds the role it names. The step follows its tasks only two ways
  (`setTask`): a held-up task holds the step up ("Task held up: …"), and when
  every task is complete or skipped the step asks to be marked complete.
  Marking a step complete (`setStepStatus`) completes every task not already
  complete or skipped — skipped tasks are left alone.
- **Batches** — one project tracking several items (e.g. new courses) through
  the same workflow. Stored as `batch`, `template`, `items`, `sharedDocIds`;
  `normalizeProject` expands them (`expandBatch`) into ordinary `documents`
  with ids `<docId>__<itemId>`, so stats, the dashboard, Full flow and the step
  panel all work unchanged and progress lives at progress/<docId>__<itemId>.
  Expanded docs carry `itemId`, `itemName`, `srcDocId`, `baseName`, and their
  `name` is "Item · Document" so lists and activity read correctly. Created
  from New project → Batch of several items (items one per line; each document
  Per item or Shared; a warning above 3 per-item documents). The Overview shows
  shared documents, then each item as a collapsible group (finished items
  collapse). The step panel offers "Apply to every item in this batch". The
  dashboard row shows "· N items" and one chip per item. Project settings →
  Items in this batch: rename, add, remove (hides it; progress stays), and
  **Split off** (a new one-item batch with that item's and the shared
  documents' progress). Workflow updates diff and replace `template`.
  **Shared documents are provisional** — they may be removed after testing. To
  retire them without losing data: copy progress/<docId> into each
  progress/<docId>__<itemId>, then drop the id from `sharedDocIds`.
- **Initiatives.** The UI calls a batch's items **initiatives**; the data
  keeps `items` / `itemId` (same rule as workflow vs `projectTypes`).
- **Apply to all initiatives** is a checkbox beside the step panel's Status
  label. Ticking it (`tickAll`) copies the current status, held reason and
  meeting date to the other initiatives at once, so choosing the status first
  still works; the meeting checkbox behaves the same. The Tasks list has its
  own separate Apply to all initiatives checkbox: ticking copies the task
  statuses across, and while on every task change (`setTaskAll`) goes to each
  initiative's copy. The "mark the step complete?" question is asked once and
  the answer applies to every initiative (`setTask`'s `autoComplete`).
- **Deleting a project** asks in a `ConfirmModal`, not a typed prompt. Delete
  and Archive sit together on the left of the settings footer. Both show a
  5-second **Undo** toast (`UndoToast`, `showUndo`): `deleteProjects` reads
  the raw project before removing it and Undo writes it back; `setArchived`
  flips archived back.
- **Bulk actions** (`BulkBar`, dashboard list): a checkbox per row and
  "Select all shown" (only the filtered list). Step status (each document's
  current step; held up / skipped ask a reason), Dates (blank keeps each
  project's own), Batch, Archive, Restore, Delete (one confirm listing the
  names). **Batch** (`mergeToBatch`) makes a new batch or adds to one: only
  non-batch projects on one workflow (a batch holds one workflow copy), every
  document per initiative, progress and links moved to `<docId>__<itemId>`,
  originals archived with a note "Added to the batch …".
- **Duplicate a project** — New project → Duplicate a project: an exact copy
  (workflow copy, people, notes, dates, all progress and step history) except
  file links; its activity log starts with "Duplicated from …".

**"Workflow changed"** compares the project's copy with the map's current
version through `driftSummary()` / `workflowDiff()`, which ignore empty-vs-unset
differences and the **order of a step's roles** (toggling a role off and on
reorders the list — the likeliest source of false alarms, since the stored
hash is order-sensitive). The pill shows only for **substantial** changes
(steps, documents, tasks, roles, meeting group, information only); notes,
storage and trigger wording are summed into one "minor detail changes" line in the drawer (they ran to 30+ lines on real data). The drawer's
Workflow update tab lists only what this project's copy is missing, with the
Update button. The workflow's full edit history lives on the Workflow Map
(History, beside Publish) — by request the tracker shows project-level
changes only. `project.syncedAt` (set on create and update) records when the
copy was taken.

"Sent back" counts only a later-round step that is being reworked (not
pending); the steps a send-back reset to pending still show their round badge.

### Behaviour

- Statuses: pending, in progress, **held up** (needs a reason), complete,
  skipped (needs confirmation and a reason).
- **Send back** reopens an earlier step in a new `round`; every step after it
  that had been started resets to pending in a new round. `history` is
  append-only, so earlier rounds stay on record.
- **Meeting shortcut:** steps sharing a `syncGroupId` can take a status and
  meeting date for every document at once.
- **Current step** of a document is the first in progress / held up step, else
  the first not closed.
- **Needs your attention:** steps you are on that are active, or pending and
  next for their document, sorted by due date.
- Routing is the hash (`#/p/<id>`), so projects can be linked directly.

Checks: `cd dev && npm run tracker` (99 checks, own Firebase stub with nested
paths and live listeners — see `dev/tracker-preview.js`).

## Conventions to follow

- **Match the existing style.** Tailwind utility classes inline; occasional
  inline `style={{}}` for dynamic colours. No CSS modules, no styled
  components.
- **React global UMD build** — `const { useState, ... } = React;` at the top.
  Some components use `React.useState` directly; both are fine.
- **No optional chaining on computed members** (`?.[expr]`) inside
  `generatePrintHTML` — the pinned Babel standalone build has historically
  choked on it and produced a blank page. Keep it out of that function.
- **Babel is pinned** to `@babel/standalone@7.23.10`. Do not bump casually;
  a previous unpinned upgrade broke the app.
- **No hooks inside conditional IIFEs.** `StepForm` renders its sync-group
  panel as `{form.syncGroupId && (() => { ... })()}`; two `useState` calls
  once lived in there, so the hook count changed with whether the step was
  grouped. Declare hooks at the top of the component. (Commit `d9297ef` fixed
  the same class of bug in `ProjectTypeCanvas` — it blanks the page.)
- **No hooks below an early return either.** `ProjectTypeCanvas` returns early
  when a workflow has no documents, and `App` returns early on `if (!store)`.
  A hook added after those points runs on some renders and not others — React
  error #310, a blank page. Both bit during the visual clarity pass. Every
  `useState`, `useRef`, `useCallback` and `useEffect` goes above the first
  `return`.
- **`normalizeStore` runs on every update**, not just on load. Any new step
  or store field needs a default added there, or existing Firebase data will
  come back with it `undefined`.
- Every edit path goes through `updateStore` / `onUpdateProjectType` and
  stamps `updatedAt`.
- Modals must render via the `Modal` primitive (portal) to sit above the
  sticky headers.
- Print output has its own renderer per view (`generatePrintHTML` for
  Documents, `generateFlowPrintHTML` for Step Flow) — the React components are
  **not** reused for print. **New views need a matching renderer** if they
  should be printable. The Print button in `App` dispatches on `view`.
- The `?.[expr]` Babel caveat applies to **both** print generators.

## Testing

There is no unit-test suite, but `dev/` holds a local harness — read
`dev/README.md`. It builds an offline, self-contained copy of the app (local
libraries, stubbed Firebase, Tailwind compiled from the app's own markup) and
drives it in headless Chromium.

```
cd dev && npm install && npm run check      # 53 checks
cd dev && npm run shot flow                 # screenshot a view
```

Drop a Backup & Restore export at `dev/sample-data.json` (gitignored — this
repo is public) so the preview runs on real content rather than the tidier
seed data.

Use it. Every check in `checks.js` exists because that thing broke once, and
several bugs reached the live site only because the harness of the day was not
faithful enough:

- it must use the app's **real `<style>` block**, not a copied subset — a
  hand-copied subset once left the published page entirely unstyled while the
  preview looked right;
- it must apply the app's **real `<body>` classes** — a bare `<body>` hid
  Tailwind's `bg-slate-100` printing a grey block on every last page;
- assertions read **`innerText`, not `textContent`** — the app's source is
  inlined in the page, so `textContent` contains the whole program and matches
  almost anything.

A blank page almost always means a syntax or Babel-transform error —
`npm run build` catches it, or check the browser console.

## Deployment — read this before pushing

**`pipeline-tool-v2.html` is a redirect, not the app.** The app was renamed to
`workflow-tool.html`; the old file forwards to it with `location.replace`,
carrying `location.search` and `location.hash` so old bookmarks and published
links already sent (`?p=<slug>`) keep working. Keep the file; do not put app
code back in it.

The live app is served by **GitHub Pages** at
<https://keeganwh.github.io/Langara/workflow-tool.html>, configured as
*deploy from a branch*, so **a push to the deploy branch publishes to the live
URL within about a minute.** There is no review gate.

The deploy branch is **`main`** (fast-forwarded to the old trunk on
2026-09-02). `claude/sharp-mayer-090866` was the trunk before that; if it still
exists it is a dead pointer.

The bare URL <https://keeganwh.github.io/Langara/> 404s, because there is no
`index.html` at the repo root — only `workflow-tool.html`. That is expected,
not a deploy fault.

Consequences:

- Work committed to any other branch is **not live**, however finished it is.
- A push to the trunk is a production deploy. Verify in a browser first.
- Work on a feature branch; merge to `main` only when it is ready to be live.

## Git

Trunk is `main` — see above. Commit with descriptive
messages. Never commit `.claude/` (gitignored).

Before a change big enough to be worth naming, cut an
`archive/vX.Y-<short-name>` branch at the current tip and push it, then
record it in `VERSIONS.md`. See that file for rollback steps and for the
distinction between backing up the **code** (git) and the **data** (the
app's Backup & Restore export) — they are separate, and rolling one back
does not roll back the other.

## Ask before creating

Don't create branches, files, tags, services, or accounts that weren't
asked for. If the obvious path seems to need one, **ask first** — say what's
missing and what you propose, rather than inventing scaffolding and
reporting it afterwards. Prefer using what already exists, even when the
naming is unintuitive.

This applies especially to anything with a name that implies convention
(`main`, `dist/`, `.github/workflows/`), because those quietly become
structure that everyone afterwards has to work around.

## Security posture (verified 2026-08-26)

The repo is **public** and must stay that way — GitHub Pages serves the live
site from it, and Pages on a private repo needs a paid plan. This is fine:
GitHub holds only the code. All real content lives in Firebase.

The Firebase config and web API key are committed in the HTML. That is
normal and not a leak — a Firebase web API key is a project identifier, not
a secret. Access is enforced by two things, both confirmed in place:

- **Realtime Database rules require authentication** (`auth != null`), so
  the `pipeline` and `presence` trees can't be read or written anonymously.
- **Self-signup is disabled** in Authentication → Settings → User actions.
  New users are created by hand in the Firebase console
  (Authentication → Users → Add user). The app has no signup UI and never
  calls `createUserWithEmailAndPassword`.

Don't re-raise the committed API key as a vulnerability; it is a deliberate,
sound arrangement. Do re-check the two settings above if auth behaviour ever
looks wrong.

## Known rough edges
- Last-write-wins sync: the 2-second debounce means two people editing
  simultaneously can clobber each other. There is a manual ↻ refresh button.
- `prompt()` / `confirm()` / `alert()` are used for several flows.
