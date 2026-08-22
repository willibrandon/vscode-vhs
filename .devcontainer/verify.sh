#!/usr/bin/env bash

set -euo pipefail

readonly workspace_root="$(git rev-parse --show-toplevel)"
readonly expected_mounts=(
  "$workspace_root/node_modules"
  "$workspace_root/dist"
  "$workspace_root/coverage"
  "$workspace_root/.vscode-test"
  "$workspace_root/.vscode-test-web"
  "$workspace_root/packages/language-core/lib"
  "$workspace_root/packages/language-server/lib"
  "$workspace_root/packages/vscode-client/lib"
  "$workspace_root/docs-site/node_modules"
  "$workspace_root/docs-site/dist"
  "$workspace_root/docs-site/.astro"
  "/home/vscode/.npm"
  "/home/vscode/.cache"
)

test "$(node --version)" = "v24.19.0"
test "$(npm --version)" = "12.0.2"
test "$(node -p 'process.platform')" = "linux"
[[ "$(vhs --version)" == "vhs version v0.11.0"* ]]
test "$(ttyd --version)" = "ttyd version 1.7.7-40e79c7"
for tool in chromium docker ffmpeg git jq ssh ttyd vhs xauth xvfb-run; do
  command -v "$tool" >/dev/null
done

for directory in "${expected_mounts[@]}"; do
  mountpoint --quiet "$directory"
done

test -S /var/run/docker-host.sock
test "$(git -C "$VHS_UPSTREAM" rev-parse HEAD)" = "c6af91a25fed05852338a5ed58d9b099b8369a1e"
test "$(git -C "$TREE_SITTER_VHS_UPSTREAM" rev-parse HEAD)" = "0c6fae9d2cfc5b217bfd1fe84a7678f5917116db"

docker version
npm run check:upstream
npm test -- test/upstream/vhs-conformance.test.ts
VHS_RENDER=1 npm test -- test/upstream/vhs-render.test.ts
npm run verify
npm run test:integration
npm run test:web
npm run package
npm run check:release-reproducibility
npm run test:vsix:prepared
npm run test:remote:prepared
npm run test:docs
