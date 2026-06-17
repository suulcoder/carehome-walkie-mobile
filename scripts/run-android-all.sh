#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Any adb serial: emulators (emulator-5554), physical devices (USB/Wi-Fi), etc.
serials=()
while IFS= read -r line; do
  serials+=("$line")
done < <(adb devices | awk '/\tdevice$/{print $1}')

if [ "${#serials[@]}" -eq 0 ]; then
  echo "No Android devices or emulators connected."
  echo "Run: adb devices"
  exit 1
fi

PACKAGE="$(node -p "require('./app.json').expo.android.package")"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
LAUNCH_ACTIVITY="${PACKAGE}/.MainActivity"
METRO_PORT="${EXPO_METRO_PORT:-8081}"
DEVICE_READY_TIMEOUT="${ANDROID_DEVICE_READY_TIMEOUT:-120}"

start_metro_if_needed() {
  if lsof -nP -iTCP:"$METRO_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Metro already running on :$METRO_PORT"
    return 0
  fi

  echo "Starting Metro on :$METRO_PORT..."
  EXPO_DEV_SERVER_LISTEN_ADDRESS=0.0.0.0 npx expo start --dev-client --port "$METRO_PORT" &
  for _ in $(seq 1 45); do
    if lsof -nP -iTCP:"$METRO_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Metro ready."
      return 0
    fi
    sleep 1
  done

  echo "Warning: Metro may not be ready yet on :$METRO_PORT"
}

package_manager_ready() {
  local serial="$1"
  adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | grep -q '^1$' \
    && adb -s "$serial" shell cmd package list packages -l >/dev/null 2>&1
}

wait_for_device_ready() {
  local serial="$1"
  echo "Waiting for $serial to be ready (up to ${DEVICE_READY_TIMEOUT}s)..."
  for _ in $(seq 1 "$DEVICE_READY_TIMEOUT"); do
    if package_manager_ready "$serial"; then
      echo "$serial is ready."
      return 0
    fi
    sleep 1
  done
  return 1
}

install_apk() {
  local serial="$1"
  local attempt

  for attempt in 1 2 3; do
    if adb -s "$serial" install -r --no-streaming "$APK"; then
      return 0
    fi
    echo "Install attempt $attempt failed on $serial, retrying in 5s..."
    sleep 5
  done

  return 1
}

if [ ! -f "$APK" ] || [ "${ANDROID_REBUILD:-}" = "1" ]; then
  echo "Building debug APK..."
  (cd android && ./gradlew assembleDebug)
else
  echo "Using existing APK (set ANDROID_REBUILD=1 to rebuild): $APK"
fi

if [ ! -f "$APK" ]; then
  echo "APK not found: $APK"
  exit 1
fi

start_metro_if_needed

echo "Installing on ${#serials[@]} device(s): ${serials[*]}"

failed=()
succeeded=()

for serial in "${serials[@]}"; do
  echo ""
  echo "==> $serial"

  if ! wait_for_device_ready "$serial"; then
    echo "ERROR: $serial is not responding (package manager down — common when RAM is low)."
    echo "       Fast fix (~1–2 min, no need to close Android Studio):"
    echo "         adb -s $serial reboot"
    echo "       Then re-run: npm run android:all"
    failed+=("$serial")
    continue
  fi

  adb -s "$serial" reverse "tcp:${METRO_PORT}" "tcp:${METRO_PORT}" || true

  if install_apk "$serial"; then
    adb -s "$serial" shell am start -n "$LAUNCH_ACTIVITY"
    succeeded+=("$serial")
  else
    echo "ERROR: Could not install on $serial."
    echo "       Try: adb -s $serial reboot   (then npm run android:all)"
    failed+=("$serial")
  fi
done

echo ""
if [ "${#succeeded[@]}" -gt 0 ]; then
  echo "Launched on: ${succeeded[*]}"
fi
if [ "${#failed[@]}" -gt 0 ]; then
  echo "Failed on: ${failed[*]}"
  exit 1
fi

echo "Done."
