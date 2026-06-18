import React from "react";
import { View, StyleSheet } from "react-native";
import { colors } from "./index";

interface IconProps {
  size?: number;
  color?: string;
}

export function MicIcon({ size = 24, color = colors.text.inverse }: IconProps) {
  const headW = size * 0.46;
  const headH = size * 0.62;
  const stemW = Math.max(2, size * 0.1);
  const stemH = size * 0.18;
  const baseW = size * 0.58;
  const baseH = Math.max(3, size * 0.1);

  return (
    <View style={[styles.iconCenter, { width: size, height: size }]}>
      <View
        style={{
          width: headW,
          height: headH,
          borderRadius: headW / 2,
          backgroundColor: color,
          marginBottom: size * 0.06,
        }}
      />
      <View
        style={{
          width: stemW,
          height: stemH,
          backgroundColor: color,
          marginBottom: size * 0.04,
        }}
      />
      <View
        style={{
          width: baseW,
          height: baseH,
          borderRadius: baseH / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export function PlayIcon({ size = 16, color = colors.primary }: IconProps) {
  const tri = size * 0.55;
  return (
    <View style={[styles.iconCenter, { width: size, height: size }]}>
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: tri / 2,
          borderBottomWidth: tri / 2,
          borderLeftWidth: tri,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: color,
          marginLeft: size * 0.12,
        }}
      />
    </View>
  );
}

export function UsersIcon({ size = 20, color = colors.text.muted }: IconProps) {
  const dot = size * 0.28;
  return (
    <View style={[styles.iconCenter, { width: size, height: size }]}>
      <View style={{ flexDirection: "row", gap: size * 0.08, marginBottom: size * 0.06 }}>
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} />
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} />
      </View>
      <View
        style={{
          width: size * 0.72,
          height: size * 0.22,
          borderTopLeftRadius: size * 0.36,
          borderTopRightRadius: size * 0.36,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export function MessageIcon({ size = 20, color = colors.text.muted }: IconProps) {
  const w = size;
  const h = size * 0.75;
  return (
    <View style={[styles.iconCenter, { width: size, height: size }]}>
      <View
        style={{
          width: w,
          height: h,
          borderRadius: size * 0.18,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: size * 0.08,
          left: size * 0.18,
          width: 0,
          height: 0,
          borderTopWidth: size * 0.14,
          borderRightWidth: size * 0.14,
          borderTopColor: color,
          borderRightColor: "transparent",
        }}
      />
    </View>
  );
}

export function StatusDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
      }}
    />
  );
}

const styles = StyleSheet.create({
  iconCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
});
