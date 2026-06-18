import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { ConnectionState } from "../services/websocket/wsClient";
import { colors, radii, spacing, typography } from "../theme";
import { StatusDot } from "../theme/icons";

interface Props {
  state: ConnectionState;
  queuedCount: number;
}

const STATE_CONFIG: Record<
  ConnectionState,
  { dotColor: string; bgColor: string; textColor: string; label: string }
> = {
  connected: {
    dotColor: colors.success,
    bgColor: colors.successMuted,
    textColor: colors.success,
    label: "Connected",
  },
  connecting: {
    dotColor: colors.warning,
    bgColor: colors.warningMuted,
    textColor: colors.warning,
    label: "Connecting…",
  },
  reconnecting: {
    dotColor: colors.warning,
    bgColor: colors.warningMuted,
    textColor: colors.warning,
    label: "Reconnecting…",
  },
  disconnected: {
    dotColor: colors.error,
    bgColor: colors.errorMuted,
    textColor: colors.error,
    label: "Offline",
  },
};

export function ConnectionBanner({ state, queuedCount }: Props) {
  const config = STATE_CONFIG[state];

  return (
    <View style={styles.container}>
      <View style={[styles.chip, { backgroundColor: config.bgColor }]}>
        <StatusDot color={config.dotColor} size={7} />
        <Text style={[styles.chipLabel, { color: config.textColor }]}>{config.label}</Text>
      </View>
      {queuedCount > 0 ? (
        <View style={styles.queueChip}>
          <Text style={styles.queueText} numberOfLines={1}>
            {queuedCount} message{queuedCount !== 1 ? "s" : ""} queued
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "flex-end",
    gap: spacing.xs,
    flexShrink: 1,
    maxWidth: "45%",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.full,
  },
  chipLabel: {
    ...typography.label,
    fontSize: 12,
  },
  queueChip: {
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.full,
    maxWidth: "100%",
  },
  queueText: {
    ...typography.label,
    color: colors.text.secondary,
    fontSize: 11,
  },
});
