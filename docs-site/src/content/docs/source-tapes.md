---
title: Source tapes
description: Work across related tape files.
---

`Source` paths are links. Go to Definition opens the target tape. Find References shows every use.
Renaming a sourced tape updates paths through VS Code.

Paths start at the tape's workspace folder, matching VHS runs from the project root.

Automatic tape discovery respects `files.exclude` and nested `.gitignore` files. Explicitly opened
and sourced tapes remain available. Set `vhs.index.useIgnoreFiles` to `false` only when an ignored
generated tree should be indexed automatically.

The extension reports missing, empty, nested, and cyclic sources without running VHS.
