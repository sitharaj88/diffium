# Changelog

All notable changes to **Diffium** are documented here.

## [1.0.0] — 2026-07-03

Initial public release. 🎉

### Viewer
- Split and Inline diff modes with instant toggle
- Split panes always fit the viewport; long lines pan horizontally **in sync** via a shared bottom scrollbar (trackpad / `Shift`+wheel supported)
- Word-level (intra-line) change highlighting
- Syntax highlighting for 25+ languages, themed to VS Code light/dark/high-contrast
- Foldable unchanged regions (`⋯ N unchanged lines`), Expand/Fold all
- GitHub-style `+/−` stats with ratio bar
- Virtualized rendering — 100k-line diffs stay smooth (only visible rows in the DOM)
- Minimap change-density strip with click/drag navigation
- Change-block navigation: `▲`/`▼` buttons, `n`/`p`, `j`/`k`, `Alt+↑/↓`
- Moved-code detection: relocated blocks marked with `⇄` and a calm tint
- Ignore-whitespace toggle (each side keeps its real text)
- Swap sides

### Comparisons
- Compare Two Files… (picker)
- Compare Two Folders… — identical files filtered, sidebar with A/D/M badges, filter box, per-file stats
- Compare Selected (two files or two folders from the Explorer context menu)
- Compare Active File with Clipboard

### GitHub Copilot integration
- ✦ Explain and ✦ Review — streamed into a side drawer via the VS Code Language Model API
- Uses your existing Copilot subscription; model selectable via `diffium.ai.modelFamily`
- Stop / Copy controls; graceful fallback message when Copilot is unavailable

### Engineering
- Diff engine unit tests (node:test), strict TypeScript, esbuild bundling
- GitHub Actions CI: typecheck → test → build → `.vsix` artifact
