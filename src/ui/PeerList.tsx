import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { PeerInfo } from "../network/protocol";

interface Props {
  peers: PeerInfo[];
  activeSpeaker: string | null; // clientId of peer currently talking
}

export function PeerList({ peers, activeSpeaker }: Props) {
  if (peers.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>No one else on the channel yet</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>On channel</Text>
      {peers.map((peer) => {
        const isSpeaking = peer.id === activeSpeaker;
        return (
          <View key={peer.id} style={[styles.row, isSpeaking && styles.rowActive]}>
            <View style={[styles.dot, isSpeaking && styles.dotActive]} />
            <Text style={[styles.name, isSpeaking && styles.nameActive]}>{peer.name}</Text>
            {isSpeaking && <Text style={styles.speaking}>speaking…</Text>}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  heading: {
    fontSize: 11,
    fontWeight: "700",
    color: "#6b7280",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  empty: {
    color: "#9ca3af",
    fontSize: 14,
    textAlign: "center",
    fontStyle: "italic",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
    backgroundColor: "#f3f4f6",
  },
  rowActive: {
    backgroundColor: "#fef9c3",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#d1d5db",
    marginRight: 10,
  },
  dotActive: {
    backgroundColor: "#16a34a",
  },
  name: {
    fontSize: 15,
    color: "#111827",
    flex: 1,
  },
  nameActive: {
    fontWeight: "700",
  },
  speaking: {
    fontSize: 12,
    color: "#16a34a",
    fontStyle: "italic",
  },
});
