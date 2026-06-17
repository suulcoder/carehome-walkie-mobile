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
import { colors, radii } from "./theme";

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
  const isEdit = mode === "edit";

  useEffect(() => {
    if (visible) setName(initialName);
  }, [visible, initialName]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (trimmed.length > 0) onSubmit(trimmed);
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>{isEdit ? "Change name" : "Welcome"}</Text>
          <Text style={styles.subtitle}>
            {isEdit
              ? "Your new name will appear to others on the channel"
              : "Enter your display name to join the channel"}
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Your name…"
            placeholderTextColor={colors.text.muted}
            value={name}
            onChangeText={setName}
            autoFocus
            maxLength={30}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />
          <Pressable
            style={[styles.button, name.trim().length === 0 && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={name.trim().length === 0}
          >
            <Text style={styles.buttonText}>{isEdit ? "Save name" : "Join channel"}</Text>
          </Pressable>
          {isEdit && onCancel ? (
            <Pressable style={styles.cancelButton} onPress={onCancel}>
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
  },
  card: {
    width: "85%",
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 28,
    alignItems: "center",
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.text.primary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.text.secondary,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 20,
  },
  input: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: colors.border.default,
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: colors.text.primary,
    marginBottom: 16,
    backgroundColor: colors.background,
  },
  button: {
    width: "100%",
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    backgroundColor: colors.primaryMuted,
  },
  buttonText: {
    color: colors.text.inverse,
    fontWeight: "700",
    fontSize: 16,
  },
  cancelButton: {
    marginTop: 12,
    paddingVertical: 8,
  },
  cancelText: {
    color: colors.text.secondary,
    fontSize: 15,
    fontWeight: "600",
  },
});
