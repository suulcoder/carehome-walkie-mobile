import AsyncStorage from "@react-native-async-storage/async-storage";
import { INBOX_MAX_MESSAGES } from "../../config";
import { PcmChunk } from "../../services/audio/pcmUtils";
import {
  InboxMessageDraft,
  isWithinRecentWindow,
  ServerHistoryEntry,
  StoredMessage,
} from "./types";
import { mergeInboxWithServer } from "./mergeHistory";
import { decodeWireChunksToPcm } from "../../services/audio/opusCodec";
import {
  advanceReceiveSince,
  getJoinReceiveSince,
} from "./receiveCursor";

const INBOX_STORAGE_KEY = "message_inbox_v1";

/** Sorts inbox messages by completion time, newest first. */
function sortNewestFirst(messages: StoredMessage[]): StoredMessage[] {
  return [...messages].sort((a, b) => b.completedAt - a.completedAt);
}

/** Drops expired and excess messages according to inbox age and count limits. */
function trimInbox(messages: StoredMessage[], now = Date.now()): StoredMessage[] {
  return sortNewestFirst(messages)
    .filter((message) => isWithinRecentWindow(message.completedAt, now))
    .slice(0, INBOX_MAX_MESSAGES);
}

/** Loads the inbox from AsyncStorage and re-saves it if trimming removed stale entries. */
export async function loadInbox(): Promise<StoredMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(INBOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredMessage[];
    if (!Array.isArray(parsed)) return [];
    const trimmed = trimInbox(parsed);
    if (trimmed.length !== parsed.length) {
      await AsyncStorage.setItem(INBOX_STORAGE_KEY, JSON.stringify(trimmed));
    }
    return trimmed;
  } catch {
    return [];
  }
}

/** Trims and persists the full inbox list to AsyncStorage. */
async function saveInbox(messages: StoredMessage[]): Promise<StoredMessage[]> {
  const trimmed = trimInbox(messages);
  await AsyncStorage.setItem(INBOX_STORAGE_KEY, JSON.stringify(trimmed));
  return trimmed;
}

/** Inserts or updates a message by sessionId while preserving playback metadata. */
export async function upsertInboxMessage(draft: InboxMessageDraft): Promise<StoredMessage[]> {
  const inbox = await loadInbox();
  const existing = inbox.find((m) => m.sessionId === draft.sessionId);
  const next: StoredMessage = {
    sessionId: draft.sessionId,
    fromId: draft.fromId,
    fromName: draft.fromName,
    isOutbound: existing?.isOutbound,
    completedAt: draft.completedAt,
    savedAt: existing?.savedAt ?? Date.now(),
    sampleRate: draft.sampleRate,
    chunkCount: draft.chunkCount,
    chunks: draft.chunks,
    durationMs: draft.durationMs,
    playedAt: existing?.playedAt ?? null,
    lastReplayedAt: existing?.lastReplayedAt ?? null,
  };

  const without = inbox.filter((m) => m.sessionId !== draft.sessionId);
  return saveInbox([next, ...without]);
}

/** Records the first time a message was heard and advances the receive cursor. */
export async function markInboxMessagePlayed(
  sessionId: string,
  playedAt: number
): Promise<StoredMessage[]> {
  const inbox = await loadInbox();
  let completedAt: number | null = null;
  const updated = inbox.map((message) => {
    if (message.sessionId !== sessionId) return message;
    completedAt = message.completedAt;
    return {
      ...message,
      playedAt: message.playedAt ?? playedAt,
    };
  });
  const saved = await saveInbox(updated);
  if (completedAt != null) {
    await advanceReceiveSince(completedAt);
  }
  return saved;
}

/** Updates lastReplayedAt when the user manually replays a message from history. */
export async function markInboxMessageReplayed(sessionId: string): Promise<StoredMessage[]> {
  const inbox = await loadInbox();
  const updated = inbox.map((message) =>
    message.sessionId === sessionId
      ? { ...message, lastReplayedAt: Date.now() }
      : message
  );
  return saveInbox(updated);
}

/** Returns the timestamp to send on join so the server skips already-known messages. */
export async function getReceiveSince(): Promise<number> {
  const inbox = await loadInbox();
  const knownCompletedAts = inbox
    .filter((m) => m.isOutbound || m.playedAt != null)
    .map((m) => m.completedAt);
  return getJoinReceiveSince(knownCompletedAts);
}

/** Advances the receive cursor after syncing messages the device already has. */
export async function acknowledgeChannelMessages(completedAts: number[]): Promise<void> {
  if (completedAts.length === 0) return;
  await advanceReceiveSince(Math.max(...completedAts));
}

/** Merges server history into local storage, saves the result, and acknowledges synced entries. */
export async function syncInboxFromServer(
  serverMessages: ServerHistoryEntry[],
  selfName?: string
): Promise<StoredMessage[]> {
  const decoded: ServerHistoryEntry[] = await Promise.all(
    serverMessages.map(async (entry) => {
      if (entry.codec !== "opus") return entry;
      return {
        ...entry,
        chunks: await decodeWireChunksToPcm(entry.sessionId, entry.chunks, entry.codec),
      };
    })
  );
  const local = await loadInbox();
  const merged = mergeInboxWithServer(local, decoded, selfName);
  const saved = await saveInbox(merged);
  if (serverMessages.length > 0) {
    await acknowledgeChannelMessages(serverMessages.map((entry) => entry.completedAt));
  }
  return saved;
}

export interface OutboundMessageDraft {
  sessionId: string;
  senderName: string;
  sampleRate: number;
  chunkCount: number;
  chunks: PcmChunk[];
  durationMs: number;
}

/** Saves a message sent from this device and marks it as outbound and already played. */
export async function recordOutboundMessage(draft: OutboundMessageDraft): Promise<StoredMessage[]> {
  const now = Date.now();
  return upsertInboxMessage({
    sessionId: draft.sessionId,
    fromId: "self",
    fromName: draft.senderName,
    completedAt: now,
    sampleRate: draft.sampleRate,
    chunkCount: draft.chunkCount,
    chunks: draft.chunks,
    durationMs: draft.durationMs,
  }).then(async (messages) => {
    const updated = messages.map((message) =>
      message.sessionId === draft.sessionId
        ? { ...message, isOutbound: true, playedAt: message.playedAt ?? now }
        : message
    );
    await saveInbox(updated);
    await advanceReceiveSince(now);
    return updated;
  });
}
