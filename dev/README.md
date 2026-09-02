# dev — local checking tools

**This folder is not part of the app.** The app is still exactly one file,
`pipeline-tool-v2.html`, and GitHub Pages serves only that. Nothing here is
deployed, and you never need to touch it.

## What it's for

The app normally needs the internet (React, Tailwind and Firebase all load
from elsewhere) and a Firebase login. A Claude Code session usually has
neither, so it can't just open the app and look at it.

These scripts build a **self-contained copy that runs offline**: local copies
of the libraries, a pretend Firebase serving a backup file instead of the real
database, and an automated browser that opens the page, clicks things and
takes screenshots.

That's how changes get checked before you see them.

## Using it

```
cd dev
npm install          # first time only
npm run check        # build, make the preview, run all 36 checks
```

Other commands:

```
npm run build        # just transpile — catches "blank page" errors early
npm run preview      # rebuild dev/.out/preview.html, openable in a browser
npm run shot flow    # screenshot a view: documents | flow | rowlock | published
```

`npm run shot published` also writes a PDF, so print output can be checked.

## Use your real data

Export from the app (sidebar → 💾 Backup & Restore → export) and save it as:

```
dev/sample-data.json
```

It's gitignored, so it never gets committed — worth knowing, because this
repository is public. Without it the preview falls back to the app's built-in
sample data, which is tidier than reality and hides the density and text-length
problems that matter.

## Two things that must stay true

The preview has twice looked fine while the real app was broken, both times
because the preview wasn't faithful enough:

- **It uses the app's real `<style>` block.** An earlier version copied a
  subset by hand, and the published page rendered completely unstyled while
  the preview looked correct.
- **It uses the app's real `<body>` classes.** An earlier version created its
  own bare `<body>`, which hid the fact that Tailwind's `bg-slate-100` was
  printing a large grey block on the last page of every PDF.

If you change `preview.js`, keep both.

## What the checks cover

Each check in `checks.js` exists because that thing actually broke once:

- the app boots and transpiles under the **pinned** Babel
- hiding detail in the Documents view hides it, and keeps step names
- Row Lock disables dragging and gives cards in a row equal heights
- Step Flow renders bypass and START markers
- publishing marks a page current; **display preferences don't make it stale,
  content edits do**
- copy link works
- the published page loads without sign-in, shows the matrix once, and titles
  itself with the project name
- connectors draw a rule, not just an arrowhead
- **step dots keep their colour when background printing is off**, and the
  print background is white
- no emoji survive in the card content, and every action row carries an SVG
- columns are a grid that shares the canvas, and the width preference moves it
- the sidebar says Workflows and reorders by dragging, with no up/down buttons
- the workflow notes panel opens, flags that notes exist, and closes again
- the Step Flow Details panel outranks the sticky matrix header
- a Step Flow cell opens read-only detail that cannot save

Two habits worth copying if you add more: click through the DOM
(`el.click()` inside `page.evaluate`) rather than Playwright's hit-testing,
because by that point in the run the canvas is scrolled and the top bar is out
of view; and assert on a grid *definition* rather than a measured box, because
widths are still settling while Tailwind's CDN build and Babel finish.

A note on one trap: the checks read `innerText`, not `textContent`. The app's
source is inlined in the page, so `textContent` contains the entire program and
will match almost any string you search for — which produced a run of
confidently wrong results before it was spotted.

## Requirements

Node, and a Chromium for Playwright. In Claude Code's environment there's one
at `/opt/pw-browsers/chromium`, which the scripts use automatically. Elsewhere,
`npx playwright install chromium` once, or set `PW_CHROMIUM` to a browser path.
