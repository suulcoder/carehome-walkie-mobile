/**
 * Audio playback using expo-audio (Expo SDK 56, iOS + Android).
 *
 * Uses an adaptive jitter buffer (RFC 3550-style) to balance latency and quality:
 * - Tracks inter-arrival jitter while chunks stream in.
 * - Target playout delay scales from JITTER_MIN_PLAYOUT_MS (fast network) to
 *   JITTER_MAX_PLAYOUT_MS (slow/jittery network).
 * - Complete messages play as one continuous WAV (best quality).
 * - Long live transmissions may start after the adaptive buffer fills, then drain
 *   in segments without toggling the audio session between segments.
 * - Missing chunks after ptt_end: CHUNK_GAP_FILL_MS silence fill, then CHUNK_ARRIVAL_GRACE_MS tail.
 */

import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioPlayer,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import {
  AUDIO_SAMPLE_RATE,
  CHUNK_ARRIVAL_GRACE_MS,
  CHUNK_DURATION_MS,
  CHUNK_GAP_FILL_MS,
  JITTER_MARGIN_FACTOR,
  JITTER_MAX_PLAYOUT_MS,
  JITTER_MIN_PLAYOUT_MS,
} from "../config";
import { WALKIE_RECORDING_AUDIO_MODE } from "./capture";
import { computePlayoutDelayMs, JitterEstimator } from "./jitterBuffer";
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
  CHUNK_PCM_BYTES,
  concatPcmChunks,
  concatPcmChunksWithGaps,
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

const PLAYOUT_CONFIG = {
  minMs: JITTER_MIN_PLAYOUT_MS,
  maxMs: JITTER_MAX_PLAYOUT_MS,
  marginFactor: JITTER_MARGIN_FACTOR,
};

export type PlaybackWarning =
  | { type: "received_silent"; sessionId: string; peakAmplitude: number }
  | { type: "sample_rate_unknown"; sessionId: string; inferredRate: number }
  | { type: "chunks_incomplete"; sessionId: string; received: number; expected: number };

type PlayMode = "complete" | "segment" | "final_partial";

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
  nextPlaySeq: number;
  lastChunkAt: number;
  jitterEstimator: JitterEstimator;
  playoutDelayMs: number;
  streamingPlayback: boolean;
}

type PlayQueueItem =
  | { kind: "live"; sessionId: string; mode: PlayMode }
  | { kind: "stored"; message: StoredMessage };

const sessions = new Map<string, ReceiveSession>();
const pendingPlayQueue: PlayQueueItem[] = [];
let drainPromise: Promise<void> | null = null;
let activePlayer: AudioPlayer | null = null;
let warningHandler: ((warning: PlaybackWarning) => void) | null = null;
let selfDisplayName: string | null = null;
const ownedSessionIds = new Set<string>();
let livePlaybackDepth = 0;

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
      nextPlaySeq: 0,
      lastChunkAt: 0,
      jitterEstimator: new JitterEstimator(CHUNK_DURATION_MS),
      playoutDelayMs: JITTER_MIN_PLAYOUT_MS,
      streamingPlayback: false,
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

function updatePlayoutDelay(session: ReceiveSession): void {
  session.playoutDelayMs = computePlayoutDelayMs(
    session.jitterEstimator.getJitterMs(),
    PLAYOUT_CONFIG
  );
}

function getUnplayedChunks(session: ReceiveSession): PcmChunk[] {
  return session.chunks
    .filter((c) => c.seq >= session.nextPlaySeq)
    .sort((a, b) => a.seq - b.seq);
}

function getUnplayedBytes(session: ReceiveSession): number {
  return getUnplayedChunks(session).reduce(
    (sum, chunk) => sum + base64ToBytes(chunk.pcmBase64).length,
    0
  );
}

function getUnplayedDurationMs(session: ReceiveSession): number {
  return pcmDurationMs(getUnplayedBytes(session), session.sampleRate);
}

/** Contiguous audio from nextPlaySeq without gaps (no silence fill). */
function getContiguousBufferedMs(session: ReceiveSession): number {
  let totalBytes = 0;
  let expectedSeq = session.nextPlaySeq;

  while (true) {
    const chunk = session.chunks.find((c) => c.seq === expectedSeq);
    if (!chunk) break;
    totalBytes += base64ToBytes(chunk.pcmBase64).length;
    expectedSeq++;
  }

  return pcmDurationMs(totalBytes, session.sampleRate);
}

function gapFillAllowed(session: ReceiveSession): boolean {
  if (!session.endReceived) return false;
  if (session.lastChunkAt === 0) return false;
  return Date.now() - session.lastChunkAt >= CHUNK_GAP_FILL_MS;
}

function windowPcmBytes(session: ReceiveSession): number {
  return Math.floor(session.sampleRate * (session.playoutDelayMs / 1000) * 2);
}

interface SegmentSelection {
  startSeq: number;
  endSeq: number;
  useGapFill: boolean;
}

function selectPlaybackRange(session: ReceiveSession, mode: PlayMode): SegmentSelection | null {
  if (mode === "complete") {
    const endSeq =
      session.expectedCount !== undefined
        ? session.expectedCount - 1
        : Math.max(...session.chunks.map((c) => c.seq));
    if (endSeq < session.nextPlaySeq) return null;
    return { startSeq: session.nextPlaySeq, endSeq, useGapFill: false };
  }

  if (mode === "final_partial") {
    const received = session.chunks.filter((c) => c.seq >= session.nextPlaySeq);
    if (received.length === 0) return null;
    const endSeq = Math.max(...received.map((c) => c.seq));
    if (endSeq < session.nextPlaySeq) return null;
    const useGapFill =
      gapFillAllowed(session) &&
      session.expectedCount !== undefined &&
      hasAllExpectedChunks(session);
    return { startSeq: session.nextPlaySeq, endSeq, useGapFill };
  }

  const windowBytes = windowPcmBytes(session);
  const allowGapFill = gapFillAllowed(session);
  let totalBytes = 0;
  let endSeq = session.nextPlaySeq - 1;
  let expectedSeq = session.nextPlaySeq;

  while (true) {
    const chunk = session.chunks.find((c) => c.seq === expectedSeq);
    if (!chunk) {
      if (allowGapFill) {
        if (totalBytes >= windowBytes) break;
        totalBytes += CHUNK_PCM_BYTES;
        endSeq = expectedSeq;
        expectedSeq++;
        continue;
      }
      break;
    }

    const bytes = base64ToBytes(chunk.pcmBase64).length;
    if (totalBytes > 0 && totalBytes + bytes > windowBytes && totalBytes >= windowBytes) {
      break;
    }

    totalBytes += bytes;
    endSeq = expectedSeq;
    expectedSeq++;

    if (totalBytes >= windowBytes) break;
  }

  if (endSeq < session.nextPlaySeq) return null;
  return { startSeq: session.nextPlaySeq, endSeq, useGapFill: allowGapFill };
}

function cancelActivePlayback(): void {
  if (activePlayer) {
    try {
      activePlayer.remove();
    } catch {
      // non-fatal
    }
    activePlayer = null;
  }
}

function preemptForLiveSession(sessionId: string): void {
  cancelActivePlayback();
  livePlaybackDepth = 0;

  for (const [id, session] of sessions) {
    if (id !== sessionId) {
      clearSessionTimers(session);
      sessions.delete(id);
    }
  }

  const staleIdx = pendingPlayQueue.findIndex(
    (item) => item.kind === "live" && item.sessionId !== sessionId
  );
  if (staleIdx !== -1) {
    pendingPlayQueue.splice(
      0,
      pendingPlayQueue.length,
      ...pendingPlayQueue.filter(
        (item) => item.kind !== "live" || item.sessionId === sessionId
      )
    );
    telemetry.info("playback", "preempt_stale_queue", { sessionId });
  }
}

function cleanupSession(sessionId: string, session: ReceiveSession): void {
  clearSessionTimers(session);
  sessions.delete(sessionId);
}

function finishSession(sessionId: string, session: ReceiveSession, success: boolean, reason?: string): void {
  cleanupSession(sessionId, session);
  telemetry.sessionDone(sessionId, success, reason);
}

function schedulePlaybackAttempt(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session || session.playing) return;

  updatePlayoutDelay(session);

  const unplayedMs = getUnplayedDurationMs(session);
  const contiguousMs = getContiguousBufferedMs(session);
  const allReceived = hasAllExpectedChunks(session);

  if (session.endReceived && unplayedMs === 0 && allReceived) {
    finishSession(sessionId, session, true);
    return;
  }

  // Start streaming once the adaptive buffer has enough contiguous audio.
  if (contiguousMs >= session.playoutDelayMs) {
    clearSessionTimers(session);
    enqueuePlayback(sessionId, "segment");
    return;
  }

  // Short remainder after ptt_end (all chunks already in buffer).
  if (session.endReceived && unplayedMs > 0 && allReceived) {
    clearSessionTimers(session);
    enqueuePlayback(sessionId, "final_partial");
    return;
  }

  if (!session.endReceived) return;

  if (unplayedMs > 0 && gapFillAllowed(session)) {
    enqueuePlayback(sessionId, "final_partial");
    return;
  }

  clearSessionTimers(session);
  session.graceTimer = setTimeout(() => {
    session.graceTimer = undefined;
    if (session.playing) return;

    const remainingMs = getUnplayedDurationMs(session);
    if (remainingMs === 0) {
      finishSession(sessionId, session, true);
      return;
    }

    if (hasAllExpectedChunks(session)) {
      enqueuePlayback(sessionId, "final_partial");
      return;
    }

    telemetry.warn("playback", "chunk_grace_timeout", {
      sessionId,
      data: {
        expected: session.expectedCount,
        received: uniqueChunkCount(session),
        playoutDelayMs: session.playoutDelayMs,
        jitterMs: session.jitterEstimator.getJitterMs(),
        idleMs: CHUNK_ARRIVAL_GRACE_MS,
      },
      message: "No new chunks since grace window — playing received chunks with gap fill",
    });
    enqueuePlayback(sessionId, "final_partial");
  }, CHUNK_ARRIVAL_GRACE_MS);
}

function enqueuePlayback(sessionId: string, mode: PlayMode): void {
  const MODE_PRIORITY: Record<PlayMode, number> = {
    segment: 0,
    final_partial: 1,
    complete: 2,
  };

  const existing = pendingPlayQueue.find(
    (item) => item.kind === "live" && item.sessionId === sessionId
  );
  if (existing && existing.kind === "live") {
    if (MODE_PRIORITY[mode] > MODE_PRIORITY[existing.mode]) {
      existing.mode = mode;
    }
  } else {
    pendingPlayQueue.push({ kind: "live", sessionId, mode });
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
    if (item.kind === "live" && !sessions.has(item.sessionId)) {
      telemetry.debug("playback", "drop_stale_queue_item", { sessionId: item.sessionId });
      pendingPlayQueue.shift();
      continue;
    }

    const played =
      item.kind === "live"
        ? await tryPlaySession(item.sessionId, item.mode)
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

  preemptForLiveSession(sessionId);

  const existing = sessions.get(sessionId);
  clearSessionTimers(getSession(sessionId));
  sessions.set(sessionId, {
    chunks: [],
    sampleRate: existing?.sampleRate ?? AUDIO_SAMPLE_RATE,
    fromId: from?.id ?? existing?.fromId ?? "unknown",
    fromName: from?.name ?? existing?.fromName ?? "Unknown",
    expectedCount: undefined,
    endReceived: false,
    endReceivedAt: undefined,
    completedAt: undefined,
    playing: false,
    nextPlaySeq: 0,
    lastChunkAt: 0,
    jitterEstimator: new JitterEstimator(CHUNK_DURATION_MS),
    playoutDelayMs: JITTER_MIN_PLAYOUT_MS,
    streamingPlayback: false,
  });
  telemetry.session("receiver", sessionId, { peerName: from?.name, status: "active" });
  telemetry.info("playback", "session_begin", {
    sessionId,
    data: { peerName: from?.name },
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
    session.lastChunkAt = Date.now();
    session.jitterEstimator.onChunkArrival(session.lastChunkAt);
    updatePlayoutDelay(session);
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
        playoutDelayMs: session.playoutDelayMs,
        jitterMs: session.jitterEstimator.getJitterMs(),
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
  updatePlayoutDelay(session);

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
        playoutDelayMs: session.playoutDelayMs,
        jitterMs: session.jitterEstimator.getJitterMs(),
        graceMs: CHUNK_ARRIVAL_GRACE_MS,
      },
    });
  }

  telemetry.info("playback", "session_end_received", {
    sessionId,
    data: {
      bufferedChunks: received,
      sampleRate,
      expectedChunkCount,
      playoutDelayMs: session.playoutDelayMs,
      jitterMs: session.jitterEstimator.getJitterMs(),
    },
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

async function writeWavToCache(sessionId: string, wavBytes: Uint8Array, suffix?: string): Promise<File> {
  const name = suffix ? `${sessionId}-${suffix}.wav` : `${sessionId}.wav`;
  const file = new File(Paths.cache, "walkie-playback", name);
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
  const pcm = concatPcmChunks(message.chunks);
  return playAudioPayload({
    sessionId: message.sessionId,
    pcm,
    sampleRate: message.sampleRate,
    completedAt: message.completedAt,
    fromId: message.fromId,
    fromName: message.fromName,
    chunkCount: message.chunkCount,
    isManualReplay: true,
    isFinalSegment: true,
    inboxChunks: message.chunks,
    playMode: "complete",
    gapsFilled: 0,
  });
}

async function tryPlaySession(sessionId: string, mode: PlayMode): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) {
    telemetry.debug("playback", "stale_session_skip", { sessionId, data: { mode } });
    return true;
  }
  if (session.playing) return false;

  const range = selectPlaybackRange(session, mode);
  if (!range) {
    telemetry.debug("playback", "waiting_for_buffer", {
      sessionId,
      data: {
        mode,
        playoutDelayMs: session.playoutDelayMs,
        contiguousMs: getContiguousBufferedMs(session),
        unplayedMs: getUnplayedDurationMs(session),
      },
    });
    return false;
  }

  const received = uniqueChunkCount(session);
  const expected = session.expectedCount;
  const isFinalSegment = mode === "complete" || mode === "final_partial";
  const allowPartial = mode === "final_partial";

  if (allowPartial && expected !== undefined && received < expected) {
    emitWarning({
      type: "chunks_incomplete",
      sessionId,
      received,
      expected,
    });
  }

  const segmentChunks = session.chunks.filter(
    (c) => c.seq >= range.startSeq && c.seq <= range.endSeq
  );
  const seqCount = range.endSeq - range.startSeq + 1;

  let pcm: Uint8Array;
  let gapsFilled = 0;

  if (range.useGapFill && seqCount > 0) {
    const gapResult = concatPcmChunksWithGaps(
      segmentChunks,
      seqCount,
      session.sampleRate
    );
    pcm = gapResult.pcm;
    gapsFilled = gapResult.gapsFilled;
    if (gapsFilled > 0) {
      telemetry.info("playback", "gaps_filled_with_silence", {
        sessionId,
        data: { gapsFilled, startSeq: range.startSeq, endSeq: range.endSeq },
      });
    }
  } else {
    pcm = concatPcmChunks(segmentChunks);
  }

  if (pcm.length === 0) {
    return false;
  }

  const segmentMs = pcmDurationMs(pcm.length, session.sampleRate);
  if (mode === "segment" && segmentMs < session.playoutDelayMs * 0.5) {
    return false;
  }

  session.playing = true;
  clearSessionTimers(session);

  if (mode === "segment") {
    session.streamingPlayback = true;
    livePlaybackDepth++;
  }

  const sampleRate = session.sampleRate;
  const completedAt = session.completedAt;
  const fromId = session.fromId;
  const fromName = session.fromName;
  const inboxChunks = [...session.chunks];
  const segmentSuffix = `${range.startSeq}-${range.endSeq}`;

  try {
    const played = await playAudioPayload({
      sessionId,
      pcm,
      sampleRate,
      completedAt,
      fromId,
      fromName,
      chunkCount: expected ?? received,
      isManualReplay: false,
      isFinalSegment,
      inboxChunks,
      segmentSuffix: isFinalSegment && mode !== "complete" ? segmentSuffix : undefined,
      playMode: mode,
      gapsFilled,
      playoutDelayMs: session.playoutDelayMs,
      jitterMs: session.jitterEstimator.getJitterMs(),
    });

    if (!played) {
      session.playing = false;
      if (session.streamingPlayback) {
        session.streamingPlayback = false;
        livePlaybackDepth = Math.max(0, livePlaybackDepth - 1);
      }
      return true;
    }

    session.nextPlaySeq = range.endSeq + 1;

    if (isFinalSegment) {
      if (session.streamingPlayback) {
        session.streamingPlayback = false;
        livePlaybackDepth = Math.max(0, livePlaybackDepth - 1);
      }
      cleanupSession(sessionId, session);
    } else {
      session.playing = false;
      schedulePlaybackAttempt(sessionId);
    }

    return true;
  } catch {
    session.playing = false;
    if (session.streamingPlayback) {
      session.streamingPlayback = false;
      livePlaybackDepth = Math.max(0, livePlaybackDepth - 1);
    }
    if (isFinalSegment) {
      cleanupSession(sessionId, session);
    }
    return true;
  }
}

interface PlayAudioPayloadInput {
  sessionId: string;
  pcm: Uint8Array;
  sampleRate: number;
  completedAt?: number;
  fromId: string;
  fromName: string;
  chunkCount: number;
  isManualReplay: boolean;
  isFinalSegment: boolean;
  inboxChunks?: PcmChunk[];
  segmentSuffix?: string;
  playMode: PlayMode | "stored";
  gapsFilled: number;
  playoutDelayMs?: number;
  jitterMs?: number;
}

async function playAudioPayload(input: PlayAudioPayloadInput): Promise<boolean> {
  const {
    sessionId,
    pcm,
    sampleRate,
    completedAt,
    fromId,
    fromName,
    chunkCount,
    isManualReplay,
    isFinalSegment,
    inboxChunks,
    segmentSuffix,
    playMode,
    gapsFilled,
    playoutDelayMs,
    jitterMs,
  } = input;

  telemetry.metric("playbackAttempts");

  let tempFile: File | null = null;
  const keepPlaybackSession = !isFinalSegment && livePlaybackDepth > 0;

  try {
    if (activePlayer) {
      activePlayer.remove();
      activePlayer = null;
    }

    if (pcm.length === 0) {
      telemetry.warn("playback", "empty_pcm", { sessionId });
      telemetry.metric("playbackFailures");
      if (isFinalSegment) {
        telemetry.sessionDone(sessionId, false, "empty_pcm");
      }
      return true;
    }

    const peakAmplitude = measurePcmPeak(pcm);
    const durationMs = pcmDurationMs(pcm.length, sampleRate);

    if (!isManualReplay && isFinalSegment && inboxChunks) {
      const fullDurationMs = pcmDurationMs(
        inboxChunks.reduce((sum, c) => sum + base64ToBytes(c.pcmBase64).length, 0),
        sampleRate
      );
      await upsertInboxMessage({
        sessionId,
        fromId,
        fromName,
        completedAt: completedAt ?? Date.now(),
        sampleRate,
        chunkCount,
        chunks: inboxChunks,
        durationMs: fullDurationMs,
      });
      invalidateInbox();
    }

    if (peakAmplitude < SILENT_PEAK_THRESHOLD) {
      telemetry.warn("playback", "low_peak_audio", {
        sessionId,
        data: { peakAmplitude, expected: chunkCount, playMode, gapsFilled },
        message: "Low PCM peak — playing anyway (may be silent sender or partial buffer)",
      });
      telemetry.metric("playbackSilentReceived");
      emitWarning({ type: "received_silent", sessionId, peakAmplitude });
    }

    const wavBytes = pcmToWavBytes(pcm, sampleRate);
    tempFile = await writeWavToCache(sessionId, wavBytes, segmentSuffix);

    telemetry.info("playback", "play_start", {
      sessionId,
      data: {
        playMode,
        pcmBytes: pcm.length,
        sampleRate,
        peakAmplitude,
        durationMs,
        isFinalSegment,
        gapsFilled,
        playoutDelayMs,
        jitterMs,
        segmentSuffix,
      },
    });

    await activatePlaybackSession();

    const player = createAudioPlayer(tempFile.uri, {
      downloadFirst: false,
      updateInterval: 100,
    });
    player.volume = 1;
    activePlayer = player;

    const loadTimeoutMs = Math.min(60_000, Math.max(8_000, durationMs * 2 + 5_000));
    const { durationSec } = await waitForPlaybackFinish(sessionId, player, loadTimeoutMs);

    player.remove();
    if (activePlayer === player) activePlayer = null;

    telemetry.metric("playbackSuccess");
    telemetry.session("receiver", sessionId, {
      playbackDurationSec: durationSec,
      pcmBytes: pcm.length,
      peakAmplitude,
      sampleRate,
      status: isFinalSegment ? "completed" : "segment",
      playoutDelayMs,
      jitterMs,
      gapsFilled,
    });
    if (isFinalSegment) {
      telemetry.sessionDone(sessionId, true);
    }
    telemetry.info("playback", "play_finished", {
      sessionId,
      data: { durationSec, peakAmplitude, isFinalSegment, playMode, gapsFilled },
    });

    if (isFinalSegment) {
      const playedAt = Date.now();
      if (isManualReplay) {
        await markInboxMessageReplayed(sessionId);
      } else {
        await markInboxMessagePlayed(sessionId, playedAt);
      }
      invalidateInbox();
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    telemetry.error("playback", "play_failed", { sessionId, data: { error: message } });
    telemetry.metric("playbackFailures");
    if (isFinalSegment) {
      telemetry.sessionDone(sessionId, false, message);
    }
    if (activePlayer) {
      activePlayer.remove();
      activePlayer = null;
    }
    return false;
  } finally {
    if (!keepPlaybackSession) {
      await restoreRecordingSession();
    }
    if (tempFile) safeDeleteFile(tempFile);
  }
}

export async function teardownPlayback(): Promise<void> {
  sessions.forEach(clearSessionTimers);
  sessions.clear();
  pendingPlayQueue.length = 0;
  livePlaybackDepth = 0;
  cancelActivePlayback();
}
