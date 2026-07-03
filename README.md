# Diffium — Modern Diff Viewer for VS Code

<p align="center"><img src="media/icon.png" width="110" alt="Diffium icon"></p>

<p align="center">
  <a href="https://github.com/sitharaj88/diffium/actions/workflows/ci.yml"><img src="https://github.com/sitharaj88/diffium/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/VS%20Code-1.95%2B-blue" alt="VS Code 1.95+">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license">
</p>

**Diffium** is a beautiful, fast diff viewer with **GitHub Copilot integration**. Compare two files, two folders, or a file against your clipboard in a polished side-by-side view — virtualized so even 100,000-line diffs scroll smoothly — then ask Copilot to explain or review the change without leaving the viewer.

---

## Why Diffium?

VS Code's built-in diff is great for git workflows, but comparing *arbitrary* files and folders — and understanding large unfamiliar diffs — deserves better tooling:

- **See what actually changed.** Word-level highlighting pinpoints the exact characters that differ inside a line. Moved code is detected and marked with `⇄` in a calm tint instead of shouting red/green, so refactors read like refactors.
- **Stay fast at any size.** Rendering is virtualized: only the visible rows exist in the DOM. A 100k-line diff computes in well under a second and scrolls like a small one.
- **Understand it with AI.** One click streams a Copilot explanation or a severity-ordered code review into a side drawer — powered by the official VS Code Language Model API and your existing Copilot subscription. No API keys, nothing leaves the Copilot channel you already trust.

## Features

### The viewer
| | |
|---|---|
| **Split / Inline modes** | Toggle instantly with the segmented control |
| **Word-level highlights** | Exact changed characters inside modified lines |
| **Moved-code detection** | Relocated blocks get a `⇄` gutter mark and blue tint |
| **Ignore whitespace** | Hide indent-only churn; each side still shows its real text |
| **Folding** | Unchanged stretches collapse to `⋯ N unchanged lines`; click to expand |
| **Syntax highlighting** | 25+ languages, follows your VS Code theme (light/dark/HC) |
| **Minimap** | Change-density strip on the right edge; click or drag to jump |
| **Change navigation** | `▲▼` buttons with a position counter, plus keyboard (below) |
| **Stats** | GitHub-style `+added / −removed` with ratio bar |
| **Swap sides** | Reverse the comparison direction in one click |

### Folder comparison
Compare two directory trees. Identical files are filtered out automatically; a sidebar lists every **A**dded / **D**eleted / **M**odified file with a filter box and per-file `+/−` stats. Common noise directories (`.git`, `node_modules`, `dist`, `out`) are skipped.

### GitHub Copilot integration ✦
- **✦ Explain** — a streamed, structured explanation: intent summary, then notable changes grouped by theme
- **✦ Review** — an AI code review: bugs, risky edge cases, and improvements, ordered by severity
- Responses stream live into a side drawer with **Stop** and **Copy** controls
- Works with whatever Copilot models your account has; pin one with `diffium.ai.modelFamily`
- The diff viewer is fully functional **without** Copilot — AI buttons simply report that no model is available

## Getting started

1. Install Diffium (and optionally GitHub Copilot for the AI features).
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run one of:

| Command | What it does |
|---|---|
| **Diffium: Compare Two Files…** | Pick two files (old first, new second) |
| **Diffium: Compare Two Folders…** | Pick the old folder, then the new folder |
| **Diffium: Compare Active File with Clipboard** | Diff the current editor against your clipboard |

Or select **exactly two files or two folders** in the Explorer, right-click → **Compare Selected (Diffium)**.

### Keyboard shortcuts (inside the viewer)

| Keys | Action |
|---|---|
| `n` / `j` / `Alt+↓` | Next change block |
| `p` / `k` / `Alt+↑` | Previous change block |

## Settings

| Setting | Default | Description |
|---|---|---|
| `diffium.contextLines` | `3` | Context lines kept visible around changes when folding unchanged regions |
| `diffium.ai.modelFamily` | *(auto)* | Preferred Copilot model family (e.g. `gpt-4o`). Empty = best available |

## Troubleshooting

- **"No language model is available"** — install the GitHub Copilot extension and sign in, then retry. The first AI request shows a one-time permission prompt; approve it.
- **Binary or huge files** — Diffium shows a notice instead of a text diff for binary content and for pairs beyond ~8 MB combined.
- **Folder compare seems incomplete** — scans are capped at 4,000 files per side; a warning appears if the cap is hit.

## Development

```bash
git clone https://github.com/sitharaj88/diffium.git
cd diffium
npm install
npm run build       # bundle extension + webview (npm run watch for dev)
npm run typecheck   # strict TypeScript
npm test            # diff engine unit tests (node:test)
```

Press **F5** in VS Code to launch the Extension Development Host. Good demo inputs live in `samples/` (TypeScript) and `test/` (JSON).

### Release

```bash
npm run package     # produces diffium-<version>.vsix via vsce
```

Install the `.vsix` locally with *Extensions: Install from VSIX…*, or publish with `npx @vscode/vsce publish` (requires a [publisher](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) matching `package.json#publisher`).

### Architecture

```
src/
  extension.ts     activation, commands, folder tree walking/matching
  diffEngine.ts    jsdiff line alignment, word-level ranges, moved-block detection
  diffPanel.ts     webview controller: sessions, options, AI streaming
  ai.ts            VS Code Language Model API (Copilot) — model selection, prompts
  webview/
    main.ts        virtualized renderer, minimap, navigation, sidebar, AI drawer
    styles.css     theme-aware styling via --vscode-* variables
tests/             engine unit tests (run in CI)
.github/           CI: typecheck → test → build → .vsix artifact
```

Design notes:
- The webview renders **one display item per fixed-height row** — that invariant is what makes virtualization trivial and fast. In inline mode, modified lines expand into a deletion row plus an addition row at display-list build time.
- The diff engine slices context rows from the *original* line arrays of each side, so ignore-whitespace mode still shows each side's true text.
- Moved-block detection is deliberately conservative (≥2 consecutive matching lines, or one line ≥30 significant chars) so braces and blank lines never light up as "moves".

## Roadmap

- In-view merge editing (apply / revert hunks)
- Git integration: working-tree changeset review, AI commit messages
- `@diffium` chat participant for Copilot Chat
- Image diff

## Contributing

Issues and PRs are welcome at [github.com/sitharaj88/diffium](https://github.com/sitharaj88/diffium). Please run `npm run typecheck && npm test` before submitting.

## License

[MIT](LICENSE) © 2026 Sitharaj
