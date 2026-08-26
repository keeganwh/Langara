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

### v2.1 — Step Flow view (current)
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

- `main` is the trunk. Work happens here.
- Before a change big enough to be worth naming, cut
  `archive/vX.Y-<short-name>` at the current tip of `main` and push it.
- Annotated git tags would be tidier, but tag pushes are currently blocked
  by the Claude Code web session's git proxy (HTTP 403), so archive
  branches are used instead. Pushing tags from a normal local clone works
  fine if you'd rather have them:
  `git tag -a v2.1-step-flow de1d811 -m "..." && git push origin --tags`
