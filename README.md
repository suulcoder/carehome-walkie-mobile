# Carehome Walkie-Talkie — Mobile App

Push-to-talk walkie-talkie for caregivers, built with React Native (Expo) + TypeScript.

**Backend repo**: [carehome-walkie-server](https://github.com/suulcoder/carehome-walkie-server)

---

## Prerequisites

- Node 20+
- [Android Studio](https://developer.android.com/studio) with an emulator **or** a physical Android device
- Java 17+ (required by Android build toolchain)
- Expo CLI: `npm install -g expo-cli`
- EAS CLI (optional, for APK builds): `npm install -g eas-cli`

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

Edit `src/config.ts` and set `WS_URL` to point at your backend:

```typescript
// Android emulator → host loopback (default)
export const WS_URL = "ws://10.0.2.2:8080/ws";

// Physical device on same Wi-Fi as laptop running the server
// export const WS_URL = "ws://192.168.1.42:8080/ws";

// Through the resilience simulator proxy
// export const WS_URL = "ws://192.168.1.42:9090";

// Render (production)
// export const WS_URL = "wss://carehome-walkie-server.onrender.com/ws";
```

---

## 3. Run on Android

```bash
npx expo prebuild          # generates android/ native project (one-time)
npx expo run:android       # builds and launches on emulator/device
```

For a physical device, enable USB debugging and connect via USB, then run the same command.

---

## 4. Build a standalone APK (optional)

```bash
eas build -p android --profile preview
```

This uses EAS free tier (no credit card required). Download the APK from the EAS dashboard and install on any Android device.

---

## 5. Full local stack (all components)

Start each in a separate terminal:

```bash
# Terminal 1 — relay server
cd ../carehome-walkie-server/server
npm install && npm run dev

# Terminal 2 — resilience simulator proxy (optional)
cd ../carehome-walkie-server/simulator
npm install && npm start -- --target ws://localhost:8080/ws --listen 9090

# Terminal 3 — mobile app
npx expo run:android
```

When using the proxy, set `WS_URL = "ws://10.0.2.2:9090"` (emulator) or `"ws://<laptop-ip>:9090"` (device).

---

## 6. Resilience test scenarios (manual, with mobile app)

Start the server, then start the simulator proxy with different flags for each scenario. Use two devices or emulators — one to transmit, one to listen.

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

## 7. Automated resilience tests (headless)

```bash
cd ../carehome-walkie-server/simulator
npm run test:resilience
```

Runs all 6 scenarios with fake clients and prints pass/fail. No phone required.

---

## Architecture & design decisions

See [RESILIENCE.md](./RESILIENCE.md) for a full write-up of the resilience approach, UX decisions, and what would be improved with more time.
