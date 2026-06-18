import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { colors, radii, shadows, spacing, typography } from "../theme";
import { MicIcon } from "../theme/icons";

interface Props {
  visible: boolean;
  mode?: "welcome" | "edit";
  initialName?: string;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
}

export function NameModal({
  visible,
  mode = "welcome",
  initialName = "",
  onSubmit,
  onCancel,
}: Props) {
  const [name, setName] = useState(initialName);
  const [focused, setFocused] = useState(false);
  const isEdit = mode === "edit";

  useEffect(() => {
    if (visible) setName(initialName);
  }, [visible, initialName]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (trimmed.length > 0) onSubmit(trimmed);
  };

  const canSubmit = name.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <MicIcon size={32} color={colors.primary} />
          </View>

          <Text style={styles.title}>{isEdit ? "Change name" : "Welcome"}</Text>
          <Text style={styles.subtitle}>
            {isEdit
              ? "Your new name will appear to others on the channel"
              : "Enter your display name to join the channel"}
          </Text>

          <TextInput
            style={[styles.input, focused && styles.inputFocused]}
            placeholder="Your name…"
            placeholderTextColor={colors.text.muted}
            value={name}
            onChangeText={setName}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoFocus
            maxLength={30}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          <Pressable
            style={({ pressed }) => [
              styles.button,
              !canSubmit && styles.buttonDisabled,
              pressed && canSubmit && styles.buttonPressed,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            <Text style={styles.buttonText}>{isEdit ? "Save name" : "Join channel"}</Text>
          </Pressable>

          {isEdit && onCancel ? (
            <Pressable
              style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelPressed]}
              onPress={onCancel}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.xxl,
    alignItems: "center",
    ...shadows.lg,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radii.full,
    backgroundColor: colors.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.headline,
    fontSize: 24,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.text.secondary,
    textAlign: "center",
    marginBottom: spacing.xl,
    lineHeight: 21,
    paddingHorizontal: spacing.sm,
  },
  input: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: colors.border.default,
    borderRadius: radii.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    fontSize: 16,
    color: colors.text.primary,
    marginBottom: spacing.lg,
    backgroundColor: colors.background,
  },
  inputFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  button: {
    width: "100%",
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: 15,
    alignItems: "center",
    ...shadows.sm,
  },
  buttonDisabled: {
    backgroundColor: colors.primaryMuted,
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonPressed: {
    opacity: 0.88,
  },
  buttonText: {
    color: colors.text.inverse,
    fontWeight: "700",
    fontSize: 16,
  },
  cancelButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  cancelPressed: {
    opacity: 0.6,
  },
  cancelText: {
    color: colors.text.secondary,
    fontSize: 15,
    fontWeight: "600",
  },
});
