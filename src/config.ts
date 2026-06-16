/**
 * App configuration
 *
 * Default: production backend on Render.
 * For local development, change WS_URL — see README.md section "Local development".
 */

export const WS_URL = "wss://carehome-walkie-server.onrender.com/ws";

export const CHANNEL = "carehome-1";

export const AUDIO_SAMPLE_RATE = 16_000; // 16 kHz mono PCM16 — low bandwidth

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const PING_INTERVAL_MS = 15_000;
export const PING_TIMEOUT_MS = 5_000;
