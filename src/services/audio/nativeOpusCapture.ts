/**
 * Native Opus capture + encode via @imcooder/opuslib (libopus 1.6, dedicated encode thread).
 */

import Opuslib, { type AudioEndEvent, type Subscription } from "@imcooder/opuslib";
import {
  AUDIO_SAMPLE_RATE,
  CHUNK_DURATION_MS,
  OPUS_BITRATE,
  OPUS_DRED_DURATION_MS,
} from "../../config";
import { telemetry } from "../../lib/observability";
import { bytesToBase64 } from "./pcmUtils";
import type { WireChunk } from "./wireChunk";

export interface NativeCaptureResult {
  chunks: [];
  chunksSent: number;
  sampleRate: number;
  pcmBytes: number;
  bufferCount: number;
  peakAmplitude: number;
  durationMs: number;
  wireChunks: WireChunk[];
}

let streaming = false;
let chunkSubscription: Subscription | null = null;
let endSubscription: Subscription | null = null;
let errorSubscription: Subscription | null = null;
let nextSeq = 0;
let packetsEmitted = 0;
let peakAmplitude = 0;
let captureStartedAt = 0;
let wireChunks: WireChunk[] = [];
let endWaiter: ((event: AudioEndEvent) => void) | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

function clearListeners(): void {
  chunkSubscription?.remove();
  endSubscription?.remove();
  errorSubscription?.remove();
  chunkSubscription = null;
  endSubscription = null;
  errorSubscription = null;
}

export function isNativeOpusCaptureActive(): boolean {
  return streaming;
}

export async function startNativeOpusCapture(
  sessionId: string | undefined,
  onWire?: (chunk: WireChunk) => void
): Promise<void> {
  if (streaming) {
    await stopNativeOpusCapture(sessionId);
  }

  nextSeq = 0;
  packetsEmitted = 0;
  peakAmplitude = 0;
  wireChunks = [];
  captureStartedAt = Date.now();

  endSubscription = Opuslib.addListener("audioEnd", (event) => {
    endWaiter?.(event);
    endWaiter = null;
  });

  errorSubscription = Opuslib.addListener("error", (event) => {
    telemetry.error("capture", "native_opus_error", {
      sessionId,
      data: { code: event.code, message: event.message },
    });
  });

  chunkSubscription = Opuslib.addListener("audioChunk", (event) => {
    for (const frame of event.frames) {
      const payloadBase64 = arrayBufferToBase64(frame.data);
      if (frame.audioLevel != null) {
        peakAmplitude = Math.max(peakAmplitude, Math.round(frame.audioLevel * 32767));
      }
      const chunk: WireChunk = {
        seq: nextSeq++,
        payloadBase64,
        codec: "opus",
      };
      packetsEmitted += 1;
      wireChunks.push(chunk);
      onWire?.(chunk);
    }
  });

  await Opuslib.startStreaming({
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: 1,
    bitrate: OPUS_BITRATE,
    frameSize: CHUNK_DURATION_MS,
    framesPerCallback: 1,
    dredDuration: OPUS_DRED_DURATION_MS,
    enableAudioLevel: true,
    iosAudioSession: {
      category: "playAndRecord",
      mode: "voiceChat",
      options: ["defaultToSpeaker", "allowBluetooth"],
    },
  });

  streaming = true;
  telemetry.info("capture", "native_opus_started", {
    sessionId,
    data: { sampleRate: AUDIO_SAMPLE_RATE, bitrate: OPUS_BITRATE, dredMs: OPUS_DRED_DURATION_MS },
  });
}

export async function stopNativeOpusCapture(sessionId?: string): Promise<NativeCaptureResult> {
  const holdMs = captureStartedAt ? Date.now() - captureStartedAt : 0;
  const empty: NativeCaptureResult = {
    chunks: [],
    chunksSent: 0,
    sampleRate: AUDIO_SAMPLE_RATE,
    pcmBytes: 0,
    bufferCount: 0,
    peakAmplitude: 0,
    durationMs: 0,
    wireChunks: [],
  };

  if (!streaming) {
    return empty;
  }

  const endPromise = new Promise<AudioEndEvent>((resolve) => {
    endWaiter = resolve;
    setTimeout(
      () =>
        resolve({
          timestamp: Date.now(),
          totalDuration: holdMs,
          totalPackets: packetsEmitted,
        }),
      800
    );
  });

  try {
    await Opuslib.stopStreaming();
  } catch (err) {
    telemetry.warn("capture", "native_opus_stop_failed", {
      sessionId,
      data: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  const endEvent = await endPromise;
  clearListeners();
  streaming = false;
  captureStartedAt = 0;

  const chunksSent = Math.max(packetsEmitted, endEvent.totalPackets);
  const durationMs = endEvent.totalDuration > 0 ? endEvent.totalDuration : holdMs;
  const result: NativeCaptureResult = {
    chunks: [],
    chunksSent,
    sampleRate: AUDIO_SAMPLE_RATE,
    pcmBytes: chunksSent * Math.floor(AUDIO_SAMPLE_RATE * (CHUNK_DURATION_MS / 1000) * 2),
    bufferCount: chunksSent,
    peakAmplitude,
    durationMs,
    wireChunks: [...wireChunks],
  };

  telemetry.info("capture", "native_opus_stopped", {
    sessionId,
    data: {
      holdMs,
      chunkCount: chunksSent,
      peakAmplitude,
      durationMs,
      packetsFromNative: endEvent.totalPackets,
    },
  });

  if (peakAmplitude < 200) {
    telemetry.warn("capture", "likely_silent", {
      sessionId,
      data: { peakAmplitude, holdMs },
      message: "Native Opus capture peak very low — check mic routing",
    });
  }

  nextSeq = 0;
  packetsEmitted = 0;
  wireChunks = [];
  return result;
}
