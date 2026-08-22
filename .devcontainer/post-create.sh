#!/usr/bin/env bash

set -euo pipefail

readonly workspace_root="$(pwd -P)"
readonly owner="$(id -u):$(id -g)"
readonly upstream_root="/home/vscode/.cache/vscode-vhs"
readonly vhs_root="$upstream_root/vhs"
readonly tree_sitter_root="$upstream_root/tree-sitter-vhs"
readonly vhs_revision="c6af91a25fed05852338a5ed58d9b099b8369a1e"
readonly tree_sitter_revision="0c6fae9d2cfc5b217bfd1fe84a7678f5917116db"
readonly isolated_directories=(
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

for directory in "${isolated_directories[@]}"; do
  sudo chown "$owner" "$directory"
done

initialize_repository() {
  local directory="$1"
  local repository="$2"
  if [[ "$(git -C "$directory" remote get-url origin 2>/dev/null || true)" == "$repository" ]]; then
    return
  fi
  mkdir -p "$directory"
  find "$directory" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  git -C "$directory" init --quiet
  git -C "$directory" remote add origin "$repository"
}

initialize_repository "$vhs_root" https://github.com/charmbracelet/vhs.git
git -C "$vhs_root" fetch --depth 1 --no-tags origin "$vhs_revision"
git -C "$vhs_root" checkout --detach --force "$vhs_revision"

initialize_repository "$tree_sitter_root" https://github.com/charmbracelet/tree-sitter-vhs.git
git -C "$tree_sitter_root" fetch --depth 1 --no-tags origin "$tree_sitter_revision"
git -C "$tree_sitter_root" checkout --detach --force "$tree_sitter_revision"

test "$(git -C "$vhs_root" rev-parse HEAD)" = "$vhs_revision"
test "$(git -C "$tree_sitter_root" rev-parse HEAD)" = "$tree_sitter_revision"

npm ci
npm --prefix docs-site ci
node --version
npm --version
vhs --version
ttyd --version
ffmpeg -version | head -n 1
