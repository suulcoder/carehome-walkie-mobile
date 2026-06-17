# Carehome Walkie-Talkie — Mobile App

Push-to-talk walkie-talkie for caregivers, built with React Native (Expo) + TypeScript.
Works on **Android and iOS**.

**Backend repo**: [carehome-walkie-server](https://github.com/suulcoder/carehome-walkie-server)

---

## Backend (production)

The app connects by default to the deployed relay server on Render:

| | URL |
|---|---|
| WebSocket | `wss://carehome-walkie-server.onrender.com/ws` |
| Health check | `https://carehome-walkie-server.onrender.com/health` |

Configured in [`src/config.ts`](./src/config.ts) (`WS_ENV = "production"`). No changes needed to run against production.

Verify the server is up:

```bash
curl https://carehome-walkie-server.onrender.com/health
# → {"status":"ok","ts":...}
```

> **Cold starts:** Render free tier sleeps after ~15 min idle. The first connection may take ~30s. The app shows "Connecting…" and reconnects automatically.

---

## Prerequisites

- Node 20+
- Expo CLI: `npm install -g expo-cli`
- EAS CLI (optional, for standalone builds): `npm install -g eas-cli`
- **Android**: Android Studio with an emulator or a physical device + Java 17+
- **iOS**: Xcode 15+ (macOS only) with a Simulator or a physical iPhone/iPad

> **Important**: This app uses native audio (`expo-audio`) and requires a **dev build**. It does not work in Expo Go.

---

## 1. Clone and install

```bash
git clone https://github.com/suulcoder/carehome-walkie-mobile
cd carehome-walkie-mobile
npm install
```

---

## 2. Run the app

### Android

```bash
npx expo prebuild          # one-time: generates android/ native project
npx expo run:android       # builds and launches on emulator/device
```

For a physical device: enable USB debugging, connect via USB, then run the same command.

### iOS

```bash
npx expo prebuild          # one-time: generates ios/ native project (macOS required)
npx expo run:ios           # iOS Simulator
npx expo run:ios --device  # connected iPhone/iPad
```

Open the app, enter your display name, and you are on the channel. Two devices (Android, iOS, or mixed) can talk to each other through the Render backend.

---

## 3. Build standalone binaries (optional, EAS free tier)

```bash
eas build -p android --profile preview   # Android APK
eas build -p ios --profile preview       # iOS Simulator build
eas build -p ios --profile production    # iOS IPA (App Store requires paid Apple Developer account)
```

---

## Local development

Only needed if you run the relay server on your machine instead of Render.

### Step 1 — Start the server locally

```bash
cd ../carehome-walkie-server/server
npm install && npm run dev
# → ws://localhost:8080/ws
```

### Step 2 — Point the app at localhost

In [`src/config/resolveWsUrl.ts`](./src/config/resolveWsUrl.ts), set:

```typescript
export const DEFAULT_WS_ENV: WsEnvironment = "local";
```

Or in `.env.local` (copy from [`.env.example`](./.env.example)):

```bash
EXPO_PUBLIC_WS_ENV=local
```

The URL is resolved automatically:

| Runtime | Host used |
|---|---|
| Android emulator | `10.0.2.2` |
| iOS Simulator | `localhost` |
| Physical device | `EXPO_PUBLIC_DEV_MACHINE_HOST` in `.env.local` |

Physical device example (same Wi‑Fi as your laptop):

```bash
# .env.local — not committed
EXPO_PUBLIC_DEV_MACHINE_HOST=192.168.1.42
```

Find your laptop IP: `ipconfig getifaddr en0` (macOS) or `hostname -I` (Linux).

### Step 3 — Run the app

```bash
npx expo run:android
# or
npx expo run:ios
```

When done testing locally, set `DEFAULT_WS_ENV` back to `"production"` (or remove `EXPO_PUBLIC_WS_ENV` from `.env.local`).

---

## Resilience testing

The resilience simulator runs on your laptop. It sits **between the app and the backend**, injecting bad network conditions.

### Against production (Render)

```bash
cd ../carehome-walkie-server/simulator
npm install
npm start -- \
  --target wss://carehome-walkie-server.onrender.com/ws \
  --listen 9090 \
  --drop-rate 0.1 \
  --latency 200
```

> **Tip:** `--drop-rate 0.2 --latency 500` is intentionally harsh (good for stress tests).
> Control messages (ping/pong/join) are never dropped by the proxy, but high drop rates
> still affect audio chunks. Start with `--drop-rate 0.05 --latency 150` and increase gradually.

Then point the app at the proxy — no manual URLs per platform:

```typescript
// src/config/resolveWsUrl.ts
export const DEFAULT_WS_ENV: WsEnvironment = "network_simulator";
```

Or in `.env.local`:

```bash
EXPO_PUBLIC_WS_ENV=network_simulator
```

Host resolution is automatic (emulator → `10.0.2.2`, iOS Simulator → `localhost`, physical device → `EXPO_PUBLIC_DEV_MACHINE_HOST`). Restart Metro after changing env files.

### Against local server

```bash
npm start -- --target ws://localhost:8080/ws --listen 9090 --drop-rate 0.2 --latency 500
```

Use the same `network_simulator` config as above (`DEFAULT_WS_ENV` or `EXPO_PUBLIC_WS_ENV=network_simulator`).

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

## Architecture & design decisions

See [RESILIENCE.md](./RESILIENCE.md) for the resilience approach, UX decisions, and future improvements.
