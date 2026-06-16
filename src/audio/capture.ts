/**
 * Audio capture wrapper using @mykin-ai/expo-audio-stream.
 *
 * Emits PCM16 base64 chunks (~20ms each at 16kHz mono).
 * Requires a dev build — does NOT work in Expo Go.
 */

import { ExpoAudioStream, AudioStreamStatus } from "@mykin-ai/expo-audio-stream";
import { AUDIO_SAMPLE_RATE } from "../config";

export interface CaptureCallbacks {
  onChunk: (pcmBase64: string, seq: number) => void;
  onError: (err: Error) => void;
}

let seq = 0;
let subscription: { remove: () => void } | null = null;

export async function startCapture(callbacks: CaptureCallbacks): Promise<void> {
  seq = 0;

  try {
    subscription = ExpoAudioStream.addAudioEventListener((event) => {
      if (event.data && event.encoded) {
        callbacks.onChunk(event.encoded, seq++);
      }
    });

    await ExpoAudioStream.startRecording({
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: 1,
      encoding: "pcm_16bit",
      interval: 20, // emit chunk every 20ms
    });
  } catch (err) {
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

export async function stopCapture(): Promise<void> {
  try {
    subscription?.remove();
    subscription = null;
    await ExpoAudioStream.stopRecording();
  } catch {
    // Ignore stop errors
  }
}

export function getAudioStreamStatus(): AudioStreamStatus {
  return ExpoAudioStream.status();
}
