# VHS

Language support for VHS tape files in Visual Studio Code.

## Install

Search for **VHS** in the Extensions view or run:

```sh
code --install-extension willibrandon.vhs-tape
```

[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=willibrandon.vhs-tape)
· [Open VSX](https://open-vsx.org/extension/willibrandon/vhs-tape) ·
[Documentation](https://willibrandon.github.io/vscode-vhs/)

## Features

- Highlighting, completion, hover help, diagnostics, and formatting
- All VHS 0.11 commands, settings, shells, and built-in themes
- Source navigation, references, rename updates, symbols, and folding
- Trusted tape runs, installed VHS validation, cancellation, and output logs
- GIF, video, text, frame, and screenshot previews
- Desktop, remote, and browser language support

VHS is optional for editing. Install `vhs`, `ffmpeg`, and `ttyd` to run tapes.

```vhs
Output demo.gif
Set Shell bash

Type "echo hello"
Enter
Sleep 1s
```

## Development

```sh
npm ci
npm run verify
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/testing.md](docs/testing.md).
