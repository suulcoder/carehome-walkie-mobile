import type { AudioCodec } from "../../config";

/** One sequenced audio payload on the WebSocket wire. */
export interface WireChunk {
  seq: number;
  payloadBase64: string;
  codec: AudioCodec;
}
