/**
 * Audio capture wrapper using @mykin-ai/expo-audio-stream (ExpoPlayAudioStream).
 *
 * Works on both iOS and Android.
 * Emits PCM16 base64 chunks (~20ms each at 16kHz mono).
 * Requires a dev build — does NOT work in Expo Go.
 */

import { ExpoPlayAudioStream } from "@mykin-ai/expo-audio-stream";
import { AUDIO_SAMPLE_RATE } from "../config";

export interface CaptureCallbacks {
  onChunk: (pcmBase64: string, seq: number) => void;
  onError: (err: Error) => void;
}

let seq = 0;
let activeSubscription: { remove: () => void } | null = null;

export async function requestMicPermission(): Promise<boolean> {
  try {
    const result = await ExpoPlayAudioStream.requestPermissionsAsync();
    return result.granted;
  } catch {
    return false;
  }
}

export async function startCapture(callbacks: CaptureCallbacks): Promise<void> {
  seq = 0;

  try {
    const { subscription } = await ExpoPlayAudioStream.startRecording({
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: 1,
      encoding: "pcm_16bit",
      interval: 20, // emit chunk every 20ms
      onAudioStream: async (event) => {
        if (event.data) {
          callbacks.onChunk(event.data, seq++);
        }
      },
    });

    activeSubscription = subscription ?? null;
  } catch (err) {
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

export async function stopCapture(): Promise<void> {
  try {
    activeSubscription?.remove();
    activeSubscription = null;
    await ExpoPlayAudioStream.stopRecording();
  } catch {
    // Ignore stop errors
  }
}
