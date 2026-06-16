/**
 * Jitter-buffered audio playback using @mykin-ai/expo-audio-stream Pipeline.
 *
 * Buffers incoming chunks by (sessionId, seq) to handle out-of-order delivery,
 * then drains them to the native audio pipeline in sequence.
 */

import { AudioStreamManager } from "@mykin-ai/expo-audio-stream";
import { AUDIO_SAMPLE_RATE } from "../config";

interface BufferedChunk {
  seq: number;
  pcmBase64: string;
}

// Per-session inbound buffer
const sessionBuffers = new Map<string, BufferedChunk[]>();
const sessionNextSeq = new Map<string, number>();

// Gap timeout — if the next expected seq doesn't arrive within this window,
// skip ahead to avoid indefinite playback stall
const GAP_TIMEOUT_MS = 500;
const gapTimers = new Map<string, ReturnType<typeof setTimeout>>();

let manager: AudioStreamManager | null = null;

export async function initPlayback(): Promise<void> {
  manager = new AudioStreamManager({
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: 1,
    encoding: "pcm_16bit",
  });
  await manager.init();
}

export async function receiveChunk(
  sessionId: string,
  seq: number,
  pcmBase64: string
): Promise<void> {
  if (!manager) return;

  if (!sessionBuffers.has(sessionId)) {
    sessionBuffers.set(sessionId, []);
    sessionNextSeq.set(sessionId, 0);
  }

  const buffer = sessionBuffers.get(sessionId)!;
  buffer.push({ seq, pcmBase64 });
  buffer.sort((a, b) => a.seq - b.seq);

  drainBuffer(sessionId);
}

function drainBuffer(sessionId: string): void {
  const buffer = sessionBuffers.get(sessionId);
  if (!buffer || !manager) return;

  const nextSeq = sessionNextSeq.get(sessionId) ?? 0;

  // Clear any pending gap timer since we're draining
  const existingTimer = gapTimers.get(sessionId);
  if (existingTimer) clearTimeout(existingTimer);

  let drained = false;
  while (buffer.length > 0 && buffer[0].seq === sessionNextSeq.get(sessionId)) {
    const chunk = buffer.shift()!;
    manager.playChunk(chunk.pcmBase64, sessionId).catch(() => {});
    sessionNextSeq.set(sessionId, chunk.seq + 1);
    drained = true;
  }

  // If there's still buffered content but the next expected seq is missing,
  // set a gap timer to skip forward and prevent stall
  if (buffer.length > 0) {
    const timer = setTimeout(() => {
      const current = sessionNextSeq.get(sessionId) ?? 0;
      if (buffer.length > 0 && buffer[0].seq > current) {
        // Skip to next available
        sessionNextSeq.set(sessionId, buffer[0].seq);
        drainBuffer(sessionId);
      }
    }, GAP_TIMEOUT_MS);
    gapTimers.set(sessionId, timer);
  }

  // Suppress unused variable warning
  void nextSeq;
  void drained;
}

export function endSession(sessionId: string): void {
  sessionBuffers.delete(sessionId);
  sessionNextSeq.delete(sessionId);
  const timer = gapTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  gapTimers.delete(sessionId);
}

export async function teardownPlayback(): Promise<void> {
  await manager?.stop();
  manager = null;
  sessionBuffers.clear();
  sessionNextSeq.clear();
  gapTimers.forEach(clearTimeout);
  gapTimers.clear();
}
