#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RUNTIME="$ROOT/runtime"
PID_FILE="$RUNTIME/server.pid"
URL_FILE="$RUNTIME/server.url"

if [ ! -f "$PID_FILE" ]; then
  printf "FixYourTrack is not running.\n"
  exit 0
fi

PID="$(tr -cd '0-9' < "$PID_FILE")"
EXECUTABLE="$(lsof -a -p "$PID" -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)"

case "$EXECUTABLE" in
  "$RUNTIME/fixyourtrack-server-arm64"|"$RUNTIME/fixyourtrack-server-x64")
    kill "$PID" 2>/dev/null || true
    attempt=0
    while kill -0 "$PID" 2>/dev/null && [ "$attempt" -lt 20 ]; do
      sleep 0.1
      attempt=$((attempt + 1))
    done
    printf "FixYourTrack stopped.\n"
    ;;
  *)
    printf "FixYourTrack is not running.\n"
    ;;
esac

rm -f "$PID_FILE" "$URL_FILE"
