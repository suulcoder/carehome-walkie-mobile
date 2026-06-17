import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  getMetricCounters,
  getRecentLogs,
  getSessionTraces,
  subscribeTelemetry,
} from "../observability";
import { colors, radii } from "./theme";

export function DebugPanel() {
  const [, tick] = useState(0);

  useEffect(() => {
    return subscribeTelemetry(() => tick((n) => n + 1));
  }, []);

  const metrics = getMetricCounters();
  const logs = getRecentLogs(12);
  const traces = getSessionTraces().slice(0, 4);

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Debug telemetry</Text>
      <Text style={styles.metrics}>
        TX chunks {metrics.audioChunksSent} · RX chunks {metrics.audioChunksReceived} · play OK{" "}
        {metrics.playbackSuccess}/{metrics.playbackAttempts} · play fail {metrics.playbackFailures}
        {metrics.playbackSilentReceived > 0
          ? ` · silent ${metrics.playbackSilentReceived}`
          : ""}
      </Text>

      {traces.map((trace) => (
        <Text key={trace.sessionId} style={styles.trace} numberOfLines={2}>
          {trace.role} {trace.sessionId.slice(0, 6)} · {trace.status}
          {trace.chunksSent != null ? ` · tx=${trace.chunksSent}` : ""}
          {trace.chunksReceived != null ? ` · rx=${trace.chunksReceived}` : ""}
          {trace.peakAmplitude != null ? ` · peak=${trace.peakAmplitude}` : ""}
          {trace.failureReason ? ` · ${trace.failureReason}` : ""}
        </Text>
      ))}

      <ScrollView style={styles.logScroll} nestedScrollEnabled>
        {logs.map((entry) => (
          <Text key={entry.id} style={styles.logLine} numberOfLines={2}>
            [{entry.category}] {entry.event}
            {entry.sessionId ? ` ${entry.sessionId.slice(0, 6)}` : ""}
            {entry.data ? ` ${JSON.stringify(entry.data)}` : ""}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
    borderRadius: radii.md,
    backgroundColor: colors.debug.background,
    maxHeight: 180,
  },
  title: {
    color: colors.debug.title,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 4,
  },
  metrics: {
    color: colors.debug.text,
    fontSize: 10,
    marginBottom: 6,
  },
  trace: {
    color: colors.debug.trace,
    fontSize: 9,
    fontFamily: "Menlo",
    marginBottom: 2,
  },
  logScroll: {
    maxHeight: 90,
  },
  logLine: {
    color: colors.debug.log,
    fontSize: 9,
    fontFamily: "Menlo",
    marginBottom: 2,
  },
});
