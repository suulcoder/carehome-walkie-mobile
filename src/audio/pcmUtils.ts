import { AUDIO_SAMPLE_RATE } from "../config";

/** Bytes of PCM16 mono per ~20ms chunk at 16 kHz */
export const CHUNK_PCM_BYTES = Math.floor(AUDIO_SAMPLE_RATE * 0.02 * 2);

export interface PcmChunk {
  seq: number;
  pcmBase64: string;
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Extract raw PCM bytes from a WAV file buffer. */
export function extractPcmFromWav(wavBytes: Uint8Array): Uint8Array {
  let offset = 12;
  while (offset + 8 <= wavBytes.length) {
    const id = String.fromCharCode(...wavBytes.slice(offset, offset + 4));
    const size =
      wavBytes[offset + 4] |
      (wavBytes[offset + 5] << 8) |
      (wavBytes[offset + 6] << 16) |
      (wavBytes[offset + 7] << 24);
    if (id === "data") {
      return wavBytes.slice(offset + 8, offset + 8 + size);
    }
    offset += 8 + size;
  }
  return wavBytes.slice(44);
}

/** Wrap raw PCM16 LE mono in a WAV container. */
export function pcmToWavBytes(pcm: Uint8Array, sampleRate = AUDIO_SAMPLE_RATE): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (pos: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(pos + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

/** Wrap raw PCM16 LE mono in a WAV container and return base64. */
export function pcmToWavBase64(pcm: Uint8Array, sampleRate = AUDIO_SAMPLE_RATE): string {
  return bytesToBase64(pcmToWavBytes(pcm, sampleRate));
}

export function splitPcmIntoChunks(pcm: Uint8Array, sampleRate = AUDIO_SAMPLE_RATE): PcmChunk[] {
  const chunkBytes = Math.max(2, Math.floor(sampleRate * 0.02 * 2));
  const chunks: PcmChunk[] = [];
  let seq = 0;
  for (let i = 0; i < pcm.length; i += chunkBytes) {
    const slice = pcm.slice(i, i + chunkBytes);
    chunks.push({ seq: seq++, pcmBase64: bytesToBase64(slice) });
  }
  return chunks;
}

export function concatPcmChunks(chunks: PcmChunk[]): Uint8Array {
  const sorted = [...chunks].sort((a, b) => a.seq - b.seq);
  const parts = sorted.map((c) => base64ToBytes(c.pcmBase64));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Concatenate chunks in seq order, filling missing sequences with silence.
 * Used when some chunks are still in transit or were lost on an unreliable network.
 */
export function concatPcmChunksWithGaps(
  chunks: PcmChunk[],
  expectedCount: number,
  sampleRate = AUDIO_SAMPLE_RATE
): { pcm: Uint8Array; gapsFilled: number } {
  const bySeq = new Map(chunks.map((c) => [c.seq, base64ToBytes(c.pcmBase64)]));
  const sampleSizes = chunks.map((c) => bySeq.get(c.seq)!.length);
  const chunkBytes =
    sampleSizes.length > 0
      ? Math.round(sampleSizes.reduce((a, b) => a + b, 0) / sampleSizes.length)
      : Math.max(2, Math.floor(sampleRate * 0.02 * 2));

  const parts: Uint8Array[] = [];
  let gapsFilled = 0;

  for (let seq = 0; seq < expectedCount; seq++) {
    const bytes = bySeq.get(seq);
    if (bytes) {
      parts.push(bytes);
    } else {
      parts.push(new Uint8Array(chunkBytes));
      gapsFilled += 1;
    }
  }

  const total = parts.reduce((n, p) => n + p.length, 0);
  const pcm = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    pcm.set(part, offset);
    offset += part.length;
  }

  return { pcm, gapsFilled };
}

/** Peak amplitude for PCM16 LE mono (0–32767). 0 usually means silence or no mic signal. */
export function measurePcmPeak(pcm: Uint8Array): number {
  let peak = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const sample = pcm[i] | (pcm[i + 1] << 8);
    const signed = sample > 32767 ? sample - 65536 : sample;
    peak = Math.max(peak, Math.abs(signed));
  }
  return peak;
}

export function pcmDurationMs(pcmBytes: number, sampleRate = AUDIO_SAMPLE_RATE): number {
  const samples = pcmBytes / 2;
  return Math.round((samples / sampleRate) * 1000);
}
