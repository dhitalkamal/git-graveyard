# Tasks: judge-ready demo

- [ ] 1. Split the UI by job
  - [ ] 1.1 Move styles to `src/ui/ui.css`; serve it from an allowlist built from `src/ui/` at start
  - [ ] 1.2 Move diff parsing and both diff views to `src/ui/diff.js`
  - [ ] 1.3 Move the side panel, Overview and hover card to `src/ui/panel.js`
  - [ ] 1.4 Move scene setup to `src/ui/scene.js`, graves to `src/ui/graves.js`, animations to `src/ui/effects.js`
  - [ ] 1.5 Leave tabs, filters, picking and the loop in `src/ui/main.js`; `src/ui.html` keeps only markup
  - [ ] 1.6 Server test: each UI file is served, an unknown one is 404
  - [ ] 1.7 `node scripts/check-size.mjs` passes; headless screenshots match the current look
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 2. Add the data source with live and demo modes
  - [ ] 2.1 `src/ui/data.js` with `tombs`, `detail`, `revive`, `deleteWard`
  - [ ] 2.2 Route every `fetch` in the UI through it
  - [ ] 2.3 Panel words raise and delete results from the `demo` flag
  - _Requirements: 2.2, 2.3, 2.4_

- [ ] 3. `graveyard export-demo <dir>`
  - [ ] 3.1 `src/demo.js` `exportDemo()` writes data, page, UI files, lib files, three.js files, marker
  - [ ] 3.2 Relative URLs in the page and import map
  - [ ] 3.3 Refuse a foreign non-empty folder and a missing three.js
  - [ ] 3.4 Test: files exist, every grave has detail, no temp-dir path leaks, re-export works, foreign folder refused
  - _Requirements: 2.1, 2.5, 2.6_

- [ ] 4. Hosting
  - [ ] 4.1 `npm run demo` rebuilds the sandbox and exports to `docs/demo/`
  - [ ] 4.2 README links the hosted demo near the top
  - _Requirements: 3.1, 3.2_
