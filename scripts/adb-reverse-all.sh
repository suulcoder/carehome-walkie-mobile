#!/usr/bin/env bash
set -euo pipefail

METRO_PORT="${EXPO_METRO_PORT:-8081}"

serials=()
while IFS= read -r line; do
  serials+=("$line")
done < <(adb devices | awk '/\tdevice$/{print $1}')

if [ "${#serials[@]}" -eq 0 ]; then
  echo "No Android devices or emulators connected."
  exit 1
fi

for serial in "${serials[@]}"; do
  echo "adb reverse tcp:${METRO_PORT} tcp:${METRO_PORT}  ($serial)"
  adb -s "$serial" reverse "tcp:${METRO_PORT}" "tcp:${METRO_PORT}"
done
