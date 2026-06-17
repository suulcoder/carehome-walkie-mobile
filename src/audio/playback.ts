/**
 * Audio playback using expo-audio (Expo SDK 56, iOS + Android).
 * Buffers all chunks until ptt_end, then plays one continuous WAV when complete.
 * If chunks are still missing after ptt_end and none arrive for CHUNK_ARRIVAL_GRACE_MS,
 * plays what arrived (no silence fill). Long messages keep buffering while chunks flow in.
 */

import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioPlayer,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import { AUDIO_SAMPLE_RATE, CHUNK_ARRIVAL_GRACE_MS } from "../config";
import { WALKIE_RECORDING_AUDIO_MODE } from "./capture";
import { telemetry } from "../observability";
import {
  markInboxMessagePlayed,
  markInboxMessageReplayed,
  upsertInboxMessage,
} from "../inbox/inboxRepository";
import { invalidateInbox } from "../inbox/queryClient";
import { StoredMessage } from "../inbox/types";
import {
  base64ToBytes,
  concatPcmChunks,
  measurePcmPeak,
  pcmDurationMs,
  pcmToWavBytes,
  PcmChunk,
} from "./pcmUtils";
import { isSameDisplayName } from "../network/peers";

export const SILENT_PEAK_THRESHOLD = 200;

const WALKIE_PLAYBACK_AUDIO_MODE = {
  allowsRecording: false,
  playsInSilentMode: true,
  interruptionMode: "doNotMix" as const,
  shouldRouteThroughEarpiece: false,
};

export type PlaybackWarning =
  | { type: "received_silent"; sessionId: string; peakAmplitude: number }
  | { type: "sample_rate_unknown"; sessionId: string; inferredRate: number }
  | { type: "chunks_incomplete"; sessionId: string; received: number; expected: number };

interface ReceiveSession {
  chunks: PcmChunk[];
  expectedCount?: number;
  sampleRate: number;
  fromId: string;
  fromName: string;
  endReceived: boolean;
  endReceivedAt?: number;
  completedAt?: number;
  graceTimer?: ReturnType<typeof setTimeout>;
  playing: boolean;
}

type PlayQueueItem =
  | { kind: "live"; sessionId: string; allowPartial: boolean }
  | { kind: "stored"; message: StoredMessage };

const sessions = new Map<string, ReceiveSession>();
const pendingPlayQueue: PlayQueueItem[] = [];
let drainPromise: Promise<void> | null = null;
let activePlayer: AudioPlayer | null = null;
let warningHandler: ((warning: PlaybackWarning) => void) | null = null;
let selfDisplayName: string | null = null;
const ownedSessionIds = new Set<string>();

export function setSelfDisplayName(name: string | null): void {
  selfDisplayName = name;
}

/** Sessions this device transmitted — never play them back from the network. */
export function registerOwnedSession(sessionId: string): void {
  ownedSessionIds.add(sessionId);
}

function shouldIgnoreIncoming(sessionId: string, fromName?: string): boolean {
  if (ownedSessionIds.has(sessionId)) return true;
  if (fromName && selfDisplayName && isSameDisplayName(fromName, selfDisplayName)) {
    return true;
  }
  return false;
}

export function setPlaybackWarningHandler(
  handler: ((warning: PlaybackWarning) => void) | null
): void {
  warningHandler = handler;
}

function emitWarning(warning: PlaybackWarning): void {
  warningHandler?.(warning);
}

function getSession(sessionId: string): ReceiveSession {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      chunks: [],
      sampleRate: AUDIO_SAMPLE_RATE,
      fromId: "unknown",
      fromName: "Unknown",
      endReceived: false,
      playing: false,
    };
    sessions.set(sessionId, session);
  }
  return session;
}

function clearSessionTimers(session: ReceiveSession): void {
  if (session.graceTimer) {
    clearTimeout(session.graceTimer);
    session.graceTimer = undefined;
  }
}

function uniqueChunkCount(session: ReceiveSession): number {
  return new Set(session.chunks.map((c) => c.seq)).size;
}

function hasAllExpectedChunks(session: ReceiveSession): boolean {
  if (session.expectedCount === undefined) {
    return false;
  }
  return uniqueChunkCount(session) >= session.expectedCount;
}

function schedulePlaybackAttempt(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session || session.playing) return;

  if (hasAllExpectedChunks(session)) {
    clearSessionTimers(session);
    enqueuePlayback(sessionId);
    return;
  }

  if (!session.endReceived) return;

  clearSessionTimers(session);
  session.graceTimer = setTimeout(() => {
    session.graceTimer = undefined;
    if (session.playing || hasAllExpectedChunks(session)) return;
    if (session.chunks.length === 0) return;

    telemetry.warn("playback", "chunk_grace_timeout", {
      sessionId,
      data: {
        expected: session.expectedCount,
        received: uniqueChunkCount(session),
        idleMs: CHUNK_ARRIVAL_GRACE_MS,
      },
      message: "No new chunks since grace window — playing received chunks only",
    });
    enqueuePlayback(sessionId, true);
  }, CHUNK_ARRIVAL_GRACE_MS);
}

function enqueuePlayback(sessionId: string, allowPartial = false): void {
  const existing = pendingPlayQueue.find(
    (item) => item.kind === "live" && item.sessionId === sessionId
  );
  if (existing && existing.kind === "live") {
    if (allowPartial) existing.allowPartial = true;
  } else {
    pendingPlayQueue.push({ kind: "live", sessionId, allowPartial });
  }
  startDrainPlaybackQueue();
}

function startDrainPlaybackQueue(): void {
  if (!drainPromise) {
    drainPromise = drainPlaybackQueue().finally(() => {
      drainPromise = null;
    });
  }
}

export function replayStoredMessage(message: StoredMessage): void {
  const alreadyQueued = pendingPlayQueue.some(
    (item) => item.kind === "stored" && item.message.sessionId === message.sessionId
  );
  if (!alreadyQueued) {
    pendingPlayQueue.push({ kind: "stored", message });
  }
  startDrainPlaybackQueue();
}

async function drainPlaybackQueue(): Promise<void> {
  while (pendingPlayQueue.length > 0) {
    const item = pendingPlayQueue[0];
    const played =
      item.kind === "live"
        ? await tryPlaySession(item.sessionId, item.allowPartial)
        : await tryPlayStoredMessage(item.message);
    if (!played) break;
    pendingPlayQueue.shift();
  }
}

export async function initPlayback(): Promise<void> {
  await setAudioModeAsync(WALKIE_RECORDING_AUDIO_MODE);
  telemetry.info("playback", "initialized");
}

export function beginReceiveSession(
  sessionId: string,
  from?: { id: string; name: string }
): void {
  if (shouldIgnoreIncoming(sessionId, from?.name)) {
    telemetry.debug("playback", "skip_own_session", { sessionId, data: { fromName: from?.name } });
    return;
  }
  const existing = sessions.get(sessionId);
  clearSessionTimers(getSession(sessionId));
  sessions.set(sessionId, {
    chunks: existing?.chunks ?? [],
    sampleRate: existing?.sampleRate ?? AUDIO_SAMPLE_RATE,
    fromId: from?.id ?? existing?.fromId ?? "unknown",
    fromName: from?.name ?? existing?.fromName ?? "Unknown",
    expectedCount: existing?.expectedCount,
    endReceived: existing?.endReceived ?? false,
    endReceivedAt: existing?.endReceivedAt,
    completedAt: existing?.completedAt,
    playing: false,
  });
  telemetry.session("receiver", sessionId, { peerName: from?.name, status: "active" });
  telemetry.info("playback", "session_begin", {
    sessionId,
    data: { peerName: from?.name, preservedChunks: existing?.chunks.length ?? 0 },
  });
}

export function updateReceiveSessionPeer(
  sessionId: string,
  from: { id: string; name: string }
): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.fromId = from.id;
  session.fromName = from.name;
}

export async function receiveChunk(
  sessionId: string,
  seq: number,
  pcmBase64: string,
  from?: { id: string; name: string }
): Promise<void> {
  if (shouldIgnoreIncoming(sessionId, from?.name)) return;
  const session = getSession(sessionId);
  if (from?.name && session.fromName === "Unknown") {
    session.fromId = from.id;
    session.fromName = from.name;
  }
  if (!session.chunks.some((c) => c.seq === seq)) {
    session.chunks.push({ seq, pcmBase64 });
    telemetry.metric("audioChunksReceived");

    if (seq === 0) {
      const firstPeak = measurePcmPeak(base64ToBytes(pcmBase64));
      telemetry.debug("playback", "first_chunk_peak", {
        sessionId,
        data: { firstPeak, base64Len: pcmBase64.length },
      });
    }

    telemetry.debug("playback", "chunk_buffered", {
      sessionId,
      data: {
        seq,
        totalBuffered: uniqueChunkCount(session),
        expected: session.expectedCount,
        base64Len: pcmBase64.length,
      },
    });
    telemetry.session("receiver", sessionId, { chunksReceived: uniqueChunkCount(session) });
  }

  schedulePlaybackAttempt(sessionId);
}

export async function endSession(
  sessionId: string,
  sampleRate?: number,
  expectedChunkCount?: number,
  completedAt?: number,
  from?: { id: string; name: string }
): Promise<void> {
  if (shouldIgnoreIncoming(sessionId, from?.name)) {
    sessions.delete(sessionId);
    return;
  }
  const session = getSession(sessionId);
  if (from?.name && session.fromName === "Unknown") {
    session.fromId = from.id;
    session.fromName = from.name;
  }
  if (sampleRate) {
    session.sampleRate = sampleRate;
  } else {
    telemetry.warn("playback", "sample_rate_missing", {
      sessionId,
      message: "ptt_end had no sampleRate — using 16kHz",
    });
  }

  session.expectedCount = expectedChunkCount;
  session.endReceived = true;
  session.endReceivedAt = Date.now();
  if (completedAt) {
    session.completedAt = completedAt;
  }

  const received = uniqueChunkCount(session);

  if (expectedChunkCount === 0) {
    telemetry.warn("playback", "sender_had_no_audio", { sessionId });
    clearSessionTimers(session);
    sessions.delete(sessionId);
    telemetry.sessionDone(sessionId, false, "sender_sent_zero_chunks");
    return;
  }

  if (expectedChunkCount !== undefined && expectedChunkCount !== received) {
    telemetry.info("playback", "waiting_for_late_chunks", {
      sessionId,
      data: {
        expected: expectedChunkCount,
        received,
        sampleRate,
        graceMs: CHUNK_ARRIVAL_GRACE_MS,
      },
    });
  }

  telemetry.info("playback", "session_end_received", {
    sessionId,
    data: { bufferedChunks: received, sampleRate, expectedChunkCount },
  });

  schedulePlaybackAttempt(sessionId);
}

async function activatePlaybackSession(): Promise<void> {
  await setIsAudioActiveAsync(true);
  await setAudioModeAsync(WALKIE_PLAYBACK_AUDIO_MODE);
}

async function restoreRecordingSession(): Promise<void> {
  await setAudioModeAsync(WALKIE_RECORDING_AUDIO_MODE);
}

function safeDeleteFile(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // non-fatal
  }
}

async function writeWavToCache(sessionId: string, wavBytes: Uint8Array): Promise<File> {
  const file = new File(Paths.cache, "walkie-playback", `${sessionId}.wav`);
  if (file.exists) file.delete();
  file.create({ overwrite: true, intermediates: true });
  file.write(wavBytes);
  return file;
}

async function waitForPlaybackFinish(
  sessionId: string,
  player: AudioPlayer,
  timeoutMs: number
): Promise<{ durationSec: number }> {
  let started = false;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`playback load timeout after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    const poll = setInterval(() => {
      if (player.isLoaded && !started) {
        started = true;
        player.volume = 1;
        player.play();
      }
    }, 100);

    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(poll);
      subscription.remove();
    };

    const subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (status.error) {
        cleanup();
        reject(new Error(status.error));
        return;
      }

      if (!started && status.isLoaded) {
        started = true;
        player.volume = 1;
        player.play();
      }

      if (status.didJustFinish) {
        cleanup();
        resolve({ durationSec: status.duration });
      }
    });
  });
}

async function tryPlayStoredMessage(message: StoredMessage): Promise<boolean> {
  return playAudioPayload({
    sessionId: message.sessionId,
    chunks: message.chunks,
    sampleRate: message.sampleRate,
    completedAt: message.completedAt,
    fromId: message.fromId,
    fromName: message.fromName,
    chunkCount: message.chunkCount,
    allowPartial: false,
    isManualReplay: true,
  });
}

async function tryPlaySession(sessionId: string, allowPartial = false): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session || session.playing) return false;

  if (session.chunks.length === 0) {
    telemetry.debug("playback", "waiting_for_chunks", { sessionId });
    return false;
  }

  const received = uniqueChunkCount(session);
  const expected = session.expectedCount;

  if (expected !== undefined && received < expected && !allowPartial) {
    return false;
  }

  if (expected !== undefined && received < expected && allowPartial) {
    emitWarning({
      type: "chunks_incomplete",
      sessionId,
      received,
      expected,
    });
  }

  session.playing = true;
  clearSessionTimers(session);

  const sampleRate = session.sampleRate;
  const completedAt = session.completedAt;
  const chunks = [...session.chunks];
  const fromId = session.fromId;
  const fromName = session.fromName;
  sessions.delete(sessionId);

  return playAudioPayload({
    sessionId,
    chunks,
    sampleRate,
    completedAt,
    fromId,
    fromName,
    chunkCount: expected ?? received,
    allowPartial,
    isManualReplay: false,
  });
}

interface PlayAudioPayloadInput {
  sessionId: string;
  chunks: PcmChunk[];
  sampleRate: number;
  completedAt?: number;
  fromId: string;
  fromName: string;
  chunkCount: number;
  allowPartial: boolean;
  isManualReplay: boolean;
}

async function playAudioPayload(input: PlayAudioPayloadInput): Promise<boolean> {
  const {
    sessionId,
    chunks,
    sampleRate,
    completedAt,
    fromId,
    fromName,
    chunkCount,
    allowPartial,
    isManualReplay,
  } = input;

  telemetry.metric("playbackAttempts");

  let tempFile: File | null = null;

  try {
    if (activePlayer) {
      activePlayer.remove();
      activePlayer = null;
    }

    const pcm = concatPcmChunks(chunks);

    if (pcm.length === 0) {
      telemetry.warn("playback", "empty_pcm_after_concat", { sessionId });
      telemetry.metric("playbackFailures");
      telemetry.sessionDone(sessionId, false, "empty_pcm");
      return true;
    }

    const peakAmplitude = measurePcmPeak(pcm);
    const durationMs = pcmDurationMs(pcm.length, sampleRate);
    const received = new Set(chunks.map((c) => c.seq)).size;

    if (!isManualReplay) {
      await upsertInboxMessage({
        sessionId,
        fromId,
        fromName,
        completedAt: completedAt ?? Date.now(),
        sampleRate,
        chunkCount,
        chunks,
        durationMs,
      });
      invalidateInbox();
    }

    if (peakAmplitude < SILENT_PEAK_THRESHOLD) {
      telemetry.warn("playback", "low_peak_audio", {
        sessionId,
        data: { peakAmplitude, received, expected: chunkCount, allowPartial },
        message: "Low PCM peak — playing anyway (may be silent sender or partial buffer)",
      });
      telemetry.metric("playbackSilentReceived");
      emitWarning({ type: "received_silent", sessionId, peakAmplitude });
    }

    const wavBytes = pcmToWavBytes(pcm, sampleRate);
    tempFile = await writeWavToCache(sessionId, wavBytes);

    telemetry.info("playback", "play_start", {
      sessionId,
      data: {
        chunks: received,
        expected: chunkCount,
        pcmBytes: pcm.length,
        sampleRate,
        peakAmplitude,
        durationMs,
        allowPartial,
        isManualReplay,
      },
    });

    await activatePlaybackSession();

    const player = createAudioPlayer(tempFile.uri, {
      downloadFirst: false,
      updateInterval: 100,
    });
    player.volume = 1;
    activePlayer = player;

    const { durationSec } = await waitForPlaybackFinish(sessionId, player, 15000);

    player.remove();
    if (activePlayer === player) activePlayer = null;

    telemetry.metric("playbackSuccess");
    telemetry.session("receiver", sessionId, {
      playbackDurationSec: durationSec,
      pcmBytes: pcm.length,
      peakAmplitude,
      sampleRate,
      status: "completed",
    });
    telemetry.sessionDone(sessionId, true);
    telemetry.info("playback", "play_finished", {
      sessionId,
      data: { durationSec, peakAmplitude, allowPartial, isManualReplay },
    });

    const playedAt = Date.now();
    if (isManualReplay) {
      await markInboxMessageReplayed(sessionId);
    } else {
      await markInboxMessagePlayed(sessionId, playedAt);
    }
    invalidateInbox();
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    telemetry.error("playback", "play_failed", { sessionId, data: { error: message } });
    telemetry.metric("playbackFailures");
    telemetry.sessionDone(sessionId, false, message);
    if (activePlayer) {
      activePlayer.remove();
      activePlayer = null;
    }
    return true;
  } finally {
    await restoreRecordingSession();
    if (tempFile) safeDeleteFile(tempFile);
  }
}

export async function teardownPlayback(): Promise<void> {
  sessions.forEach(clearSessionTimers);
  sessions.clear();
  pendingPlayQueue.length = 0;
  if (activePlayer) {
    activePlayer.remove();
    activePlayer = null;
  }
}
