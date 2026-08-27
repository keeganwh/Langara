# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

The **CS Pipeline Tool v2** — an internal workflow-mapping app for Langara
College's Continuing Studies department. It documents how curriculum
documents (Concept Paper, Course Proposal, Program Proposal, Program
Summary, Discontinuation Form) travel through the college's approval
pipeline: who reviews them, who signs, who carries them to which meeting,
and where the files live at each stage.

It is a **reference/design tool, not a tracker**. It maps the shape of the
process itself; it does not track individual in-flight programs.

## Repository shape

The entire application is one file:

- `pipeline-tool-v2.html` — ~2,100 lines. HTML + Tailwind (CDN) + React 18
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

There is no test suite. Verify changes by opening the file in a browser and
exercising the affected flow. A blank page almost always means a syntax or
Babel-transform error — check the browser console first.

## Deployment — read this before pushing

The live app is served by **GitHub Pages** at
<https://keeganwh.github.io/Langara/pipeline-tool-v2.html>, deployed from
the **`claude/sharp-mayer-090866`** branch (odd name, but it is the trunk
and the repo's GitHub default). Pages is configured as *deploy from a
branch*, so **pushing to `claude/sharp-mayer-090866` publishes to the live
URL within about a minute.** There is no review gate.

Consequences:

- Work committed to any other branch is **not live**, however finished it is.
- A push to the trunk is a production deploy. Verify in a browser first.
- `main` exists (created 2026-08-26) but is **not** what Pages serves.
  Don't assume the usual `main` convention here.

## Git

Trunk is `claude/sharp-mayer-090866` — see above. Commit with descriptive
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
