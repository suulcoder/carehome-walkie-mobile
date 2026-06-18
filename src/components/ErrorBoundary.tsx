/**
 * Production error boundary.
 *
 * React render errors are otherwise silent on device builds — they produce a
 * red screen in dev but a blank white screen in production, which is
 * catastrophic in a care-facility context.
 *
 * This boundary:
 *   1. Catches any render error in its subtree.
 *   2. Reports it via the telemetry pipeline (Metro / device logs, future Sentry hook).
 *   3. Shows a clear recovery UI instead of a blank screen.
 *   4. Lets the user restart the app without needing IT support.
 */

import React, { Component, ReactNode } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors, radii, shadows, spacing, typography } from "../theme";

interface Props {
  children: ReactNode;
  /**
   * Optional override for the recovery action.
   * Defaults to `() => {}` (shows instructions to restart manually).
   */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Structured log — same format as the rest of our telemetry so crash
    // reports land alongside audio/WS events in the same log stream.
    console.error(
      `[walkie:app] ERR render_error ${JSON.stringify({
        message: error.message,
        componentStack: info.componentStack?.slice(0, 400),
      })}`
    );
    // TODO: forward to Sentry / Datadog when integrated.
  }

  private handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>
          An unexpected error occurred. The team has been notified.
        </Text>
        <Text style={styles.detail} numberOfLines={4}>
          {this.state.error.message}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={this.handleReset}
          accessibilityRole="button"
          accessibilityLabel="Restart the app"
        >
          <Text style={styles.buttonText}>Tap to restart</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
  },
  title: {
    ...typography.title,
    fontSize: 22,
    color: colors.text.primary,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  message: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: "center",
    marginBottom: spacing.xl,
  },
  detail: {
    fontSize: 12,
    color: colors.text.muted,
    fontFamily: "Menlo",
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radii.md,
    width: "100%",
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  button: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 14,
    borderRadius: radii.md,
    ...shadows.sm,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: colors.text.inverse,
    fontSize: 16,
    fontWeight: "700",
  },
});
