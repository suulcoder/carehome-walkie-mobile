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

/** Wire codec: opus (~9× smaller chunks) or legacy pcm16 base64. */
export type AudioCodec = "pcm" | "opus";

/** Active codec for outbound audio_chunk payloads. Override: EXPO_PUBLIC_AUDIO_CODEC=pcm */
export const AUDIO_CODEC: AudioCodec =
  process.env.EXPO_PUBLIC_AUDIO_CODEC === "pcm" ? "pcm" : "opus";

/** Opus VOIP bitrate — 24 kbps is excellent for speech at 16 kHz. */
export const OPUS_BITRATE = 24_000;

/** Opus 1.6 DRED recovery window (ms) — helps on lossy Wi‑Fi. */
export const OPUS_DRED_DURATION_MS = 100;

/** PCM samples per ~20 ms frame at 16 kHz (must match capture chunk size). */
export const OPUS_FRAME_SAMPLES = Math.floor(AUDIO_SAMPLE_RATE * (CHUNK_DURATION_MS / 1000));

/**
 * Adaptive jitter buffer (VoIP-style playout delay).
 * Good network → near minMs (~300 ms). High jitter → grows toward maxMs (~1.5 s).
 */
export const JITTER_MIN_PLAYOUT_MS = 300;
export const JITTER_MAX_PLAYOUT_MS = 10_000;
export const JITTER_MARGIN_FACTOR = 5;

/** If a sequence hole persists this long after the last chunk, fill with silence and continue. */
export const CHUNK_GAP_FILL_MS = 500;

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
