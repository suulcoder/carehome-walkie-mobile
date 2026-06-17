export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogCategory = "ptt" | "capture" | "playback" | "ws" | "app" | "metric";

export interface LogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  category: LogCategory;
  event: string;
  sessionId?: string;
  data?: Record<string, unknown>;
  message?: string;
}

export interface MetricCounters {
  pttSessionsStarted: number;
  pttSessionsSent: number;
  pttSessionsReceived: number;
  audioChunksSent: number;
  audioChunksReceived: number;
  playbackAttempts: number;
  playbackSuccess: number;
  playbackFailures: number;
  playbackSilentReceived: number;
  captureFailures: number;
  wsReconnects: number;
}

export interface SessionTrace {
  sessionId: string;
  role: "sender" | "receiver";
  peerName?: string;
  sampleRate?: number;
  chunksSent?: number;
  chunksReceived?: number;
  pcmBytes?: number;
  peakAmplitude?: number;
  durationMs?: number;
  playbackDurationSec?: number;
  status: "active" | "completed" | "failed";
  failureReason?: string;
  updatedAt: number;
}
