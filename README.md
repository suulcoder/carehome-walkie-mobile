# Carehome Walkie-Talkie — Mobile App

Push-to-talk walkie-talkie for caregivers, built with React Native (Expo) + TypeScript.
Works on **Android and iOS**.

**Backend repo**: [carehome-walkie-server](https://github.com/suulcoder/carehome-walkie-server)

---

## Quick start

```bash
git clone https://github.com/suulcoder/carehome-walkie-mobile
cd carehome-walkie-mobile
npm install
```

**Android**

```bash
npx expo prebuild          # one-time: generates android/
npx expo run:android
```

**iOS** (macOS required)

```bash
npx expo prebuild          # one-time: generates ios/
npx expo run:ios           # Simulator
npx expo run:ios --device  # physical iPhone/iPad
```

Open the app, enter your display name, and you are on the channel. Two devices (Android, iOS, or mixed) can talk to each other.

> **Important**: This app uses native audio (`expo-audio`) and requires a **dev build**. It does not work in Expo Go.

---

## Configuration

All runtime targets are controlled from **`.env.local`** (copy from [`.env.example`](./.env.example)). No code changes needed.

```bash
cp .env.example .env.local
```

Restart Metro after editing `.env.local`.

| Variable | Values | What it does |
|---|---|---|
| `EXPO_PUBLIC_WS_ENV` | `production` *(default)* | Connect to the deployed Render backend |
| | `local` | Connect to a relay server on your laptop (`:8080`) |
| | `network_simulator` | Connect through the resilience proxy on your laptop (`:9090`) |
| `EXPO_PUBLIC_DEV_MACHINE_HOST` | Your LAN IP, e.g. `192.168.1.42` | **Required on physical devices** when using `local` or `network_simulator`. Not needed on emulators/simulators. |
| `EXPO_PUBLIC_SHOW_DEBUG_TELEMETRY` | `true` | Show the in-app debug panel (dev builds only) |

### How URLs are resolved

`EXPO_PUBLIC_WS_ENV` picks the target; the host is chosen automatically per platform:

| `EXPO_PUBLIC_WS_ENV` | Resolved URL |
|---|---|
| `production` | `wss://carehome-walkie-server.onrender.com/ws` |
| `local` | `ws://<host>:8080/ws` |
| `network_simulator` | `ws://<host>:9090` |

| Runtime | `<host>` used |
|---|---|
| Android emulator | `10.0.2.2` (always) |
| iOS Simulator | `localhost` |
| Physical device | `EXPO_PUBLIC_DEV_MACHINE_HOST` |

Find your laptop IP: `ipconfig getifaddr en0` (macOS) or `hostname -I` (Linux).

### Examples

**Production** (default — no `.env.local` needed):

```bash
# nothing to configure; app connects to Render
```

**Local server on your laptop:**

```bash
# .env.local
EXPO_PUBLIC_WS_ENV=local
# only if using a physical device:
EXPO_PUBLIC_DEV_MACHINE_HOST=192.168.1.42
```

**Resilience testing through the network simulator:**

```bash
# .env.local
EXPO_PUBLIC_WS_ENV=network_simulator
# only if using a physical device:
EXPO_PUBLIC_DEV_MACHINE_HOST=192.168.1.42
```

To go back to production, delete the line or set `EXPO_PUBLIC_WS_ENV=production`.

---

## Backend (production)

The app connects by default to the deployed relay server on Render:

| | URL |
|---|---|
| WebSocket | `wss://carehome-walkie-server.onrender.com/ws` |
| Health check | `https://carehome-walkie-server.onrender.com/health` |

Verify the server is up:

```bash
curl https://carehome-walkie-server.onrender.com/health
# → {"status":"ok","ts":...}
```

> **Cold starts:** Render free tier sleeps after ~15 min idle. The first connection may take ~30s. The app shows "Connecting…" and reconnects automatically.

---

## Local development

Only needed if you run the relay server on your machine instead of Render.

### 1. Start the server

```bash
cd ../carehome-walkie-server/server
npm install && npm run dev
# → ws://localhost:8080/ws
```

### 2. Point the app at it

```bash
# .env.local
EXPO_PUBLIC_WS_ENV=local
```

On a physical device, also set `EXPO_PUBLIC_DEV_MACHINE_HOST` to your laptop's LAN IP (same Wi‑Fi).

### 3. Run the app

```bash
npx expo run:android
# or
npx expo run:ios
```

---

## Resilience testing

The resilience simulator runs on your laptop. It sits **between the app and the backend**, injecting bad network conditions.

### 1. Start the simulator

**Against production (Render):**

```bash
cd ../carehome-walkie-server/simulator
npm install
npm start -- \
  --target wss://carehome-walkie-server.onrender.com/ws \
  --listen 9090 \
  --drop-rate 0.1 \
  --latency 200
```

For harsher stress tests, increase drop rate and latency:

```bash
npm start -- --target wss://carehome-walkie-server.onrender.com/ws --listen 9090 --drop-rate 0.15 --latency 400 --bandwidth-kbps 48 --disconnect-every 20
```

For a local relay server instead of Render, use `--target ws://localhost:8080/ws`.

> **Tip:** `--drop-rate 0.2 --latency 500` is intentionally harsh (good for stress tests).
> Control messages (ping/pong/join) are never dropped by the proxy, but high drop rates
> still affect audio chunks. Start with `--drop-rate 0.05 --latency 150` and increase gradually.

### 2. Point the app at the proxy

```bash
# .env.local
EXPO_PUBLIC_WS_ENV=network_simulator
```

On a physical device, also set `EXPO_PUBLIC_DEV_MACHINE_HOST`. Restart Metro after saving.

### Manual test scenarios

Use two devices or emulators — one to transmit, one to listen. Check banner colour, queue count, and that audio is heard.

| # | Scenario | Extra proxy flags |
|---|---|---|
| 1 | Patchy Wi-Fi | `--drop-rate 0.2 --latency 500` |
| 2 | Short dropout | `--disconnect-every 10` |
| 3 | High latency | `--latency 800` |
| 4 | Total offline | Stop the proxy for 30s, then restart |
| 5 | Slow bandwidth | `--bandwidth-kbps 32 --latency 200` |
| 6 | Worst case combo | `--drop-rate 0.15 --latency 400 --bandwidth-kbps 48 --disconnect-every 20` |

### Automated tests (no phone required)

Uses a local server internally — does not hit Render.

```bash
cd ../carehome-walkie-server/simulator
npm run test:resilience
```

---

## Prerequisites

- Node 20+
- Expo CLI: `npm install -g expo-cli`
- EAS CLI (optional, for standalone builds): `npm install -g eas-cli`
- **Android**: Android Studio with an emulator or a physical device + Java 17+
- **iOS**: Xcode 15+ (macOS only) with a Simulator or a physical iPhone/iPad

---

## Build standalone binaries (optional, EAS free tier)

```bash
eas build -p android --profile preview   # Android APK
eas build -p ios --profile preview       # iOS Simulator build
eas build -p ios --profile production    # iOS IPA (App Store requires paid Apple Developer account)
```

---

## Architecture & design decisions

See [RESILIENCE.md](./RESILIENCE.md) for the resilience approach, UX decisions, and future improvements.
