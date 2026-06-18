import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Alert,
  Animated,
  Platform,
  Pressable,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import ReactNativeHapticFeedback from "react-native-haptic-feedback";
import { nanoid } from "nanoid/non-secure";

import { WsClient, ConnectionState } from "./src/network/wsClient";
import { ServerMessage, PeerInfo } from "./src/network/protocol";
import { requestMicPermission, startCapture, stopCapture } from "./src/audio/capture";
import { PcmChunk } from "./src/audio/pcmUtils";
import {
  initPlayback,
  receiveChunk,
  endSession,
  beginReceiveSession,
  setPlaybackWarningHandler,
  setSelfDisplayName,
  registerOwnedSession,
} from "./src/audio/playback";
import { telemetry } from "./src/observability";
import { useAppLifecycle } from "./src/lifecycle/appState";
import { ConnectionBanner } from "./src/ui/ConnectionBanner";
import { DebugPanel } from "./src/ui/DebugPanel";
import { ErrorBoundary } from "./src/ui/ErrorBoundary";
import { PTTButton } from "./src/ui/PTTButton";
import { PeerList } from "./src/ui/PeerList";
import { MessageHistory } from "./src/ui/MessageHistory";
import { NameModal } from "./src/ui/NameModal";
import { colors, radii } from "./src/ui/theme";
import { recordOutboundMessage, loadInbox, acknowledgeChannelMessages } from "./src/inbox/inboxRepository";
import { appQueryClient, invalidateInbox } from "./src/inbox/queryClient";
import { useInboxSync } from "./src/inbox/useInboxSync";
import { dedupePeersByName, isSameDisplayName } from "./src/network/peers";

const NAME_KEY = "display_name";

// ─── Cross-platform in-app toast ─────────────────────────────────────────────
function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  const show = useCallback(
    (msg: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setMessage(msg);
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.delay(1800),
        Animated.timing(opacity, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start();
      timerRef.current = setTimeout(() => setMessage(null), 2300);
    },
    [opacity]
  );

  const ToastView = message ? (
    <Animated.View style={[styles.toast, { opacity }]}>
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  ) : null;

  return { show, ToastView };
}

// ─── Main screen ─────────────────────────────────────────────────────────────
function WalkieScreen() {
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameModalMode, setNameModalMode] = useState<"welcome" | "edit">("welcome");
  const [connState, setConnState] = useState<ConnectionState>("disconnected");
  const [queuedCount, setQueuedCount] = useState(0);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [isTalking, setIsTalking] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);

  const wsRef = useRef<WsClient | null>(null);
  const activePttSession = useRef<string | null>(null);
  const outboundChunksRef = useRef<PcmChunk[]>([]);
  const isTalkingRef = useRef(false);
  const ignoredReplaySessionsRef = useRef<Set<string>>(new Set());
  const { show: showToast, ToastView } = useToast();
  const { applyServerHistory } = useInboxSync(displayName);
  const applyServerHistoryRef = useRef(applyServerHistory);
  useEffect(() => {
    applyServerHistoryRef.current = applyServerHistory;
  }, [applyServerHistory]);

  useEffect(() => {
    setSelfDisplayName(displayName);
    if (!displayName) return;
    void loadInbox().then((messages) => {
      if (messages.length > 0) {
        void acknowledgeChannelMessages(messages.map((message) => message.completedAt));
      }
      for (const message of messages) {
        if (message.isOutbound) registerOwnedSession(message.sessionId);
      }
    });
  }, [displayName]);

  /**
   * Ref-based message handler pattern.
   *
   * The WsClient is long-lived (lives for the duration of displayName being set).
   * If we passed handleServerMessage directly as onMessage, the client would
   * close over the initial closure — a stale closure bug that surfaces when
   * React re-renders cause the callback identity to change (e.g. showToast
   * stabilises but future additions might not).
   *
   * Using a ref as an indirection means WsClient always calls the *current*
   * handler without needing to be recreated on every render.
   */
  const handleServerMessageRef = useRef<(msg: ServerMessage) => void>(() => {});

  // ─── Lifecycle: initialise audio + permissions on mount ────────────────────
  useEffect(() => {
    AsyncStorage.getItem(NAME_KEY).then((name) => {
      if (name) {
        setDisplayName(name);
      } else {
        setNameModalMode("welcome");
        setShowNameModal(true);
      }
    });

    initPlayback().catch((err) => {
      telemetry.error("app", "playback_init_failed", {
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    });

    setPlaybackWarningHandler((warning) => {
      if (warning.type === "received_silent") {
        showToast(`Low audio signal (peak=${warning.peakAmplitude}) — check sender mic`);
      } else if (warning.type === "sample_rate_unknown") {
        showToast("Missing sample rate from sender — audio may sound wrong");
      } else if (warning.type === "chunks_incomplete") {
        showToast(`Playing ${warning.received}/${warning.expected} chunks (network delay)`);
      }
    });

    requestMicPermission().then((granted) => {
      if (!granted) {
        Alert.alert(
          "Microphone permission required",
          "Please allow microphone access in Settings to use the walkie-talkie."
        );
      }
    });

    return () => {
      setPlaybackWarningHandler(null);
    };
  }, [showToast]);

  // ─── Lifecycle: app background / foreground ─────────────────────────────────
  const handleBackground = useCallback(() => {
    // If the user leaves mid-transmission, end it cleanly.
    // Leaving the mic open in the background drains battery and confuses peers.
    if (isTalkingRef.current) {
      telemetry.warn("app", "ptt_interrupted_by_background", {
        message: "App backgrounded during PTT — ending transmission",
      });
      void handlePttOut();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleForeground = useCallback(() => {
    // The WsClient has its own reconnect loop, but it may have stalled if iOS
    // suspended the JS thread. Nudge it by checking readyState.
    const ws = wsRef.current;
    if (ws) {
      const state = ws.getState();
      if (state === "disconnected" || state === "reconnecting") {
        telemetry.info("app", "foreground_reconnect_nudge", { data: { state } });
        ws.connect();
      }
    }
  }, []);

  useAppLifecycle({ onBackground: handleBackground, onForeground: handleForeground });

  // ─── Lifecycle: WebSocket — reconnects when displayName changes ─────────────
  useEffect(() => {
    if (!displayName) return;

    const client = new WsClient(displayName, {
      onStateChange: (state, queued) => {
        setConnState(state);
        setQueuedCount(queued);
      },
      // Indirection via ref — see comment above handleServerMessageRef.
      onMessage: (msg) => handleServerMessageRef.current(msg),
      onPeers: (peers) => setPeers(dedupePeersByName(peers)),
    });

    wsRef.current = client;
    client.connect();

    return () => {
      client.destroy();
      wsRef.current = null;
    };
  }, [displayName]);

  // ─── Message handler ────────────────────────────────────────────────────────
  const handleServerMessage = useCallback(
    (msg: ServerMessage) => {
      const isOwnSpeaker = (fromName: string) =>
        displayName != null && isSameDisplayName(fromName, displayName);

      switch (msg.type) {
        case "peer_joined":
          setPeers((prev) => {
            const staleSpeaker = prev.find(
              (p) => p.name === msg.peer.name && p.id !== msg.peer.id
            );
            if (staleSpeaker) {
              setActiveSpeaker((current) => (current === staleSpeaker.id ? null : current));
            }
            return dedupePeersByName([
              ...prev.filter((p) => p.id !== msg.peer.id && p.name !== msg.peer.name),
              msg.peer,
            ]);
          });
          showToast(`${msg.peer.name} joined`);
          telemetry.info("app", "peer_joined", { data: { name: msg.peer.name } });
          break;

        case "peer_left":
          setPeers((prev) => prev.filter((p) => p.id !== msg.peerId));
          setActiveSpeaker((prev) => (prev === msg.peerId ? null : prev));
          break;

        case "ptt_start":
          if (isOwnSpeaker(msg.from.name)) break;
          if (msg.replay) {
            ignoredReplaySessionsRef.current.add(msg.sessionId);
            break;
          }
          setActiveSpeaker(msg.from.id);
          showToast(`${msg.from.name} is speaking`);
          telemetry.metric("pttSessionsReceived");
          beginReceiveSession(msg.sessionId, msg.from);
          break;

        case "audio_chunk":
          if (isOwnSpeaker(msg.from.name)) break;
          if (msg.replay || ignoredReplaySessionsRef.current.has(msg.sessionId)) break;
          receiveChunk(msg.sessionId, msg.seq, msg.pcmBase64, msg.from).catch((err) => {
            telemetry.error("playback", "receive_chunk_failed", {
              sessionId: msg.sessionId,
              data: { error: err instanceof Error ? err.message : String(err) },
            });
          });
          break;

        case "ptt_end":
          if (isOwnSpeaker(msg.from.name)) break;
          if (msg.replay || ignoredReplaySessionsRef.current.has(msg.sessionId)) {
            ignoredReplaySessionsRef.current.delete(msg.sessionId);
            break;
          }
          endSession(
            msg.sessionId,
            msg.sampleRate,
            msg.chunkCount,
            msg.completedAt,
            msg.from
          ).catch((err) => {
            telemetry.error("playback", "end_session_failed", {
              sessionId: msg.sessionId,
              data: { error: err instanceof Error ? err.message : String(err) },
            });
          });
          if (!msg.replay) {
            setActiveSpeaker((prev) => (prev === msg.from.id ? null : prev));
          }
          break;

        case "history_sync":
          void applyServerHistoryRef.current(msg.messages);
          break;
      }
    },
    [displayName, showToast]
  );

  // Keep the ref in sync with the latest closure on every render.
  useEffect(() => {
    handleServerMessageRef.current = handleServerMessage;
  });

  // ─── Name management ────────────────────────────────────────────────────────
  const handleNameSubmit = async (name: string) => {
    await AsyncStorage.setItem(NAME_KEY, name);
    setDisplayName(name);
    setShowNameModal(false);
    if (nameModalMode === "edit") {
      showToast(`Name updated to ${name}`);
    }
  };

  const openEditName = () => {
    setNameModalMode("edit");
    setShowNameModal(true);
  };

  const closeNameModal = () => {
    setShowNameModal(false);
    if (!displayName) {
      setNameModalMode("welcome");
    }
  };

  // ─── PTT ───────────────────────────────────────────────────────────────────
  const handlePttIn = async () => {
    if (isTalkingRef.current || !wsRef.current) return;

    isTalkingRef.current = true;
    ReactNativeHapticFeedback.trigger("impactMedium", { enableVibrateFallback: true });
    const sessionId = nanoid(8);
    activePttSession.current = sessionId;
    registerOwnedSession(sessionId);
    setIsTalking(true);

    wsRef.current.sendPttStart(sessionId);
    outboundChunksRef.current = [];

    try {
      await startCapture(sessionId, (chunk) => {
        outboundChunksRef.current.push(chunk);
        if (wsRef.current && activePttSession.current === sessionId) {
          wsRef.current.sendAudioChunk(sessionId, chunk.seq, chunk.pcmBase64);
        }
      });
    } catch (err) {
      telemetry.error("app", "capture_start_failed", {
        sessionId,
        data: { error: err instanceof Error ? err.message : String(err) },
      });
      Alert.alert("Microphone error", err instanceof Error ? err.message : String(err));
      await handlePttOut();
    }
  };

  const handlePttOut = async () => {
    if (!isTalkingRef.current) return;

    ReactNativeHapticFeedback.trigger("impactLight", { enableVibrateFallback: true });

    const sessionId = activePttSession.current;
    const capture = await stopCapture(sessionId ?? undefined);

    isTalkingRef.current = false;
    setIsTalking(false);
    activePttSession.current = null;

    if (!sessionId || !wsRef.current) return;

    if (capture.chunksSent === 0) {
      telemetry.warn("ptt", "no_audio_to_send", {
        sessionId,
        data: {
          pcmBytes: capture.pcmBytes,
          peakAmplitude: capture.peakAmplitude,
          bufferCount: capture.bufferCount,
        },
        message: "PTT ended with no audio — emulator mic issue or hold too short",
      });
      showToast("No audio captured — hold longer or check mic");
    } else {
      const outboundChunks =
        outboundChunksRef.current.length > 0
          ? outboundChunksRef.current
          : capture.chunks;

      if (displayName && outboundChunks.length > 0) {
        await recordOutboundMessage({
          sessionId,
          senderName: displayName,
          sampleRate: capture.sampleRate,
          chunkCount: capture.chunksSent,
          chunks: outboundChunks,
          durationMs: capture.durationMs,
        });
        invalidateInbox();
      }

      for (const chunk of capture.chunks) {
        wsRef.current.sendAudioChunk(sessionId, chunk.seq, chunk.pcmBase64);
      }
      telemetry.session("sender", sessionId, {
        chunksSent: capture.chunksSent,
        pcmBytes: capture.pcmBytes,
        peakAmplitude: capture.peakAmplitude,
        durationMs: capture.durationMs,
        sampleRate: capture.sampleRate,
      });
    }

    wsRef.current.sendPttEnd(sessionId, capture.sampleRate, capture.chunksSent);
    outboundChunksRef.current = [];
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      <ConnectionBanner state={connState} queuedCount={queuedCount} />

      <View style={styles.header}>
        <Text style={styles.appName}>Carehome Walkie</Text>
        {displayName ? (
          <Pressable
            onPress={openEditName}
            style={({ pressed }) => [styles.nameRow, pressed && styles.nameRowPressed]}
            accessibilityRole="button"
            accessibilityLabel="Change display name"
          >
            <Text style={styles.userLabel}>You: {displayName}</Text>
            <Text style={styles.editHint}>Edit</Text>
          </Pressable>
        ) : null}
      </View>

      <PeerList peers={peers} activeSpeaker={activeSpeaker} />

      <MessageHistory />

      <View style={styles.pttArea}>
        {/* PTT is always enabled. When disconnected the session is persisted to
            AsyncStorage and replayed automatically once the connection is restored,
            satisfying the "never quietly loses what someone said" requirement. */}
        <PTTButton
          onPressIn={handlePttIn}
          onPressOut={handlePttOut}
          isTalking={isTalking}
          willQueue={connState === "disconnected"}
        />
      </View>

      {ToastView}

      {__DEV__ ? <DebugPanel /> : null}

      <NameModal
        visible={showNameModal}
        mode={nameModalMode}
        initialName={displayName ?? ""}
        onSubmit={handleNameSubmit}
        onCancel={nameModalMode === "edit" ? closeNameModal : undefined}
      />
    </SafeAreaView>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={appQueryClient}>
        <ErrorBoundary>
          <WalkieScreen />
        </ErrorBoundary>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  appName: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text.primary,
    letterSpacing: -0.5,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    alignSelf: "flex-start",
    paddingVertical: 2,
    paddingRight: 8,
  },
  nameRowPressed: {
    opacity: 0.65,
  },
  userLabel: {
    fontSize: 13,
    color: colors.text.secondary,
  },
  editHint: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: "600",
    marginLeft: 8,
  },
  pttArea: {
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 24,
    paddingTop: 8,
  },
  toast: {
    position: "absolute",
    bottom: Platform.OS === "ios" ? 48 : 32,
    alignSelf: "center",
    backgroundColor: colors.toast,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radii.full,
    maxWidth: "80%",
  },
  toastText: {
    color: colors.text.inverse,
    fontSize: 13,
    textAlign: "center",
  },
});
