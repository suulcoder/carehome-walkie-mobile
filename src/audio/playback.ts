/**
 * Audio playback using expo-av (Expo SDK 56 compatible, iOS + Android).
 *
 * Buffers incoming PCM chunks per session; plays the full message when ptt_end arrives.
 */

import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { concatPcmChunks, pcmToWavBase64, PcmChunk } from "./pcmUtils";

const sessionBuffers = new Map<string, PcmChunk[]>();
let activeSound: Audio.Sound | null = null;

export async function initPlayback(): Promise<void> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    playThroughEarpieceAndroid: false,
    shouldDuckAndroid: true,
  });
}

export async function receiveChunk(
  sessionId: string,
  seq: number,
  pcmBase64: string
): Promise<void> {
  if (!sessionBuffers.has(sessionId)) {
    sessionBuffers.set(sessionId, []);
  }
  const buffer = sessionBuffers.get(sessionId)!;
  if (!buffer.some((c) => c.seq === seq)) {
    buffer.push({ seq, pcmBase64 });
  }
}

export async function endSession(sessionId: string): Promise<void> {
  const chunks = sessionBuffers.get(sessionId);
  sessionBuffers.delete(sessionId);
  if (!chunks || chunks.length === 0) return;

  try {
    if (activeSound) {
      await activeSound.unloadAsync();
      activeSound = null;
    }

    const pcm = concatPcmChunks(chunks);
    if (pcm.length === 0) return;

    const wavBase64 = pcmToWavBase64(pcm);
    const path = `${FileSystem.cacheDirectory}ptt-${sessionId}.wav`;
    await FileSystem.writeAsStringAsync(path, wavBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const { sound } = await Audio.Sound.createAsync({ uri: path });
    activeSound = sound;
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync().catch(() => {});
        FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
        if (activeSound === sound) activeSound = null;
      }
    });
    await sound.playAsync();
  } catch (err) {
    console.error("[playback]", err);
  }
}

export async function teardownPlayback(): Promise<void> {
  if (activeSound) {
    await activeSound.unloadAsync();
    activeSound = null;
  }
  sessionBuffers.clear();
}
