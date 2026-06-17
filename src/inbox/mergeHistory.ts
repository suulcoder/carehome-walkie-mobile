import { base64ToBytes, pcmDurationMs, PcmChunk } from "../audio/pcmUtils";
import { AUDIO_SAMPLE_RATE } from "../config";
import { INBOX_MAX_MESSAGES, isWithinRecentWindow, ServerHistoryEntry, StoredMessage } from "./types";

function estimateDurationMs(chunks: PcmChunk[], sampleRate: number): number {
  const totalBytes = chunks.reduce((sum, chunk) => sum + base64ToBytes(chunk.pcmBase64).length, 0);
  return pcmDurationMs(totalBytes, sampleRate);
}

function serverEntryToChunks(entry: ServerHistoryEntry): PcmChunk[] {
  return [...entry.chunks].sort((a, b) => a.seq - b.seq);
}

/**
 * Merge server channel history with local inbox.
 * Server entries win for audio/metadata; local wins for playedAt / replay / outbound flags.
 * Local-only rows (e.g. queued outbound not yet on server) are kept.
 */
export function mergeInboxWithServer(
  local: StoredMessage[],
  server: ServerHistoryEntry[],
  selfName?: string
): StoredMessage[] {
  const merged = new Map<string, StoredMessage>();
  const serverIds = new Set(server.map((entry) => entry.sessionId));
  const selfKey = selfName?.trim().toLowerCase();

  for (const entry of server) {
    if (!isWithinRecentWindow(entry.completedAt)) continue;
    const existing = local.find((m) => m.sessionId === entry.sessionId);
    const chunks = serverEntryToChunks(entry);
    const sampleRate = entry.sampleRate ?? AUDIO_SAMPLE_RATE;
    const chunkCount = entry.chunkCount ?? chunks.length;
    const fromSelf = selfKey != null && entry.fromName.trim().toLowerCase() === selfKey;

    merged.set(entry.sessionId, {
      sessionId: entry.sessionId,
      fromId: entry.fromId,
      fromName: entry.fromName,
      isOutbound: existing?.isOutbound ?? fromSelf,
      completedAt: entry.completedAt,
      savedAt: existing?.savedAt ?? Date.now(),
      sampleRate,
      chunkCount,
      chunks,
      durationMs: existing?.durationMs ?? estimateDurationMs(chunks, sampleRate),
      playedAt: existing?.playedAt ?? null,
      lastReplayedAt: existing?.lastReplayedAt ?? null,
    });
  }

  for (const message of local) {
    if (serverIds.has(message.sessionId)) continue;
    if (!isWithinRecentWindow(message.completedAt)) continue;
    merged.set(message.sessionId, message);
  }

  return [...merged.values()]
    .sort((a, b) => b.completedAt - a.completedAt)
    .slice(0, INBOX_MAX_MESSAGES);
}
