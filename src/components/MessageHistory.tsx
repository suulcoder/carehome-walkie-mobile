import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMessageInbox } from "../features/inbox/useMessageInbox";
import { StoredMessage } from "../features/inbox/types";
import { avatarColor, colors, initials, radii, shadows, spacing, typography } from "../theme";
import { MessageIcon, PlayIcon } from "../theme/icons";

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

function playStatusLabel(message: StoredMessage): string {
  if (message.isOutbound) return "Sent";
  return message.playedAt == null ? "Unplayed" : "Played";
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
  const senderName = displaySenderName(message);
  const bg = message.isOutbound ? colors.primary : avatarColor(message.fromName);

  return (
    <Pressable
      onPress={onReplay}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        disabled && styles.rowDisabled,
        unplayed && !message.isOutbound && styles.rowUnplayed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Replay message from ${senderName}`}
    >
      <View style={[styles.avatar, { backgroundColor: bg }]}>
        <Text style={styles.avatarText}>{initials(senderName)}</Text>
      </View>

      <View style={styles.rowMain}>
        <View style={styles.titleRow}>
          <Text style={styles.fromName} numberOfLines={1}>
            {senderName}
          </Text>
          <View style={styles.durationChip}>
            <Text style={styles.duration}>{formatDuration(message.durationMs)}</Text>
          </View>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{formatWhen(message.completedAt)}</Text>
          <Text
            style={[
              styles.playStatus,
              unplayed && !message.isOutbound && styles.playStatusUnplayed,
            ]}
          >
            {playStatusLabel(message)}
          </Text>
        </View>
      </View>

      <View style={styles.playButton}>
        <PlayIcon size={14} color={colors.primary} />
      </View>
    </Pressable>
  );
}

interface MessageHistoryProps {
  replayDisabled?: boolean;
}

export function MessageHistory({ replayDisabled = false }: MessageHistoryProps) {
  const { messages, unplayedCount, isLoading, replayMessage, isReplaying } = useMessageInbox();
  const disabled = replayDisabled || isReplaying;

  if (isLoading) {
    return (
      <View style={styles.card}>
        <View style={styles.body}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (messages.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={[styles.heading, styles.headingSpaced]}>Recent messages</Text>
        <View style={styles.body}>
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <MessageIcon size={26} color={colors.text.muted} />
            </View>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.empty}>
              Received messages will appear here for replay
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Recent messages</Text>
        {unplayedCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unplayedCount} new</Text>
          </View>
        ) : null}
      </View>
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        {messages.map((message) => (
          <MessageRow
            key={message.sessionId}
            message={message}
            onReplay={() => replayMessage(message)}
            disabled={disabled}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    ...shadows.sm,
  },
  body: {
    flex: 1,
    minHeight: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    flexShrink: 0,
  },
  headingSpaced: {
    marginBottom: spacing.md,
  },
  heading: {
    ...typography.section,
    color: colors.text.secondary,
    flexShrink: 0,
  },
  badge: {
    backgroundColor: colors.primaryMuted,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.full,
  },
  badgeText: {
    ...typography.label,
    color: colors.primaryDark,
    fontSize: 11,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.bodyStrong,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  empty: {
    color: colors.text.muted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: radii.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  rowUnplayed: {
    borderColor: colors.primaryMuted,
    backgroundColor: "#F7FAF8",
  },
  rowPressed: {
    opacity: 0.75,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  avatarText: {
    color: colors.text.inverse,
    fontSize: 12,
    fontWeight: "700",
  },
  rowMain: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  fromName: {
    flex: 1,
    ...typography.bodyStrong,
    color: colors.text.primary,
  },
  durationChip: {
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.full,
  },
  duration: {
    ...typography.label,
    color: colors.text.secondary,
    fontSize: 11,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: 2,
  },
  meta: {
    fontSize: 12,
    color: colors.text.muted,
    lineHeight: 16,
  },
  playStatus: {
    ...typography.label,
    fontSize: 11,
    color: colors.text.muted,
  },
  playStatusUnplayed: {
    color: colors.primaryDark,
  },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: radii.full,
    backgroundColor: colors.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: spacing.sm,
  },
});
