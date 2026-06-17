import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMessageInbox } from "../inbox/useMessageInbox";
import { StoredMessage } from "../inbox/types";
import { colors, radii } from "./theme";

function formatWhen(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(durationMs: number): string {
  const sec = Math.max(1, Math.round(durationMs / 1000));
  return `${sec}s`;
}

function displaySenderName(message: StoredMessage): string {
  return message.isOutbound ? "You" : message.fromName;
}

function MessageRow({
  message,
  onReplay,
  disabled,
}: {
  message: StoredMessage;
  onReplay: () => void;
  disabled: boolean;
}) {
  const unplayed = message.playedAt == null;

  return (
    <Pressable
      onPress={onReplay}
      disabled={disabled}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, disabled && styles.rowDisabled]}
      accessibilityRole="button"
      accessibilityLabel={`Replay message from ${displaySenderName(message)}`}
    >
      <View style={styles.rowMain}>
        <View style={styles.titleRow}>
          {unplayed && !message.isOutbound ? <View style={styles.unplayedDot} /> : null}
          <Text style={styles.fromName} numberOfLines={1}>
            {displaySenderName(message)}
          </Text>
          <Text style={styles.duration}>{formatDuration(message.durationMs)}</Text>
        </View>
        <Text style={styles.meta}>
          {formatWhen(message.completedAt)}
          {message.isOutbound
            ? " · Sent"
            : unplayed
              ? " · New"
              : message.lastReplayedAt
                ? " · Replay available"
                : ""}
        </Text>
      </View>
      <Text style={styles.replayLabel}>▶</Text>
    </Pressable>
  );
}

export function MessageHistory() {
  const { messages, unplayedCount, isLoading, replayMessage, isReplaying } = useMessageInbox();

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (messages.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>Recent messages</Text>
        <Text style={styles.empty}>No messages yet — they will appear here after you receive them.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Recent messages</Text>
        {unplayedCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unplayedCount} new</Text>
          </View>
        ) : null}
      </View>
      <ScrollView style={styles.list} nestedScrollEnabled showsVerticalScrollIndicator={false}>
        {messages.map((message) => (
          <MessageRow
            key={message.sessionId}
            message={message}
            onReplay={() => replayMessage(message)}
            disabled={isReplaying}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  heading: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.text.secondary,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  badge: {
    backgroundColor: colors.primaryMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.full,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.primaryDark,
  },
  empty: {
    color: colors.text.muted,
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 18,
  },
  list: {
    maxHeight: 220,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  rowPressed: {
    opacity: 0.75,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowMain: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  unplayedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  fromName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: colors.text.primary,
  },
  duration: {
    fontSize: 12,
    color: colors.text.secondary,
    fontWeight: "600",
  },
  meta: {
    marginTop: 2,
    fontSize: 12,
    color: colors.text.muted,
  },
  replayLabel: {
    fontSize: 16,
    color: colors.primary,
    marginLeft: 10,
  },
});
