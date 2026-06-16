/**
 * App configuration
 *
 * WS_URL options:
 *   Android emulator → host:   ws://10.0.2.2:8080/ws     (default below)
 *   iOS Simulator → host:      ws://localhost:8080/ws
 *   Physical device (any OS):  ws://<your-laptop-ip>:8080/ws
 *   Via simulator proxy:       ws://<laptop-ip>:9090
 *   Render (production):       wss://carehome-walkie-server.onrender.com/ws
 *
 * Change WS_URL to match your environment before running.
 */

import { Platform } from "react-native";

// Automatically pick the right loopback address for emulator/simulator
export const WS_URL: string = (() => {
  if (Platform.OS === "android") {
    return "ws://10.0.2.2:8080/ws"; // Android emulator loopback to host
  }
  if (Platform.OS === "ios") {
    return "ws://localhost:8080/ws"; // iOS Simulator loopback to host
  }
  return "ws://localhost:8080/ws";
})();

export const CHANNEL = "carehome-1";

export const AUDIO_SAMPLE_RATE = 16_000; // 16 kHz mono PCM16 — low bandwidth

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const PING_INTERVAL_MS = 15_000;
export const PING_TIMEOUT_MS = 5_000;
