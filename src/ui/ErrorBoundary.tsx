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
import { colors, radii } from "./theme";

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
    padding: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text.primary,
    marginBottom: 12,
    textAlign: "center",
  },
  message: {
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 20,
  },
  detail: {
    fontSize: 12,
    color: colors.text.muted,
    fontFamily: "Menlo",
    backgroundColor: colors.surfaceMuted,
    padding: 12,
    borderRadius: radii.sm,
    width: "100%",
    marginBottom: 28,
  },
  button: {
    backgroundColor: colors.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: radii.md,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: colors.text.inverse,
    fontSize: 16,
    fontWeight: "700",
  },
});
