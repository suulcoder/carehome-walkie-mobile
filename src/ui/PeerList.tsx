import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { PeerInfo } from "../network/protocol";
import { colors, radii } from "./theme";

interface Props {
  peers: PeerInfo[];
  activeSpeaker: string | null;
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
    color: colors.text.secondary,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  empty: {
    color: colors.text.muted,
    fontSize: 14,
    textAlign: "center",
    fontStyle: "italic",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radii.sm,
    marginBottom: 4,
    backgroundColor: colors.surfaceMuted,
  },
  rowActive: {
    backgroundColor: colors.transmitMuted,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border.default,
    marginRight: 10,
  },
  dotActive: {
    backgroundColor: colors.transmit,
  },
  name: {
    fontSize: 15,
    color: colors.text.primary,
    flex: 1,
  },
  nameActive: {
    fontWeight: "700",
    color: colors.transmitDark,
  },
  speaking: {
    fontSize: 12,
    color: colors.transmit,
    fontStyle: "italic",
  },
});
