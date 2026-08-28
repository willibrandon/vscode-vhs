---
title: Settings
description: Extension settings and defaults.
---

| Setting                       | Default  | Purpose                                                            |
| ----------------------------- | -------- | ------------------------------------------------------------------ |
| `vhs.validation.enable`       | `true`   | Enable built-in checks.                                            |
| `vhs.validation.maxProblems`  | `200`    | Limit diagnostics per file.                                        |
| `vhs.targetVersion`           | `latest` | Check command version support. Use `auto` to detect installed VHS. |
| `vhs.index.useIgnoreFiles`    | `true`   | Exclude Git-ignored tapes from automatic indexing.                 |
| `vhs.externalValidation.mode` | `off`    | Use `onSave` to run `vhs validate` after saves.                    |
| `vhs.executablePath`          | `vhs`    | Set the VHS executable path.                                       |
| `vhs.codeLens.enabled`        | `true`   | Show run actions above a tape.                                     |
| `vhs.trace.server`            | `off`    | Log language server messages.                                      |
