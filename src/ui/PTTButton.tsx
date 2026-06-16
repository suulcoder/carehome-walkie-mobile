import React, { useRef, useEffect } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  GestureResponderEvent,
} from "react-native";

interface Props {
  onPressIn: (e: GestureResponderEvent) => void;
  onPressOut: (e: GestureResponderEvent) => void;
  isTalking: boolean;
  disabled?: boolean;
}

export function PTTButton({ onPressIn, onPressOut, isTalking, disabled }: Props) {
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
            pressed && styles.buttonPressed,
            disabled && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.icon}>{isTalking ? "🔴" : "🎙️"}</Text>
          <Text style={styles.label}>{isTalking ? "TALKING" : "PUSH TO TALK"}</Text>
          <Text style={styles.hint}>{isTalking ? "Release to send" : "Hold to speak"}</Text>
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
    backgroundColor: "#1e40af",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 12,
    elevation: 12,
  },
  buttonActive: {
    backgroundColor: "#dc2626",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    backgroundColor: "#6b7280",
    elevation: 0,
  },
  icon: {
    fontSize: 42,
    marginBottom: 8,
  },
  label: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 1,
  },
  hint: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    marginTop: 4,
  },
});
