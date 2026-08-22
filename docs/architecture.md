# Architecture

| Package                    | Responsibility                                     |
| -------------------------- | -------------------------------------------------- |
| `packages/language-core`   | Lexer, parser, formatter, VHS data, and analysis   |
| `packages/language-server` | Language Server Protocol handlers and source index |
| `packages/vscode-client`   | VS Code activation, commands, runs, and previews   |

The language core has no Node.js, DOM, or VS Code dependency. Node IPC and browser Worker servers
use the same language implementation.

Browser code cannot start processes. Installed VHS commands require a trusted desktop or remote
workspace. Child processes use argument arrays without a shell, bounded output, timeouts, and
process-tree cancellation.

`npm run build` creates the desktop, remote, browser, and browser-test bundles.
`scripts/package-files.json` is the exact VSIX allowlist.
