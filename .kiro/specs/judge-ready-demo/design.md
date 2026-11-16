# Design: judge-ready demo

## UI split

`src/ui.html` becomes a short shell plus ES modules under `src/ui/`, one job each:

| File | Job |
|---|---|
| `src/ui.html` | markup, import map, one `<script type="module" src="/ui/main.js">` |
| `src/ui/ui.css` | all styles |
| `src/ui/data.js` | the data source: `live` (fetch `/api/*`) or `demo` (one JSON file) |
| `src/ui/scene.js` | renderer, camera, sky, moon, ground, trees, fence, fireflies |
| `src/ui/graves.js` | stone, ghost and face textures; `buildGraves()` |
| `src/ui/effects.js` | resurrection and burial animations |
| `src/ui/panel.js` | side panel, Overview, hover card |
| `src/ui/diff.js` | `parsePatch`, line numbers, side-by-side and unified views |
| `src/ui/main.js` | tabs, filters, picking, the render loop, wiring |

The server allowlists `/ui/*.js` and `/ui/ui.css` by reading `src/ui/` once at
start, so no request path ever reaches the file system. CSP gains
`style-src 'self'` for the stylesheet.

## Data source

`data.js` exports one object with the same four calls in both modes:

```js
tombs()            // { repo, now, tombstones }
detail(id)         // { commits, patch, truncated }
revive(id)         // { branch, demo? }
deleteWard(id)     // { deleted, demo? }
```

Mode comes from `<meta name="graveyard-mode" content="live|demo">`, which the
server writes as `live` and `export-demo` writes as `demo`. In demo mode
`tombs()` and `detail()` read `demo-data.json`; `revive()` and `deleteWard()`
return the would-be result with `demo: true`, and the panel words its message
from that flag.

## Export

`src/demo.js` exports `exportDemo(cwd, outDir)`:

1. Scan the repo and build `detailOf()` for every grave.
2. Write `demo-data.json`: `{ repo: 'demo: <repo folder name>', now, tombstones, details }`.
   `now` is pinned to the export time so "died 2d ago" reads the same tomorrow.
3. Copy `src/ui.html` (with the mode meta set to `demo` and the token removed),
   `src/ui/*`, `src/filter.js` and `src/time.js` under `lib/`, and the three.js
   files the page imports.
4. Write `.graveyard-demo` as a marker so a later export may overwrite the folder.

All URLs in the page become relative (`./ui/main.js`, `./lib/filter.js`,
`./vendor/three/...`) so the site works under a GitHub Pages sub-path.

## Error handling

- Export into a non-empty folder without the marker: refuse with the path.
- Missing `node_modules/three`: refuse and say to run `npm install`.

## Testing

- `check-size.mjs` passes.
- Server test: every `/ui/*` file is served; an unknown `/ui/x.js` is a 404.
- Export test: build a small repo, export, assert the files exist, the JSON holds
  every grave with a patch, no absolute path of the temp dir appears in any file,
  and a second export into the same folder succeeds while an export into a
  foreign non-empty folder fails.
- Headless screenshots of the live and the demo page look the same.
