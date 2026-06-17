import { PcmChunk } from "../audio/pcmUtils";

export const INBOX_MAX_MESSAGES = 10;
/** Messages older than this are dropped from Recent Messages and history sync. */
export const INBOX_MAX_AGE_MS = 10 * 60 * 1000;

export function isWithinRecentWindow(completedAt: number, now = Date.now()): boolean {
  return now - completedAt <= INBOX_MAX_AGE_MS;
}

export interface ServerHistoryEntry {
  sessionId: string;
  fromId: string;
  fromName: string;
  completedAt: number;
  sampleRate: number;
  chunkCount: number;
  chunks: PcmChunk[];
  durationMs: number;
}

export interface StoredMessage {
  sessionId: string;
  fromId: string;
  fromName: string;
  /** True when this device sent the message (shown as "You" in history). */
  isOutbound?: boolean;
  completedAt: number;
  savedAt: number;
  sampleRate: number;
  chunkCount: number;
  chunks: PcmChunk[];
  durationMs: number;
  /** First time this device played the message (null = not yet heard). */
  playedAt: number | null;
  /** Last manual replay from history UI. */
  lastReplayedAt: number | null;
}

export interface InboxMessageDraft {
  sessionId: string;
  fromId: string;
  fromName: string;
  completedAt: number;
  sampleRate: number;
  chunkCount: number;
  chunks: PcmChunk[];
  durationMs: number;
}
