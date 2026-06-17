/**
 * Outbound queue — persists unsent PTT sessions to AsyncStorage so they
 * survive app backgrounding and reconnects.
 *
 * Each session is stored as: QUEUE_KEY_PREFIX + sessionId → JSON
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const QUEUE_KEY_PREFIX = "ptt_queue_";

export interface QueuedChunk {
  seq: number;
  pcmBase64: string;
}

export interface QueuedSession {
  sessionId: string;
  chunks: QueuedChunk[];
  ended: boolean;
  sampleRate?: number;
  chunkCount?: number;
}

async function persistSession(session: QueuedSession): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY_PREFIX + session.sessionId, JSON.stringify(session));
  } catch {
    // Non-fatal — in-memory send will still be attempted
  }
}

export async function enqueueChunk(session: QueuedSession): Promise<void> {
  await persistSession(session);
}

export async function markSessionEnded(session: QueuedSession): Promise<void> {
  session.ended = true;
  await persistSession(session);
}

export async function removeSession(sessionId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(QUEUE_KEY_PREFIX + sessionId);
  } catch {}
}

export async function getPendingSessions(): Promise<QueuedSession[]> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const queueKeys = keys.filter((k) => k.startsWith(QUEUE_KEY_PREFIX));
    if (queueKeys.length === 0) return [];
    const pairs = await AsyncStorage.multiGet(queueKeys);
    return pairs
      .map(([, v]) => {
        try {
          return v ? (JSON.parse(v) as QueuedSession) : null;
        } catch {
          return null;
        }
      })
      .filter((s): s is QueuedSession => s !== null);
  } catch {
    return [];
  }
}
