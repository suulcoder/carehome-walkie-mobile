import React, { useRef, useEffect } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  GestureResponderEvent,
} from "react-native";
import { colors } from "./theme";

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

function MicIcon({ active }: { active: boolean }) {
  return (
    <View style={styles.micWrap}>
      <View style={[styles.micHead, active && styles.micHeadActive]} />
      <View style={[styles.micStem, active && styles.micStemActive]} />
      <View style={[styles.micBase, active && styles.micBaseActive]} />
    </View>
  );
}

export function PTTButton({ onPressIn, onPressOut, isTalking, willQueue, disabled }: Props) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isTalking) {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 400, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        ])
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      Animated.timing(pulseAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    }
  }, [isTalking, pulseAnim]);

  return (
    <View style={styles.container}>
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <Pressable
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          disabled={disabled}
          style={({ pressed }) => [
            styles.button,
            isTalking && styles.buttonActive,
            willQueue && !isTalking && styles.buttonQueued,
            pressed && styles.buttonPressed,
            disabled && styles.buttonDisabled,
          ]}
        >
          <MicIcon active={isTalking} />
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

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  button: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.shadow,
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 12,
    elevation: 12,
  },
  buttonActive: {
    backgroundColor: colors.transmit,
  },
  buttonQueued: {
    backgroundColor: colors.warning,
  },
  buttonPressed: {
    opacity: 0.88,
  },
  buttonDisabled: {
    backgroundColor: colors.text.muted,
    elevation: 0,
  },
  micWrap: {
    alignItems: "center",
    marginBottom: 10,
  },
  micHead: {
    width: 22,
    height: 32,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.95)",
    marginBottom: 3,
  },
  micHeadActive: {
    backgroundColor: colors.text.inverse,
  },
  micStem: {
    width: 3,
    height: 8,
    backgroundColor: "rgba(255,255,255,0.85)",
    marginBottom: 2,
  },
  micStemActive: {
    backgroundColor: colors.text.inverse,
  },
  micBase: {
    width: 28,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  micBaseActive: {
    backgroundColor: colors.text.inverse,
  },
  label: {
    color: colors.text.inverse,
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 1,
  },
  hint: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 11,
    marginTop: 4,
  },
});
