import React from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { ConnectionState } from "../network/wsClient";

interface Props {
  state: ConnectionState;
  queuedCount: number;
}

const STATE_CONFIG: Record<ConnectionState, { color: string; label: string }> = {
  connected: { color: "#22c55e", label: "Connected" },
  connecting: { color: "#f59e0b", label: "Connecting…" },
  reconnecting: { color: "#f59e0b", label: "Reconnecting…" },
  disconnected: { color: "#ef4444", label: "Offline" },
};

export function ConnectionBanner({ state, queuedCount }: Props) {
  const { color, label } = STATE_CONFIG[state];

  return (
    <View style={[styles.banner, { backgroundColor: color }]}>
      <Text style={styles.label}>{label}</Text>
      {queuedCount > 0 && (
        <Text style={styles.queue}>
          {queuedCount} message{queuedCount !== 1 ? "s" : ""} queued
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    width: "100%",
    paddingVertical: 6,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
    letterSpacing: 0.3,
  },
  queue: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
  },
});
