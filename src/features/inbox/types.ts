import { INBOX_MAX_AGE_MS } from "../../config";
import type { AudioCodec } from "../../config";
import { PcmChunk } from "../../services/audio/pcmUtils";

/** Returns true if a message completed within the configured recent-messages window. */
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
  /** Wire codec from server; decoded to PCM before persisting locally. */
  codec?: AudioCodec;
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
