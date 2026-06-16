import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Alert,
  ToastAndroid,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import ReactNativeHapticFeedback from "react-native-haptic-feedback";
import { nanoid } from "nanoid/non-secure";

import { WsClient, ConnectionState } from "./src/network/wsClient";
import { ServerMessage, PeerInfo } from "./src/network/protocol";
import { startCapture, stopCapture } from "./src/audio/capture";
import { initPlayback, receiveChunk, endSession } from "./src/audio/playback";
import { ConnectionBanner } from "./src/ui/ConnectionBanner";
import { PTTButton } from "./src/ui/PTTButton";
import { PeerList } from "./src/ui/PeerList";
import { NameModal } from "./src/ui/NameModal";

const NAME_KEY = "display_name";

function showToast(msg: string) {
  if (Platform.OS === "android") {
    ToastAndroid.show(msg, ToastAndroid.SHORT);
  }
}

export default function App() {
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [connState, setConnState] = useState<ConnectionState>("disconnected");
  const [queuedCount, setQueuedCount] = useState(0);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [isTalking, setIsTalking] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);

  const wsRef = useRef<WsClient | null>(null);
  const activePttSession = useRef<string | null>(null);

  // Load persisted name on mount
  useEffect(() => {
    AsyncStorage.getItem(NAME_KEY).then((name) => {
      if (name) {
        setDisplayName(name);
      } else {
        setShowNameModal(true);
      }
    });
    initPlayback().catch(console.error);
  }, []);

  // Connect WebSocket when name is set
  useEffect(() => {
    if (!displayName) return;

    const client = new WsClient(displayName, {
      onStateChange: (state, queued) => {
        setConnState(state);
        setQueuedCount(queued);
      },
      onMessage: handleServerMessage,
      onPeers: setPeers,
    });

    wsRef.current = client;
    client.connect();

    return () => {
      client.destroy();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayName]);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "peer_joined":
        setPeers((prev) => [...prev.filter((p) => p.id !== msg.peer.id), msg.peer]);
        showToast(`${msg.peer.name} joined`);
        break;
      case "peer_left":
        setPeers((prev) => prev.filter((p) => p.id !== msg.peerId));
        setActiveSpeaker((prev) => (prev === msg.peerId ? null : prev));
        break;
      case "ptt_start":
        setActiveSpeaker(msg.from.id);
        showToast(`${msg.from.name} is speaking`);
        break;
      case "audio_chunk":
        receiveChunk(msg.sessionId, msg.seq, msg.pcmBase64).catch(() => {});
        break;
      case "ptt_end":
        endSession(msg.sessionId);
        setActiveSpeaker((prev) => (prev === msg.from.id ? null : prev));
        break;
    }
  }, []);

  const handleNameSubmit = async (name: string) => {
    await AsyncStorage.setItem(NAME_KEY, name);
    setDisplayName(name);
    setShowNameModal(false);
  };

  const handlePttIn = async () => {
    if (isTalking || !wsRef.current) return;

    ReactNativeHapticFeedback.trigger("impactMedium", { enableVibrateFallback: true });
    const sessionId = nanoid(8);
    activePttSession.current = sessionId;
    setIsTalking(true);

    wsRef.current.sendPttStart(sessionId);

    await startCapture({
      onChunk: (pcmBase64, seq) => {
        wsRef.current?.sendAudioChunk(sessionId, seq, pcmBase64);
      },
      onError: (err) => {
        console.error("[capture]", err);
        Alert.alert("Microphone error", err.message);
        handlePttOut();
      },
    });
  };

  const handlePttOut = async () => {
    if (!isTalking) return;
    ReactNativeHapticFeedback.trigger("impactLight", { enableVibrateFallback: true });

    await stopCapture();

    const sessionId = activePttSession.current;
    if (sessionId) {
      wsRef.current?.sendPttEnd(sessionId);
      activePttSession.current = null;
    }
    setIsTalking(false);
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#f9fafb" />

      <ConnectionBanner state={connState} queuedCount={queuedCount} />

      <View style={styles.header}>
        <Text style={styles.appName}>Carehome Walkie</Text>
        {displayName && <Text style={styles.userLabel}>You: {displayName}</Text>}
      </View>

      <PeerList peers={peers} activeSpeaker={activeSpeaker} />

      <View style={styles.pttArea}>
        <PTTButton
          onPressIn={handlePttIn}
          onPressOut={handlePttOut}
          isTalking={isTalking}
          disabled={connState === "disconnected"}
        />
        {connState === "disconnected" && (
          <Text style={styles.offlineHint}>
            Offline — press will be saved and sent when reconnected
          </Text>
        )}
      </View>

      <NameModal visible={showNameModal} onSubmit={handleNameSubmit} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  appName: {
    fontSize: 22,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.5,
  },
  userLabel: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 2,
  },
  pttArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  offlineHint: {
    color: "#ef4444",
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: 40,
    marginTop: 12,
  },
});
