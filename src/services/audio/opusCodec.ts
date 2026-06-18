/**
 * Opus wire codec — native libopus via react-native-opus (decode) and @imcooder/opuslib (encode/capture).
 */

import {
  createOpusDecoder,
  decodeOpusPacket,
  destroyOpusDecoder,
} from "react-native-opus";
import {
  AUDIO_CODEC,
  AUDIO_SAMPLE_RATE,
  type AudioCodec,
} from "../../config";
import { bytesToBase64, PcmChunk } from "./pcmUtils";
import { telemetry } from "../../lib/observability";
import type { WireChunk } from "./wireChunk";

export type { WireChunk };

const decoders = new Map<string, number>();

export function isOpusEnabled(): boolean {
  return AUDIO_CODEC === "opus";
}

export function wireCodec(): AudioCodec {
  return AUDIO_CODEC;
}

export function useNativeOpusCapture(): boolean {
  return isOpusEnabled();
}

function resolveCodec(codec?: AudioCodec): AudioCodec {
  return codec ?? "pcm";
}

export async function createReceiveDecoder(sessionId: string): Promise<void> {
  if (!isOpusEnabled()) return;
  await destroyReceiveDecoder(sessionId);
  const result = await createOpusDecoder(AUDIO_SAMPLE_RATE, 1);
  if (result.success && result.decoderId != null) {
    decoders.set(sessionId, result.decoderId);
    return;
  }
  telemetry.error("playback", "native_decoder_create_failed", {
    sessionId,
    data: { error: result.error ?? "unknown" },
  });
}

export async function destroyReceiveDecoder(sessionId: string): Promise<void> {
  const decoderId = decoders.get(sessionId);
  if (decoderId == null) return;
  decoders.delete(sessionId);
  try {
    await destroyOpusDecoder(decoderId);
  } catch {
    // non-fatal
  }
}

export function destroyAllCodecs(): void {
  for (const sessionId of [...decoders.keys()]) {
    void destroyReceiveDecoder(sessionId);
  }
}

async function decodeOpusPayload(sessionId: string, payloadBase64: string): Promise<string> {
  let decoderId = decoders.get(sessionId);
  if (decoderId == null) {
    await createReceiveDecoder(sessionId);
    decoderId = decoders.get(sessionId);
  }
  if (decoderId == null) {
    throw new Error("native Opus decoder unavailable");
  }

  const result = await decodeOpusPacket(payloadBase64, decoderId);
  if (!result.success || !result.decodedDataBase64) {
    throw new Error(result.error ?? "native decode failed");
  }
  return result.decodedDataBase64;
}

/** Decode one wire chunk to PCM base64 for the playback pipeline. */
export async function decodeWireChunk(
  sessionId: string,
  payloadBase64: string,
  codec?: AudioCodec
): Promise<string> {
  if (resolveCodec(codec) === "pcm") {
    return payloadBase64;
  }

  try {
    return await decodeOpusPayload(sessionId, payloadBase64);
  } catch (err) {
    telemetry.error("playback", "opus_decode_failed", {
      sessionId,
      data: {
        error: err instanceof Error ? err.message : String(err),
        payloadLen: payloadBase64.length,
      },
    });
    return payloadBase64;
  }
}

/** Decode all chunks from server history (opus → PCM) for inbox storage / replay. */
export async function decodeWireChunksToPcm(
  sessionId: string,
  chunks: PcmChunk[],
  codec?: AudioCodec
): Promise<PcmChunk[]> {
  if (resolveCodec(codec) === "pcm") {
    return chunks;
  }

  const result = await createOpusDecoder(AUDIO_SAMPLE_RATE, 1);
  if (!result.success || result.decoderId == null) {
    telemetry.error("playback", "opus_history_decoder_failed", { sessionId });
    return chunks;
  }

  const decoderId = result.decoderId;
  try {
    const sorted = [...chunks].sort((a, b) => a.seq - b.seq);
    const out: PcmChunk[] = [];
    for (const chunk of sorted) {
      const decoded = await decodeOpusPacket(chunk.pcmBase64, decoderId);
      if (decoded.success && decoded.decodedDataBase64) {
        out.push({ seq: chunk.seq, pcmBase64: decoded.decodedDataBase64 });
      }
    }
    return out.length > 0 ? out : chunks;
  } catch (err) {
    telemetry.error("playback", "opus_history_decode_failed", {
      sessionId,
      data: { error: err instanceof Error ? err.message : String(err), count: chunks.length },
    });
    return chunks;
  } finally {
    await destroyOpusDecoder(decoderId);
  }
}

/** PCM fallback when EXPO_PUBLIC_AUDIO_CODEC=pcm. */
export function pcmToWireChunk(seq: number, pcm: Uint8Array): WireChunk {
  return { seq, payloadBase64: bytesToBase64(pcm), codec: "pcm" };
}
