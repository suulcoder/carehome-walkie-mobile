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
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import ReactNativeHapticFeedback from "react-native-haptic-feedback";
import { nanoid } from "nanoid/non-secure";

import { WsClient, ConnectionState } from "../services/websocket/wsClient";
import { ServerMessage, PeerInfo } from "../services/websocket/protocol";
import { requestMicPermission, startCapture, stopCapture } from "../services/audio/capture";
import { PcmChunk } from "../services/audio/pcmUtils";
import {
  initPlayback,
  receiveChunk,
  endSession,
  beginReceiveSession,
  setPlaybackWarningHandler,
  setSelfDisplayName,
  registerOwnedSession,
} from "../services/audio/playback";
import { telemetry } from "../lib/observability";
import { useAppLifecycle } from "../hooks/useAppLifecycle";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { DebugPanel } from "../components/DebugPanel";
import { NameModal } from "../components/NameModal";
import { PTTButton } from "../components/PTTButton";
import { PeerList } from "../components/PeerList";
import { MessageHistory } from "../components/MessageHistory";
import { colors, radii, shadows, spacing, typography } from "../theme";
import { PTT_TAIL_RECORD_MS, SHOW_DEBUG_TELEMETRY } from "../config";
import {
  recordOutboundMessage,
  loadInbox,
  acknowledgeChannelMessages,
} from "../features/inbox/inboxRepository";
import { invalidateInbox } from "../features/inbox/queryClient";
import { useInboxSync } from "../features/inbox/useInboxSync";
import { dedupePeersByName, isSameDisplayName } from "../services/websocket/peers";

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
    <Animated.View style={[styles.toastWrap, { opacity }]}>
      <View style={styles.toast}>
        <Text style={styles.toastText}>{message}</Text>
      </View>
    </Animated.View>
  ) : null;

  return { show, ToastView };
}

// ─── Main screen ─────────────────────────────────────────────────────────────
export function WalkieScreen() {
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameModalMode, setNameModalMode] = useState<"welcome" | "edit">("welcome");
  const [connState, setConnState] = useState<ConnectionState>("disconnected");
  const [queuedCount, setQueuedCount] = useState(0);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [isTalking, setIsTalking] = useState(false);
  const [isFinalizingPtt, setIsFinalizingPtt] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);

  const wsRef = useRef<WsClient | null>(null);
  const activePttSession = useRef<string | null>(null);
  const outboundChunksRef = useRef<PcmChunk[]>([]);
  const isTalkingRef = useRef(false);
  const pttEndingRef = useRef(false);
  const queuedCountRef = useRef(0);
  const ignoredReplaySessionsRef = useRef<Set<string>>(new Set());
  const { show: showToast, ToastView } = useToast();
  const { applyServerHistory } = useInboxSync(displayName);
  const applyServerHistoryRef = useRef(applyServerHistory);
  useEffect(() => {
    applyServerHistoryRef.current = applyServerHistory;
  }, [applyServerHistory]);

  useEffect(() => {
    queuedCountRef.current = queuedCount;
  }, [queuedCount]);

  const isOutboundBusy = isFinalizingPtt || queuedCount > 0;

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
    if (
      isTalkingRef.current ||
      pttEndingRef.current ||
      queuedCountRef.current > 0 ||
      !wsRef.current
    ) {
      return;
    }

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
    if (!isTalkingRef.current || pttEndingRef.current) return;

    pttEndingRef.current = true;
    setIsFinalizingPtt(true);
    ReactNativeHapticFeedback.trigger("impactLight", { enableVibrateFallback: true });
    setIsTalking(false);

    const sessionId = activePttSession.current;

    try {
      if (PTT_TAIL_RECORD_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, PTT_TAIL_RECORD_MS));
      }

      if (activePttSession.current !== sessionId) return;

      const capture = await stopCapture(sessionId ?? undefined);

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
    } finally {
      isTalkingRef.current = false;
      pttEndingRef.current = false;
      setIsFinalizingPtt(false);
      activePttSession.current = null;
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.appName}>Carehome Walkie</Text>
            <Text style={styles.appTagline}>Team voice channel</Text>
          </View>
          <ConnectionBanner state={connState} queuedCount={queuedCount} />
        </View>
        {displayName ? (
          <Pressable
            onPress={openEditName}
            style={({ pressed }) => [styles.nameChip, pressed && styles.nameChipPressed]}
            accessibilityRole="button"
            accessibilityLabel="Change display name"
          >
            <View style={styles.nameChipDot} />
            <Text style={styles.userLabel}>{displayName}</Text>
            <Text style={styles.editHint}>Edit</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.content}>
        <PeerList peers={peers} activeSpeaker={activeSpeaker} />
        <MessageHistory replayDisabled={isTalking} />
      </View>

      <View style={styles.pttArea}>
        {/* PTT unlocks only after the server acks the outbound message (queuedCount === 0).
            While disconnected, the session is persisted and replayed on reconnect. */}
        <PTTButton
          onPressIn={handlePttIn}
          onPressOut={handlePttOut}
          isTalking={isTalking}
          isSending={isOutboundBusy}
          willQueue={connState !== "connected"}
        />
      </View>

      {ToastView}

      {SHOW_DEBUG_TELEMETRY ? <DebugPanel /> : null}

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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  appName: {
    ...typography.title,
    fontSize: 22,
    color: colors.text.primary,
  },
  appTagline: {
    ...typography.label,
    color: colors.text.muted,
    marginTop: 2,
    fontWeight: "500",
    fontSize: 12,
  },
  nameChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: spacing.md,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    ...shadows.sm,
    gap: spacing.sm,
  },
  nameChipPressed: {
    opacity: 0.7,
  },
  nameChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  userLabel: {
    ...typography.bodyStrong,
    fontSize: 14,
    color: colors.text.primary,
  },
  editHint: {
    ...typography.label,
    color: colors.primary,
    fontSize: 12,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  pttArea: {
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: spacing.xl,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    ...shadows.sm,
  },
  toastWrap: {
    position: "absolute",
    bottom: Platform.OS === "ios" ? 56 : 40,
    left: spacing.lg,
    right: spacing.lg,
    alignItems: "center",
  },
  toast: {
    backgroundColor: colors.toast,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    maxWidth: "92%",
    ...shadows.md,
  },
  toastText: {
    color: colors.text.inverse,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
});
