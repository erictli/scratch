#!/usr/bin/env bash
# Build Scratch and install it into /Applications here and on any Macs given
# as arguments (SSH hosts, e.g. `macmini`). Defaults to this Mac plus macmini.
#
#   scripts/deploy-app.sh              # this Mac + macmini
#   scripts/deploy-app.sh --local-only # just this Mac
#   scripts/deploy-app.sh macmini-lan  # this Mac + a specific host
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Scratch.app"
BUILT_APP="$REPO_ROOT/src-tauri/target/release/bundle/macos/$APP_NAME"
LOCAL_ARCH="$(uname -m)"

hosts=()
if [[ "${1:-}" == "--local-only" ]]; then
  shift
elif [[ $# -gt 0 ]]; then
  hosts=("$@")
else
  hosts=(macmini)
fi

echo "==> Building $APP_NAME ($LOCAL_ARCH)"
cd "$REPO_ROOT"
# The updater artifact needs a signing key we don't have; the .app itself is
# built before that step, so a failure there is not a failed build.
npm run tauri build -- --bundles app || true
[[ -d "$BUILT_APP" ]] || { echo "Build produced no $APP_NAME" >&2; exit 1; }

install_local() {
  echo "==> Installing locally"
  osascript -e 'tell application "Scratch" to quit' >/dev/null 2>&1 || true
  while pgrep -f "/Applications/$APP_NAME" >/dev/null; do sleep 1; done
  rm -rf "/Applications/$APP_NAME"
  cp -R "$BUILT_APP" /Applications/
  xattr -dr com.apple.quarantine "/Applications/$APP_NAME" 2>/dev/null || true
  open -a "/Applications/$APP_NAME"
}

install_remote() {
  local host="$1"
  echo "==> Installing on $host"

  local remote_arch
  remote_arch="$(ssh "$host" 'uname -m')"
  if [[ "$remote_arch" != "$LOCAL_ARCH" ]]; then
    echo "   skipped: $host is $remote_arch, this build is $LOCAL_ARCH" >&2
    return 1
  fi

  # Quit it there first, or rsync replaces a bundle that is still running.
  ssh "$host" "osascript -e 'tell application \"Scratch\" to quit' >/dev/null 2>&1 || true
    while pgrep -f '/Applications/$APP_NAME' >/dev/null; do sleep 1; done
    rm -rf '/Applications/$APP_NAME'"

  rsync -a --delete "$BUILT_APP" "$host:/Applications/"
  ssh "$host" "xattr -dr com.apple.quarantine '/Applications/$APP_NAME' 2>/dev/null || true"
}

install_local
failed=()
for host in ${hosts[@]+"${hosts[@]}"}; do
  install_remote "$host" || failed+=("$host")
done

version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  "/Applications/$APP_NAME/Contents/Info.plist")"
echo "==> Scratch $version installed on this Mac${hosts[*]+ and: ${hosts[*]}}"
if [[ -n "${failed[*]:-}" ]]; then
  echo "==> Failed: ${failed[*]}" >&2
  exit 1
fi
