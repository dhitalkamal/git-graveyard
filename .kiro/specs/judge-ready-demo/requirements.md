# Requirements: judge-ready demo

## Introduction

Judges must be able to see and try Graveyard without installing anything or
risking their own repos. Today the cemetery runs only from a local server against
a real repo, and `src/ui.html` is 959 lines, over the 500-line cap in
`.kiro/steering/structure.md`. This feature splits the UI by job and adds a
static demo of the cemetery, built from the sandbox repo, that can be hosted on
GitHub Pages.

## Requirement 1: UI split by job

**User story:** As a maintainer, I want the cemetery code split into files by
job, so that each one stays readable and under the cap.

1. WHEN `node scripts/check-size.mjs` runs THEN every file in `bin/`, `src/` and
   `scripts/` SHALL be 500 lines or fewer.
2. WHEN the UI is split THEN the page SHALL look and behave the same as before:
   tabs, filters, hover card, panel with Overview and Changes, side-by-side and
   unified diff, raise, resurrection, delete ward, burial.
3. WHEN the server serves the page THEN it SHALL serve only an allowlisted set of
   UI files, the same way it serves `/lib/filter.js` today.
4. WHEN the split is done THEN the Content-Security-Policy SHALL still forbid
   loading anything from another origin.

## Requirement 2: static demo export

**User story:** As a judge, I want to open a link and walk the cemetery with
sample graves, so that I can judge it without installing it.

1. WHEN a user runs `graveyard export-demo <dir>` inside a repo THEN Graveyard
   SHALL write a self-contained static site to `<dir>`: the page, its UI files,
   the three.js files it imports, and one JSON file holding every grave with its
   detail (commits and patch).
2. WHEN the demo page loads THEN it SHALL read graves from that JSON file and
   SHALL NOT call any `/api/` route.
3. WHEN a judge presses **Raise on a new branch** in the demo THEN the
   resurrection SHALL play and the panel SHALL say which branch would be
   created, and that this is a demo, so nothing was created.
4. WHEN a judge presses **Delete this ward** in the demo THEN the burial SHALL
   play and the panel SHALL say that nothing was deleted.
5. WHEN the demo is exported THEN it SHALL contain no absolute path from the
   exporting machine; the repo label SHALL read `demo: graveyard-sandbox`.
6. IF `<dir>` exists and is not empty and was not made by `export-demo` THEN the
   command SHALL refuse to write and say why.

## Requirement 3: hosting

**User story:** As the author, I want one command to rebuild the hosted demo,
so that the link always shows the current version.

1. WHEN `npm run demo` runs THEN it SHALL rebuild the sandbox and export the demo
   to `docs/demo/`, ready for GitHub Pages.
2. WHEN the README is read THEN it SHALL link the hosted demo near the top.
