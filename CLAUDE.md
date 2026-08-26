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
| 1190–1413 | `ProjectTypeCanvas` | **the main view** — horizontal document columns |
| 1415–1600 | editor modals | project types, roles, backup/restore, templates |
| 1602–1737 | `generatePrintHTML` | standalone HTML string for print/PDF export |
| 1739–1764 | `usePresence` | live avatars of other signed-in editors |
| 1766–2075 | `App` | sidebar, top bar, modal routing |
| 2076–2094 | `Root` | auth gate |

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
- **`normalizeStore` runs on every update**, not just on load. Any new step
  or store field needs a default added there, or existing Firebase data will
  come back with it `undefined`.
- Every edit path goes through `updateStore` / `onUpdateProjectType` and
  stamps `updatedAt`.
- Modals must render via the `Modal` primitive (portal) to sit above the
  sticky headers.
- Print output has its own renderer (`generatePrintHTML`) — **new views need
  a matching change there** if they should be printable.

## Testing

There is no test suite. Verify changes by opening the file in a browser and
exercising the affected flow. A blank page almost always means a syntax or
Babel-transform error — check the browser console first.

## Git

Work on the designated feature branch. Commit with descriptive messages.
Never commit `.claude/` (gitignored).

## Known rough edges

- Firebase config and API key are committed in the file (acceptable for a
  Realtime Database locked down by auth rules, but worth knowing).
- Last-write-wins sync: the 2-second debounce means two people editing
  simultaneously can clobber each other. There is a manual ↻ refresh button.
- `prompt()` / `confirm()` / `alert()` are used for several flows.
