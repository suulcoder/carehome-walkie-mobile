import AsyncStorage from "@react-native-async-storage/async-storage";

const RECEIVE_SINCE_KEY = "receive_since_v2";
const LEGACY_CURSOR_KEY = "receive_cursor_at";

export async function readReceiveSince(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(RECEIVE_SINCE_KEY);
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/** Persist the latest channel message we already know about (independent of inbox TTL). */
export async function advanceReceiveSince(completedAt: number): Promise<void> {
  if (!Number.isFinite(completedAt) || completedAt <= 0) return;
  const current = await readReceiveSince();
  if (completedAt <= current) return;
  await AsyncStorage.setItem(RECEIVE_SINCE_KEY, String(completedAt));
}

async function readLegacyReceiveSince(): Promise<number> {
  try {
    const legacy = await AsyncStorage.getItem(LEGACY_CURSOR_KEY);
    const value = legacy ? Number(legacy) : 0;
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/** Join cursor: max of persisted cursor, inbox-derived hints, and legacy storage. */
export async function getJoinReceiveSince(
  inboxCompletedAts: number[]
): Promise<number> {
  const persisted = await readReceiveSince();
  const legacy = await readLegacyReceiveSince();
  const fromInbox = inboxCompletedAts.length > 0 ? Math.max(...inboxCompletedAts) : 0;
  return Math.max(persisted, legacy, fromInbox);
}
