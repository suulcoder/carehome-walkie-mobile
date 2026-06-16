# Carehome Walkie-Talkie — Mobile App

Push-to-talk walkie-talkie for caregivers, built with React Native (Expo) + TypeScript.
Works on **Android and iOS**.

**Backend repo**: [carehome-walkie-server](https://github.com/suulcoder/carehome-walkie-server)

---

## Prerequisites

- Node 20+
- Expo CLI: `npm install -g expo-cli`
- EAS CLI (optional, for standalone builds): `npm install -g eas-cli`
- **Android**: Android Studio with an emulator or a physical device + Java 17+
- **iOS**: Xcode 15+ (macOS only) with a Simulator or a physical iPhone/iPad

> **Important**: This app uses native audio streaming and requires a **dev build**. It does not work in Expo Go.

---

## 1. Clone and install

```bash
git clone https://github.com/suulcoder/carehome-walkie-mobile
cd carehome-walkie-mobile
npm install
```

---

## 2. Configure the WebSocket URL

`src/config.ts` automatically picks the right loopback address for each emulator/simulator. For physical devices or Render, override `WS_URL`:

```typescript
// Android emulator → host loopback (auto-detected)
"ws://10.0.2.2:8080/ws"

// iOS Simulator → host loopback (auto-detected)
"ws://localhost:8080/ws"

// Physical device (Android or iOS) on same Wi-Fi as laptop running the server
"ws://192.168.1.42:8080/ws"

// Through the resilience simulator proxy
"ws://192.168.1.42:9090"

// Render (production) — works on both platforms
"wss://carehome-walkie-server.onrender.com/ws"
```

For emulators/simulators the URL is set automatically. For physical devices, edit `src/config.ts` and replace with your laptop's local IP.

---

## 3. Run on Android

```bash
npx expo prebuild                # generates android/ native project (one-time)
npx expo run:android             # builds and launches on emulator/device
```

For a physical Android device: enable USB debugging, connect via USB, then run the same command.

---

## 4. Run on iOS

```bash
npx expo prebuild                # generates ios/ native project (one-time, macOS required)
npx expo run:ios                 # builds and launches in iOS Simulator
npx expo run:ios --device        # builds and launches on a connected iPhone
```

Xcode and an Apple Developer account (free tier is enough for simulator builds) are required.

---

## 5. Build standalone binaries (optional, EAS free tier)

```bash
# Android APK
eas build -p android --profile preview

# iOS Simulator build
eas build -p ios --profile preview

# Production iOS IPA (requires paid Apple Developer account for App Store)
eas build -p ios --profile production
```

---

## 6. Full local stack (all components)

Start each in a separate terminal:

```bash
# Terminal 1 — relay server
cd ../carehome-walkie-server/server
npm install && npm run dev

# Terminal 2 — resilience simulator proxy (optional)
cd ../carehome-walkie-server/simulator
npm install && npm start -- --target ws://localhost:8080/ws --listen 9090

# Terminal 3 — mobile app (pick your platform)
npx expo run:android
# or
npx expo run:ios
```

When using the proxy:
- Android emulator: `WS_URL = "ws://10.0.2.2:9090"`
- iOS Simulator: `WS_URL = "ws://localhost:9090"`
- Physical device: `WS_URL = "ws://<laptop-ip>:9090"`

---

## 7. Resilience test scenarios (manual, with mobile app)

Start the server, then start the simulator proxy with different flags for each scenario.
Use two devices or emulators (mix of Android/iOS is fine) — one to transmit, one to listen.

For each scenario, observe: banner colour, queue indicator count, whether the listening device hears the message.

| # | Scenario | Proxy command | What to check |
|---|---|---|---|
| 1 | **Patchy Wi-Fi** | `--drop-rate 0.2 --latency 500` | Banner goes amber; audio still arrives (may be choppy); no silent loss |
| 2 | **Short dropout** | `--disconnect-every 10` | Banner flickers amber → green every 10s; queued messages flush on reconnect |
| 3 | **High latency** | `--latency 800` | Speech plays with ~800ms delay; banner stays green |
| 4 | **Total offline** | Stop the proxy or server for 30s | Banner goes red; queue count grows; messages send when proxy restarts |
| 5 | **Slow bandwidth** | `--bandwidth-kbps 32 --latency 200` | Audio delivers but delayed; queue count may grow then drain |
| 6 | **Worst case combo** | `--drop-rate 0.15 --latency 400 --bandwidth-kbps 48 --disconnect-every 20` | App stays usable; no message silently lost |

Full proxy command template:
```bash
cd ../carehome-walkie-server/simulator
npm start -- \
  --target ws://localhost:8080/ws \
  --listen 9090 \
  --latency 300 \
  --drop-rate 0.1 \
  --disconnect-every 15 \
  --bandwidth-kbps 64
```

---

## 8. Automated resilience tests (headless, no phone required)

```bash
cd ../carehome-walkie-server/simulator
npm run test:resilience
```

Runs all 6 scenarios with fake clients and prints pass/fail.

---

## Architecture & design decisions

See [RESILIENCE.md](./RESILIENCE.md) for a full write-up of the resilience approach, UX decisions, and what would be improved with more time.
