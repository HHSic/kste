#!/bin/sh
# GUI 앱의 PATH에 Node가 없을 때도 사용자 설치 위치를 찾는다. stdin은 hook JSON 그대로 전달한다.
hook_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
kste_node=''
try_node() {
  [ -n "$1" ] && [ -x "$1" ] || return 1
  "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' </dev/null >/dev/null 2>&1 || return 1
  kste_node=$1
}
if [ -n "${KSTE_NODE_PATH:-}" ]; then
  try_node "$KSTE_NODE_PATH" || true
fi
if [ -z "$kste_node" ]; then
  try_node "$(command -v node 2>/dev/null)" || true
fi
if [ -z "$kste_node" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node /opt/local/bin/node \
    "$HOME/.volta/bin/node" "$HOME/.local/bin/node" \
    "$HOME"/.nvm/versions/node/*/bin/node \
    "$HOME"/.fnm/node-versions/*/installation/bin/node \
    "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node; do
    if try_node "$candidate"; then break; fi
  done
fi
if [ -z "$kste_node" ]; then
  printf '%s\n' '{"systemMessage":"KSTE가 실행되지 않았습니다: Node.js 20 이상을 찾지 못했습니다. Node.js를 설치하고 Codex를 완전히 종료한 뒤 다시 실행하세요. 별도 설치 경로는 KSTE_NODE_PATH로 지정할 수 있습니다."}'
  exit 0
fi
exec "$kste_node" "$hook_dir/kste-run-hook.mjs" "$@"
