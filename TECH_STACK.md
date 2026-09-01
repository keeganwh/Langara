# Tech Stack

## Summary

A **single-file, build-free React application**. One HTML document
(`pipeline-tool-v2.html`) contains the markup, styles, and the entire
application source, compiled in the browser at load time. There is no
`package.json`, no bundler, no test runner, and no CI. Deployment is
"put the file somewhere and open it."

## Runtime dependencies (all CDN, all loaded in `<head>`)

| Dependency | Version | Source | Purpose |
|---|---|---|---|
| Tailwind CSS | latest (`cdn.tailwindcss.com`) | JIT browser build | all styling |
| React | 18 (`react.development.js`) | unpkg UMD | UI |
| ReactDOM | 18 (`react-dom.development.js`) | unpkg UMD | rendering + `createPortal` |
| Babel Standalone | **pinned 7.23.10** | unpkg | transpiles the inline `<script type="text/babel">` at runtime |
| firebase-app-compat | 10.12.0 | gstatic | SDK core |
| firebase-database-compat | 10.12.0 | gstatic | Realtime Database sync |
| firebase-auth-compat | 10.12.0 | gstatic | email/password auth |

Notes:

- The **development** builds of React are used, not production. Slower and
  larger, but gives real error messages — reasonable for an internal tool.
- Babel is **deliberately pinned**. An unpinned upgrade previously produced a
  blank page (commit `321d7cb`). Treat the version as load-bearing.
- The `compat` Firebase SDKs (namespaced `firebase.x()` API) are used rather
  than the modular v9+ API, because there is no bundler to tree-shake.
- Everything requires network access on load. There is no offline bundle.

## Language and syntax constraints

Source is **JSX + modern JS**, transpiled in-browser. Because the transform
runs through pinned Babel Standalone:

- Optional chaining on **computed** member access (`obj?.[key]`) has caused
  transform failures inside `generatePrintHTML`. Avoid it there.
- No modules, no `import`/`export` — everything is one top-level script
  scope. New components are plain top-level `function` declarations.
- No TypeScript.

## Backend

**Firebase Realtime Database**, project `cs-program-development-flow`.

- Single JSON tree written to path `pipeline`.
- **Whole-store writes.** `saveToFB` calls `.set()` on the entire store,
  debounced 2 seconds after any change. Consequence: last-write-wins;
  concurrent editors can overwrite each other. A manual refresh (↻) button
  in the top bar re-pulls.
- **localStorage** (`cs_pipeline_tool_v2`) is the fallback: written on every
  successful save, and read if Firebase load or save fails.
- **Presence**: `usePresence` writes to a presence path with `onDisconnect`
  cleanup and drives the avatar cluster in the top bar.
- **Auth**: Firebase email/password. `Root` gates on `onAuthStateChanged`;
  unauthenticated users get `LoginScreen`. The Firebase web API key is
  committed in the file (normal for web SDKs — access control belongs in
  the database security rules).

## State management

Plain React state. `useStore()` is the single source of truth:

```
useStore() → [store, updateStore, syncStatus, refreshStore]
```

- `store` is `null` while loading.
- `updateStore` accepts an updater function or a partial object and pipes
  the result through `normalizeStore` **on every call**, which back-fills
  defaults for any missing field. New schema fields must be added there.
- `syncStatus` is `'loading' | 'saving' | 'ready' | 'error'`, surfaced as a
  pill in the top bar.

State flows top-down through props; there is no context, reducer, or
external store library.

## Interaction techniques in use

- **HTML5 drag-and-drop** (`draggable`, `onDragStart/Over/Drop`) for
  reordering steps within a document and moving them between documents.
  Drag state is held in a `useRef` on `ProjectTypeCanvas`.
- **Synchronised scroll**: the document header row is a separate
  non-scrolling container whose `scrollLeft` is mirrored from the body's
  `onScroll` handler, so headers stay pinned while steps scroll.
- **Portals** for modals (`ReactDOM.createPortal`), to escape the sticky
  header stacking context.
- **Print/PDF export** builds a *separate standalone HTML string*
  (`generatePrintHTML`) and writes it into an off-screen iframe, then calls
  print. It does not reuse the React components — so **any new view that
  should be printable needs its own code path there.**

## Local checking tools (`dev/`)

Not part of the app and never deployed — GitHub Pages serves only the HTML
file. `dev/` contains a small Node harness that builds an offline copy of the
app (local React/Tailwind, stubbed Firebase, optional real backup data) and
drives it in headless Chromium via Playwright, with a set of regression checks
and a screenshot command. See `dev/README.md`. It exists because the app needs
both the internet and a Firebase login to run normally, which an agent session
usually lacks.

## What's absent (and worth knowing before proposing changes)

- No unit tests, no linting, no type checking (though see `dev/` above).
- No routing — view switching would be React state.
- No component library or icon set; icons are emoji.
- No accessibility layer: several flows use `prompt()`, `confirm()`, and
  `alert()`; drag-and-drop has no keyboard equivalent.
- No error boundaries — a render error yields a blank page.

## Practical implication for new work

Adding a feature means editing one file, reloading a browser tab, and
checking the console. That is fast, but it also means the file grows
monotonically (~109 KB / ~2,100 lines today). New large views are best added
as their own clearly-delimited top-level components with a `// ── Name ──`
banner comment, matching the existing sectioning.
