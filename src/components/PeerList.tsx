import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, ScrollView } from "react-native";
import { PeerInfo } from "../services/websocket/protocol";
import { avatarColor, colors, initials, radii, shadows, spacing, typography } from "../theme";
import { UsersIcon } from "../theme/icons";

interface Props {
  peers: PeerInfo[];
  activeSpeaker: string | null;
}

function PeerAvatar({ name, isSpeaking }: { name: string; isSpeaking: boolean }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isSpeaking) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.12, duration: 600, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    Animated.timing(pulse, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [isSpeaking, pulse]);

  const bg = avatarColor(name);

  return (
    <View style={styles.avatarWrap}>
      {isSpeaking ? (
        <Animated.View
          style={[
            styles.speakingRing,
            { transform: [{ scale: pulse }], borderColor: colors.transmit },
          ]}
        />
      ) : null}
      <View style={[styles.avatar, { backgroundColor: bg }]}>
        <Text style={styles.avatarText}>{initials(name)}</Text>
      </View>
    </View>
  );
}

export function PeerList({ peers, activeSpeaker }: Props) {
  if (peers.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={[styles.heading, styles.headingSpaced]}>On channel</Text>
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <UsersIcon size={24} color={colors.text.muted} />
          </View>
          <Text style={styles.empty}>No one else on the channel yet</Text>
        </View>
      </View>
    );
  }

  const peerRows = peers.map((peer) => {
    const isSpeaking = peer.id === activeSpeaker;
    return (
      <View key={peer.id} style={[styles.row, isSpeaking && styles.rowActive]}>
        <PeerAvatar name={peer.name} isSpeaking={isSpeaking} />
        <View style={styles.rowContent}>
          <Text style={[styles.name, isSpeaking && styles.nameActive]} numberOfLines={1}>
            {peer.name}
          </Text>
          {isSpeaking ? (
            <View style={styles.speakingBadge}>
              <View style={styles.speakingDot} />
              <Text style={styles.speaking}>Speaking</Text>
            </View>
          ) : (
            <Text style={styles.status}>Available</Text>
          )}
        </View>
      </View>
    );
  });

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>On channel</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{peers.length}</Text>
        </View>
      </View>
      {peers.length <= 3 ? (
        peerRows
      ) : (
        <ScrollView
          style={styles.peerScroll}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {peerRows}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexShrink: 0,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    ...shadows.sm,
  },
  peerScroll: {
    maxHeight: 168,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  heading: {
    ...typography.section,
    color: colors.text.secondary,
  },
  headingSpaced: {
    marginBottom: spacing.sm,
  },
  countBadge: {
    backgroundColor: colors.surfaceMuted,
    minWidth: 24,
    height: 24,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  countText: {
    ...typography.label,
    color: colors.text.secondary,
    fontSize: 12,
  },
  emptyState: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  emptyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    ...typography.bodyStrong,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  empty: {
    flex: 1,
    color: colors.text.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    marginBottom: spacing.xs,
  },
  rowActive: {
    backgroundColor: colors.transmitMuted,
  },
  avatarWrap: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  speakingRing: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: colors.text.inverse,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  rowContent: {
    flex: 1,
  },
  name: {
    ...typography.bodyStrong,
    color: colors.text.primary,
  },
  nameActive: {
    color: colors.transmitDark,
  },
  status: {
    ...typography.label,
    color: colors.text.muted,
    marginTop: 2,
    fontWeight: "500",
  },
  speakingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 2,
  },
  speakingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.transmit,
  },
  speaking: {
    ...typography.label,
    color: colors.transmit,
    fontWeight: "600",
  },
});
