/**
 * App configuration — tuneable constants live here.
 *
 * Backend target: set WS_ENV below, or EXPO_PUBLIC_WS_ENV in .env.local
 * Physical device on Wi‑Fi: EXPO_PUBLIC_DEV_MACHINE_HOST in .env.local (see .env.example)
 */

import { parseWsEnvironment, resolveWsUrl, type WsEnvironment } from "./resolveWsUrl";

export type { WsEnvironment };

/** Active backend target. Override via EXPO_PUBLIC_WS_ENV without editing code. */
export const WS_ENV: WsEnvironment = parseWsEnvironment();

/** Resolved WebSocket URL for the current platform and WS_ENV. */
export const WS_URL = resolveWsUrl(WS_ENV);

export const CHANNEL = "carehome-1";

export const AUDIO_SAMPLE_RATE = 16_000; // 16 kHz mono PCM16 — low bandwidth

/** ~20 ms per outbound/inbound audio chunk at 16 kHz. */
export const CHUNK_DURATION_MS = 20;

/**
 * Adaptive jitter buffer (VoIP-style playout delay).
 * Good network → near minMs (~300 ms). High jitter → grows toward maxMs (~1.5 s).
 */
export const JITTER_MIN_PLAYOUT_MS = 500;
export const JITTER_MAX_PLAYOUT_MS = 10_000;
export const JITTER_MARGIN_FACTOR = 8;

/** After ptt_end, if no new chunk arrives for this long, play what was received. Resets on each chunk. */
export const CHUNK_ARRIVAL_GRACE_MS = 5_000;

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const PING_INTERVAL_MS = 15_000;
export const PING_TIMEOUT_MS = 5_000;

/**
 * In-app telemetry panel — development only, opt-in.
 * Set EXPO_PUBLIC_SHOW_DEBUG_TELEMETRY=true in .env.local while debugging.
 */
export const SHOW_DEBUG_TELEMETRY =
  __DEV__ && process.env.EXPO_PUBLIC_SHOW_DEBUG_TELEMETRY === "true";

export const INBOX_MAX_MESSAGES = 10;
/** Messages older than this are dropped from Recent Messages and history sync. */
export const INBOX_MAX_AGE_MS = 10 * 60 * 1000;
