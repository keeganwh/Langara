# Versions

The app is a single file with no build step, so "a version" is just a commit.
This file records which commit is which, and how to get back to a known-good
one in a hurry.

## How to roll back

Every released version has an `archive/*` branch pointing at it. To look at
one without disturbing anything:

```
git fetch origin
git checkout archive/v2.0-pre-step-flow   # detached, read-only browsing
```

To actually revert `main` to an archived version:

```
git checkout main
git revert <bad-commit>       # preferred — keeps history honest
```

Or, if you just want the file back without touching history:

```
git checkout archive/v2.0-pre-step-flow -- pipeline-tool-v2.html
```

Then open the file in a browser to confirm before committing.

## Two kinds of backup — don't confuse them

| What | Covers | How |
|---|---|---|
| **Git branches/tags here** | the **app code** — the HTML file | `archive/*` branches, below |
| **Backup & Restore in the app** | the **data** — your project types, documents, steps, roles | sidebar → 💾 Backup & Restore → export JSON |

Rolling the code back does **not** roll the data back, and vice versa. The
data lives in Firebase, shared by everyone; the code lives here. If you're
about to do something risky, take both.

## Released versions

### v2.6 — tracker batches, task statuses
Archive branch: `archive/v2.6-pre-batch`

Batch projects (several items through one workflow), task-level statuses,
people tagged from tasks, project duplication, delete confirm box. Batch
projects use a new stored shape (`batch`, `template`, `items`,
`sharedDocIds`); existing projects are untouched. Rolling the code back would
leave any batch projects unreadable by the older page — export them first.

### v2.5 — collapsible sidebars, narrow-window dashboard
Commit `4f6078d`

Both apps: the sidebar collapses to an icon rail (auto below 1280px, opens
as an overlay there); hover a rail icon to see its full button. Tracker
dashboard: stat tiles toggle their filter, and narrow windows get Needs your
attention first, a row of small cards with drop-down reports, and a two-line
projects toolbar. No data changes — roll back by reverting the commit.

### v2.4 — workflow change history
Archive branch: `archive/v2.4-pre-history`

The Workflow Tool now records every save's changes per workflow under
`pipelineLog/` in Firebase and shows them in a History drawer; the Program
Tracker reads the same log. This changes the Workflow Tool's save path (it
adds a write after each save; the save itself is unchanged). Roll back by
reverting the commit; the log data can be deleted from the Firebase console.

### v2.3 — Program Tracker (hidden)
Archive branch: `archive/v2.3-pre-tracker` · branch `feature/tracker`

Adds `tracker.html`, a separate page for running projects through a workflow:
dashboard, per-document tracks, statuses, dates, people and roles, send back
with rounds, skip, held up, notes, activity log. Writes only under `tracker/`
in Firebase; the Workflow Map and its data are unchanged. Not linked from the
map yet. Rolling back the code is deleting the file; its data can be removed
by deleting `tracker/` in the Firebase console.

### v2.2 — visual clarity pass
Archive branch: `archive/v2.2-pre-visual-clarity` · branch `visual-clarity-pass`

A legibility and layout pass over the **Documents** view, plus the surgical
feature work that came with it.

- Emoji replaced by one Lucide icon set (`ICON_PATHS`), used across Documents,
  Step Flow and the published page. See the icon table in CLAUDE.md.
- Columns flex to share the canvas instead of a fixed 260px, down to a 250px
  minimum; the canvas shows when it can scroll.
- Card hierarchy reworked: quiet aligned metadata keys, role pills, a filed
  chip with an optional link (`step.storageUrl`), document-coloured stage
  names, and sync-group / information-only as badges sharing a corner.
- "Project type" is now "workflow" throughout the UI. **Store keys unchanged.**
- Sidebar reorders by dragging; workflow notes panel (`projectType.notes`),
  shown on the published page; Step Flow cells open read-only detail.
- Step Flow's Details panel no longer hides behind the sticky matrix header.

Two new store fields (`projectType.notes`, `step.storageUrl`) with
`normalizeStore` defaults. Existing data loads unchanged. The harness went from
21 to 37 checks.

### v2.1 — Step Flow view
Archive branch: `archive/v2.1-step-flow` · commit `de1d811`

Adds a second, read-only **Step Flow** view: documents as rows, steps as
columns, so each document's route through the pipeline reads as one
horizontal track. Steps are matched across documents by name. Per-step and
per-detail visibility toggles, stored per-user in `localStorage`. Matching
print/PDF renderer.

The Documents view and the data model are **unchanged** — this release adds
a view and writes nothing new to Firebase.

Also adds `CLAUDE.md`, `TECH_STACK.md`, and this file.

### v2.0 — pre-Step Flow (last version before the above)
Archive branch: `archive/v2.0-pre-step-flow` · commit `49013c4`

The system as it stood on 2026-08-26: Documents view only, Firebase email/
password auth, Realtime Database sync, presence avatars, resizable sidebar,
print/PDF export, Modal portal fix.

This is the fallback if anything in v2.1 misbehaves.

## Conventions

- `main` is the trunk **and the GitHub Pages deploy branch** — pushing to it
  publishes the live site. See CLAUDE.md.
- Before a change big enough to be worth naming, cut
  `archive/vX.Y-<short-name>` at the current tip of `main` and push it.
- Annotated git tags would be tidier, but tag pushes are currently blocked
  by the Claude Code web session's git proxy (HTTP 403), so archive
  branches are used instead. Pushing tags from a normal local clone works
  fine if you'd rather have them:
  `git tag -a v2.1-step-flow de1d811 -m "..." && git push origin --tags`
