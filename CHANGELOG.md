# Changelog

## [0.1.3] - 2026-08-28

- Automatic tape discovery now respects VS Code `files.exclude`, nested `.gitignore` rules, and
  common generated-output directories.
- Explicitly opened tapes and explicit `Source` targets remain available even when ambient discovery
  excludes their directories.
- Added the default-on `vhs.index.useIgnoreFiles` setting, live exclusion refreshes, cross-platform
  regression coverage, and matching README and documentation-site guidance.
- Made root `.gitignore` refreshes resilient to dropped recursive watcher events during workspace
  startup, while also refreshing directly for in-editor ignore-file changes.

## [0.1.2] - 2026-08-22

- Added complete VHS 0.11 syntax highlighting and language support.
- Added completion, hover help, diagnostics, formatting, navigation, symbols, folding, colors, and
  code actions.
- Added trusted tape runs, installed VHS validation, cancellation, output logging, and artifact
  previews.
- Added desktop, browser, Remote SSH, exact VSIX, upstream conformance, security, and documentation
  tests.
- Matched VHS working-directory, zero-duration, Wait, modifier, output, and path behavior.
- Installed the pinned VHS executable before the release workflow runs its full verification.
- Added a registry-safe package ID and a preflight check for package-name conflicts.

## [0.1.1] - 2026-08-22

No registry artifacts were published. Release automation created a private draft, then the Visual
Studio Marketplace rejected the reserved package name. The draft was removed.

## [0.1.0] - 2026-08-22

No artifacts were published. Release automation stopped during verification, before credential
checks, packaging, release creation, or registry publishing.
