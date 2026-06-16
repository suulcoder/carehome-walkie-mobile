/**
 * Audio capture using expo-av (Expo SDK 56 compatible, iOS + Android).
 *
 * Records while PTT is held; on release the WAV is read, PCM extracted,
 * split into ~20ms chunks, and returned for sending over WebSocket.
 */

import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { AUDIO_SAMPLE_RATE } from "../config";
import { base64ToBytes, extractPcmFromWav, PcmChunk, splitPcmIntoChunks } from "./pcmUtils";

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: ".wav",
    outputFormat: Audio.AndroidOutputFormat.DEFAULT,
    audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
    sampleRate: AUDIO_SAMPLE_RATE,
    numberOfChannels: 1,
    bitRate: 256000,
  },
  ios: {
    extension: ".wav",
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: AUDIO_SAMPLE_RATE,
    numberOfChannels: 1,
    bitRate: 256000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {},
};

let recording: Audio.Recording | null = null;

export async function requestMicPermission(): Promise<boolean> {
  const { status } = await Audio.requestPermissionsAsync();
  return status === "granted";
}

export async function startCapture(): Promise<void> {
  if (recording) {
    try {
      await recording.stopAndUnloadAsync();
    } catch {
      /* ignore */
    }
    recording = null;
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    playThroughEarpieceAndroid: false,
    shouldDuckAndroid: true,
  });

  const { recording: newRecording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
  recording = newRecording;
}

export async function stopCapture(): Promise<PcmChunk[]> {
  if (!recording) return [];

  try {
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    recording = null;

    if (!uri) return [];

    const wavBase64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.deleteAsync(uri, { idempotent: true });

    const wavBytes = base64ToBytes(wavBase64);
    const pcm = extractPcmFromWav(wavBytes);
    if (pcm.length === 0) return [];

    return splitPcmIntoChunks(pcm);
  } catch {
    recording = null;
    return [];
  }
}
