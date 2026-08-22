# Upstream data

`data/upstream-lock.json` records the reviewed VHS and tree-sitter-vhs revisions. The extension does
not download upstream data at runtime.

The fixtures cover the official VHS command example and tree-sitter corpus. Their license is
recorded in `THIRD-PARTY-NOTICES.md`.

```sh
npm run fixtures:upstream
npm run check:upstream
```

The sync command uses the reviewed sibling checkouts or `VHS_UPSTREAM` and
`TREE_SITTER_VHS_UPSTREAM`. Review generated changes before updating a pin.
