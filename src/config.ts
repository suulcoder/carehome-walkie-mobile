/**
 * App configuration
 *
 * For local dev with simulator proxy:  ws://<laptop-ip>:9090
 * For local server direct:             ws://<laptop-ip>:8080/ws
 * For Render production:               wss://<service>.onrender.com/ws
 *
 * Change WS_URL before running `npx expo run:android`.
 */

export const WS_URL = "ws://10.0.2.2:8080/ws"; // Android emulator → host loopback

export const CHANNEL = "carehome-1";

export const AUDIO_SAMPLE_RATE = 16_000; // 16 kHz mono PCM16 — low bandwidth, works on old Androids

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const PING_INTERVAL_MS = 15_000;
export const PING_TIMEOUT_MS = 5_000;
