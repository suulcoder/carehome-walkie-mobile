import React, { useRef, useEffect } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  GestureResponderEvent,
} from "react-native";
import { colors, radii, shadows, spacing, typography } from "../theme";
import { MicIcon } from "../theme/icons";

interface Props {
  onPressIn: (e: GestureResponderEvent) => void;
  onPressOut: (e: GestureResponderEvent) => void;
  isTalking: boolean;
  /**
   * When true the button is fully interactive but the press will be queued
   * for delivery once connectivity is restored — not transmitted live.
   * The button shows an amber "WILL QUEUE" state to communicate this.
   */
  willQueue?: boolean;
  disabled?: boolean;
}

export function PTTButton({ onPressIn, onPressOut, isTalking, willQueue, disabled }: Props) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ringAnim = useRef(new Animated.Value(0.85)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const ringLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isTalking) {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.06, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      ringLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(ringAnim, { toValue: 1.18, duration: 700, useNativeDriver: true }),
          Animated.timing(ringAnim, { toValue: 0.92, duration: 700, useNativeDriver: true }),
        ])
      );
      pulseLoop.current.start();
      ringLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      ringLoop.current?.stop();
      Animated.parallel([
        Animated.timing(pulseAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(ringAnim, { toValue: 0.85, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [isTalking, pulseAnim, ringAnim]);

  const buttonColor = isTalking
    ? colors.transmit
    : willQueue
      ? colors.warning
      : colors.primary;

  const ringColor = isTalking
    ? colors.transmitMuted
    : willQueue
      ? colors.warningMuted
      : colors.primaryMuted;

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.outerRing,
          {
            backgroundColor: ringColor,
            transform: [{ scale: ringAnim }],
            opacity: isTalking ? 0.9 : 0.55,
          },
        ]}
      />
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <Pressable
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          disabled={disabled}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: buttonColor },
            pressed && styles.buttonPressed,
            disabled && styles.buttonDisabled,
          ]}
        >
          <View style={styles.iconCircle}>
            <MicIcon size={28} color={colors.text.inverse} />
          </View>
          <Text style={styles.label}>
            {isTalking ? "TALKING" : willQueue ? "WILL QUEUE" : "PUSH TO TALK"}
          </Text>
          <Text style={styles.hint}>
            {isTalking ? "Release to send" : willQueue ? "Sent when reconnected" : "Hold to speak"}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const BUTTON_SIZE = 196;

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    width: BUTTON_SIZE + 48,
    height: BUTTON_SIZE + 48,
  },
  outerRing: {
    position: "absolute",
    width: BUTTON_SIZE + 36,
    height: BUTTON_SIZE + 36,
    borderRadius: (BUTTON_SIZE + 36) / 2,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.lg,
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    backgroundColor: colors.text.muted,
    elevation: 0,
    shadowOpacity: 0,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  label: {
    color: colors.text.inverse,
    fontWeight: "800",
    fontSize: 15,
    letterSpacing: 1.2,
  },
  hint: {
    color: "rgba(255,255,255,0.8)",
    ...typography.label,
    fontWeight: "500",
    marginTop: spacing.xs,
    fontSize: 11,
  },
});
