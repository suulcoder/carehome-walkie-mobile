/**
 * Audio capture using expo-audio AudioStream (Expo SDK 56, iOS + Android).
 */

import {
  AudioModule,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioStream,
} from "expo-audio";
import { AUDIO_SAMPLE_RATE } from "../../config";
import { telemetry } from "../../lib/observability";
import {
  base64ToBytes,
  bytesToBase64,
  measurePcmPeak,
  pcmDurationMs,
  PcmChunk,
  splitPcmIntoChunks,
} from "./pcmUtils";
import { pcmToWireChunk, useNativeOpusCapture } from "./opusCodec";
import {
  isNativeOpusCaptureActive,
  startNativeOpusCapture,
  stopNativeOpusCapture,
} from "./nativeOpusCapture";
import type { WireChunk } from "./wireChunk";

export type { WireChunk };
export type WireChunkEmitter = (chunk: WireChunk) => void;

export const WALKIE_RECORDING_AUDIO_MODE = {
  allowsRecording: true,
  playsInSilentMode: true,
  interruptionMode: "duckOthers" as const,
  shouldRouteThroughEarpiece: false,
};

export interface CaptureResult {
  /** Remaining PCM chunks when batch mode (no live emitter). Empty when streaming. */
  chunks: PcmChunk[];
  /** Total seq-numbered chunks emitted (live + tail). Use for ptt_end chunkCount. */
  chunksSent: number;
  sampleRate: number;
  pcmBytes: number;
  bufferCount: number;
  peakAmplitude: number;
  durationMs: number;
  /** Wire payloads when using native Opus capture. */
  wireChunks?: WireChunk[];
}

export type ChunkEmitter = (chunk: PcmChunk) => void;

let stream: AudioStream | null = null;
let pcmParts: Uint8Array[] = [];
let pendingPcm = new Uint8Array(0);
let nextSeq = 0;
let chunksEmitted = 0;
let chunkEmitter: ChunkEmitter | null = null;
let bufferSubscription: { remove: () => void } | null = null;
let captureChain: Promise<unknown> = Promise.resolve();
let activeSampleRate = AUDIO_SAMPLE_RATE;
let captureStartedAt = 0;
let buffersReceived = 0;

function withCaptureLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = captureChain.then(fn, fn);
  captureChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Wait until any in-flight capture start/stop has finished. */
export function waitForCaptureIdle(): Promise<void> {
  return captureChain.then(() => undefined);
}

export function isCaptureActive(): boolean {
  return stream !== null || isNativeOpusCaptureActive();
}

async function stopStreamInternal(): Promise<void> {
  bufferSubscription?.remove();
  bufferSubscription = null;

  if (stream) {
    try {
      stream.stop();
    } catch (err) {
      telemetry.warn("capture", "stream_stop_failed", {
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    }
    stream = null;
  }

  await setAudioModeAsync(WALKIE_RECORDING_AUDIO_MODE);
}

export async function requestMicPermission(): Promise<boolean> {
  const { granted } = await requestRecordingPermissionsAsync();
  telemetry.info("capture", "mic_permission", { data: { granted } });
  return granted;
}

function chunkByteSize(sampleRate: number): number {
  return Math.max(2, Math.floor(sampleRate * 0.02 * 2));
}

function appendPending(part: Uint8Array, sampleRate: number): void {
  const merged = new Uint8Array(pendingPcm.length + part.length);
  merged.set(pendingPcm);
  merged.set(part, pendingPcm.length);
  pendingPcm = merged;
  emitCompleteChunks(sampleRate);
}

function emitCompleteChunks(sampleRate: number): void {
  const size = chunkByteSize(sampleRate);
  while (pendingPcm.length >= size) {
    const slice = pendingPcm.slice(0, size);
    pendingPcm = pendingPcm.slice(size);
    const chunk: PcmChunk = { seq: nextSeq++, pcmBase64: bytesToBase64(slice) };
    chunksEmitted += 1;
    chunkEmitter?.(chunk);
  }
}

function flushPendingTail(sampleRate: number): PcmChunk[] {
  if (pendingPcm.length === 0) return [];
  const chunk: PcmChunk = { seq: nextSeq++, pcmBase64: bytesToBase64(pendingPcm) };
  pendingPcm = new Uint8Array(0);
  chunksEmitted += 1;
  chunkEmitter?.(chunk);
  return [chunk];
}

export async function startCapture(sessionId?: string, onWire?: WireChunkEmitter): Promise<void> {
  if (useNativeOpusCapture()) {
    return withCaptureLock(() => startNativeOpusCapture(sessionId, onWire));
  }

  return withCaptureLock(async () => {
    await stopStreamInternal();
    pcmParts = [];
    pendingPcm = new Uint8Array(0);
    nextSeq = 0;
    chunksEmitted = 0;
    chunkEmitter = onWire
      ? (pcm) => {
          onWire(pcmToWireChunk(pcm.seq, base64ToBytes(pcm.pcmBase64)));
        }
      : null;
    buffersReceived = 0;
    captureStartedAt = Date.now();

    await setAudioModeAsync(WALKIE_RECORDING_AUDIO_MODE);

    const nextStream = new AudioModule.AudioStream({
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: 1,
      encoding: "int16",
    });

    bufferSubscription = nextStream.addListener("audioStreamBuffer", (buffer) => {
      buffersReceived += 1;
      const part = new Uint8Array(buffer.data);
      pcmParts.push(part);
      const rate = buffer.sampleRate || activeSampleRate;
      if (chunkEmitter) {
        appendPending(part, rate);
      }
      if (buffersReceived === 1) {
        telemetry.debug("capture", "first_buffer", {
          sessionId,
          data: {
            bytes: buffer.data.byteLength,
            streamSampleRate: buffer.sampleRate,
            channels: buffer.channels,
          },
        });
      }
    });

    stream = nextStream;
    await nextStream.start();
    activeSampleRate = nextStream.sampleRate || AUDIO_SAMPLE_RATE;

    telemetry.info("capture", "started", {
      sessionId,
      data: {
        requestedSampleRate: AUDIO_SAMPLE_RATE,
        actualSampleRate: activeSampleRate,
        rateMismatch: activeSampleRate !== AUDIO_SAMPLE_RATE,
        nativeOpus: false,
      },
    });

    if (activeSampleRate !== AUDIO_SAMPLE_RATE) {
      telemetry.warn("capture", "sample_rate_mismatch", {
        sessionId,
        data: { requested: AUDIO_SAMPLE_RATE, actual: activeSampleRate },
        message: "Receiver must use actualSampleRate when building WAV",
      });
    }
  });
}

export async function stopCapture(sessionId?: string): Promise<CaptureResult> {
  if (useNativeOpusCapture() || isNativeOpusCaptureActive()) {
    return withCaptureLock(() => stopNativeOpusCapture(sessionId));
  }

  return withCaptureLock(async () => {
    const parts = pcmParts;
    const bufferCount = buffersReceived;
    const sampleRate = activeSampleRate;
    const holdMs = captureStartedAt ? Date.now() - captureStartedAt : 0;
    const wasStreaming = Boolean(chunkEmitter);

    flushPendingTail(sampleRate);

    await stopStreamInternal();
    pcmParts = [];
    pendingPcm = new Uint8Array(0);
    chunkEmitter = null;
    buffersReceived = 0;
    captureStartedAt = 0;

    const empty: CaptureResult = {
      chunks: [],
      chunksSent: 0,
      sampleRate,
      pcmBytes: 0,
      bufferCount,
      peakAmplitude: 0,
      durationMs: 0,
    };

    if (parts.length === 0) {
      telemetry.warn("capture", "no_buffers", {
        sessionId,
        data: { holdMs, bufferCount },
        message: "Mic stream produced zero PCM buffers — check emulator mic / permissions",
      });
      return empty;
    }

    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const pcm = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      pcm.set(part, offset);
      offset += part.length;
    }

    if (pcm.length === 0) {
      telemetry.warn("capture", "empty_pcm", { sessionId, data: { holdMs, bufferCount } });
      return empty;
    }

    const peakAmplitude = measurePcmPeak(pcm);
    const durationMs = pcmDurationMs(pcm.length, sampleRate);
    const batchChunks = wasStreaming ? [] : splitPcmIntoChunks(pcm, sampleRate);
    const chunksSent = wasStreaming ? chunksEmitted : batchChunks.length;
    nextSeq = 0;
    chunksEmitted = 0;

    telemetry.info("capture", "stopped", {
      sessionId,
      data: {
        holdMs,
        bufferCount,
        pcmBytes: pcm.length,
        peakAmplitude,
        durationMs,
        sampleRate,
        chunkCount: chunksSent,
        streaming: wasStreaming,
        silent: peakAmplitude < 200,
      },
    });

    if (peakAmplitude < 200) {
      telemetry.warn("capture", "likely_silent", {
        sessionId,
        data: { peakAmplitude, holdMs },
        message: "PCM peak very low — emulator may not be routing host mic audio",
      });
    }

    if (holdMs < 400) {
      telemetry.warn("capture", "hold_too_short", {
        sessionId,
        data: { holdMs },
        message: "Hold PTT at least ~0.5s for audible messages",
      });
    }

    return {
      chunks: batchChunks,
      chunksSent,
      sampleRate,
      pcmBytes: pcm.length,
      bufferCount,
      peakAmplitude,
      durationMs,
    };
  });
}
