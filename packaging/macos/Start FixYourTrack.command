#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RUNTIME="$ROOT/runtime"
PID_FILE="$RUNTIME/server.pid"
URL_FILE="$RUNTIME/server.url"
LOG_FILE="$RUNTIME/server.log"
VERSION_FILE="$ROOT/VERSION.txt"

expected_health() {
  [ -f "$VERSION_FILE" ] || return 1
  VERSION="$(sed -n 's/^Version: //p' "$VERSION_FILE" | head -n 1)"
  REVISION="$(sed -n 's/^Revision: //p' "$VERSION_FILE" | head -n 1)"
  [ -n "$VERSION" ] && [ -n "$REVISION" ] || return 1
  printf 'FixYourTrack/%s/%s' "$VERSION" "$REVISION"
}

running_url() {
  if [ ! -f "$URL_FILE" ]; then
    return 1
  fi

  URL="$(tr -d '\r\n' < "$URL_FILE")"
  [ -n "$URL" ] || return 1
  EXPECTED="$(expected_health)" || return 1
  [ "$(curl --silent --fail --max-time 2 "${URL}__health" 2>/dev/null || true)" = "$EXPECTED" ]
}

if running_url; then
  open "$URL"
  exit 0
fi

case "$(uname -m)" in
  arm64|aarch64)
    SERVER="$RUNTIME/fixyourtrack-server-arm64"
    ;;
  x86_64|amd64)
    SERVER="$RUNTIME/fixyourtrack-server-x64"
    ;;
  *)
    printf "Unsupported Mac processor: %s\n" "$(uname -m)"
    printf "Press Return to close.\n"
    read -r _
    exit 1
    ;;
esac

if [ ! -f "$ROOT/app/index.html" ] || [ ! -f "$SERVER" ]; then
  printf "This FixYourTrack folder is incomplete. Extract the complete ZIP archive.\n"
  printf "Press Return to close.\n"
  read -r _
  exit 1
fi

mkdir -p "$RUNTIME"
rm -f "$PID_FILE" "$URL_FILE" "$LOG_FILE"
chmod +x "$SERVER"
nohup "$SERVER" "$ROOT/app" "$RUNTIME" >>"$LOG_FILE" 2>&1 &

attempt=0
while [ "$attempt" -lt 40 ]; do
  sleep 0.25
  if running_url; then
    open "$URL"
    exit 0
  fi
  attempt=$((attempt + 1))
done

printf "The local FixYourTrack server did not become ready.\n"
printf "Opening the technical log.\n"
open -a TextEdit "$LOG_FILE" 2>/dev/null || true
printf "Press Return to close.\n"
read -r _
exit 1
