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

/** Wrap raw PCM16 LE mono in a WAV container and return base64. */
export function pcmToWavBase64(pcm: Uint8Array, sampleRate = AUDIO_SAMPLE_RATE): string {
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
  return bytesToBase64(new Uint8Array(buffer));
}

export function splitPcmIntoChunks(pcm: Uint8Array): PcmChunk[] {
  const chunks: PcmChunk[] = [];
  let seq = 0;
  for (let i = 0; i < pcm.length; i += CHUNK_PCM_BYTES) {
    const slice = pcm.slice(i, i + CHUNK_PCM_BYTES);
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
