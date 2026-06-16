/**
 * Audio playback wrapper using @mykin-ai/expo-audio-stream buffered API.
 *
 * Works on both iOS and Android.
 * Uses the native jitter-buffer (startBufferedAudioStream / playAudioBuffered)
 * to handle out-of-order chunk delivery over lossy networks.
 *
 * Each inbound PTT session gets its own buffered stream keyed by sessionId.
 * The library handles sequencing internally; we add a JS-level seq tracker
 * only to detect and skip gaps on our side before handing off to native.
 */

import { ExpoPlayAudioStream } from "@mykin-ai/expo-audio-stream";

interface BufferedChunk {
  seq: number;
  pcmBase64: string;
}

const sessionBuffers = new Map<string, BufferedChunk[]>();
const sessionNextSeq = new Map<string, number>();
const activeSessions = new Set<string>();

// Gap timeout — if the next expected seq doesn't arrive within this window,
// skip ahead to prevent indefinite playback stall
const GAP_TIMEOUT_MS = 500;
const gapTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function initPlayback(): Promise<void> {
  // No global init needed — each session initialises its own buffered stream
}

export async function receiveChunk(
  sessionId: string,
  seq: number,
  pcmBase64: string
): Promise<void> {
  // Start a buffered stream for this session on first chunk
  if (!activeSessions.has(sessionId)) {
    activeSessions.add(sessionId);
    sessionBuffers.set(sessionId, []);
    sessionNextSeq.set(sessionId, 0);

    try {
      await ExpoPlayAudioStream.startBufferedAudioStream({
        turnId: sessionId,
      });
    } catch {
      // If stream can't start, still buffer — will attempt playback anyway
    }
  }

  const buffer = sessionBuffers.get(sessionId)!;
  buffer.push({ seq, pcmBase64 });
  buffer.sort((a, b) => a.seq - b.seq);

  drainBuffer(sessionId);
}

function drainBuffer(sessionId: string): void {
  const buffer = sessionBuffers.get(sessionId);
  if (!buffer) return;

  const existingTimer = gapTimers.get(sessionId);
  if (existingTimer) clearTimeout(existingTimer);

  while (buffer.length > 0 && buffer[0].seq === sessionNextSeq.get(sessionId)) {
    const chunk = buffer.shift()!;
    const isFirst = chunk.seq === 0;
    ExpoPlayAudioStream.playAudioBuffered(chunk.pcmBase64, sessionId, isFirst, false).catch(
      () => {}
    );
    sessionNextSeq.set(sessionId, chunk.seq + 1);
  }

  // Set a gap timer to skip a missing seq and prevent playback stall
  if (buffer.length > 0) {
    const timer = setTimeout(() => {
      const current = sessionNextSeq.get(sessionId) ?? 0;
      if (buffer.length > 0 && buffer[0].seq > current) {
        sessionNextSeq.set(sessionId, buffer[0].seq);
        drainBuffer(sessionId);
      }
    }, GAP_TIMEOUT_MS);
    gapTimers.set(sessionId, timer);
  }
}

export function endSession(sessionId: string): void {
  const timer = gapTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  gapTimers.delete(sessionId);

  // Mark final chunk so native buffer can flush cleanly
  const buffer = sessionBuffers.get(sessionId);
  if (buffer && buffer.length > 0) {
    const last = buffer[buffer.length - 1];
    ExpoPlayAudioStream.playAudioBuffered(last.pcmBase64, sessionId, false, true).catch(() => {});
  }

  ExpoPlayAudioStream.stopBufferedAudioStream(sessionId).catch(() => {});

  sessionBuffers.delete(sessionId);
  sessionNextSeq.delete(sessionId);
  activeSessions.delete(sessionId);
}

export async function teardownPlayback(): Promise<void> {
  for (const sessionId of activeSessions) {
    endSession(sessionId);
  }
}
