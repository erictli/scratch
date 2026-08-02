#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="Scratch"
BUNDLE_ID="com.scratch.app"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI="$ROOT_DIR/node_modules/.bin/tauri"
TARGET_DIR="${CARGO_TARGET_DIR:-$(mktemp -d /private/tmp/scratch-target.XXXXXX)}"
APP_BUNDLE="$TARGET_DIR/release/bundle/macos/$APP_NAME.app"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/Scratch"
INSTALLED_APP_BUNDLES=(
  "/Applications/$APP_NAME.app"
  "$HOME/Applications/$APP_NAME.app"
)

case "$MODE" in
  run|--build-only|build-only|--debug|debug|--logs|logs|--telemetry|telemetry|--verify|verify)
    ;;
  *)
    echo "usage: $0 [run|--build-only|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac

cd "$ROOT_DIR"
env CARGO_TARGET_DIR="$TARGET_DIR" "$TAURI" build \
  --bundles app \
  --no-sign \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'

codesign --force --deep --sign - "$APP_BUNDLE"
codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"

stop_app_bundle() {
  local app_bundle="$1"
  pkill -f "$app_bundle/Contents/MacOS/Scratch" >/dev/null 2>&1 || true
}

stop_scratch_apps() {
  stop_app_bundle "$APP_BUNDLE"
  for app_bundle in "${INSTALLED_APP_BUNDLES[@]}"; do
    stop_app_bundle "$app_bundle"
  done
}

open_built_app() {
  stop_scratch_apps
  /usr/bin/open -n "$APP_BUNDLE"
}

case "$MODE" in
  --build-only|build-only)
    echo "$APP_BUNDLE"
    ;;
  run)
    open_built_app
    ;;
  --debug|debug)
    stop_scratch_apps
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_built_app
    /usr/bin/log stream --info --style compact --predicate 'process == "Scratch"'
    ;;
  --telemetry|telemetry)
    open_built_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_built_app
    for _ in {1..20}; do
      if pgrep -f "$APP_BINARY" >/dev/null; then
        exit 0
      fi
      sleep 0.25
    done
    echo "Scratch did not start from $APP_BUNDLE" >&2
    exit 1
    ;;
esac
