/**
 * AppState lifecycle management.
 *
 * A 24/7 care-facility app must handle the full device lifecycle:
 *   - App backgrounded  → cancel any active PTT (don't transmit indefinitely),
 *                          let the WebSocket die gracefully, schedule reconnect
 *                          for when we return to foreground.
 *   - App foregrounded  → reconnect if needed, re-acquire audio session.
 *   - Audio interrupted  → phone call, alarm, siren: release the mic immediately.
 *
 * We expose a single `useAppLifecycle` hook so App.tsx stays readable.
 */

import { useEffect, useRef, useCallback } from "react";
import { AppState, AppStateStatus } from "react-native";
import { telemetry } from "../lib/observability";

export interface AppLifecycleCallbacks {
  /** Called when the app moves to background. Should cancel any active PTT. */
  onBackground: () => void;
  /** Called when the app returns to foreground. Should trigger reconnect checks. */
  onForeground: () => void;
}

/**
 * Tracks AppState transitions and fires the appropriate callback.
 *
 * Android: "active" → "background" when home button pressed or task-switched.
 * iOS:     "active" → "inactive" (briefly) → "background".
 *          We only fire onBackground once the state settles at "background"
 *          to avoid false triggers during iOS permission dialogs.
 */
export function useAppLifecycle({ onBackground, onForeground }: AppLifecycleCallbacks): void {
  const previousState = useRef<AppStateStatus>(AppState.currentState);
  const onBackgroundRef = useRef(onBackground);
  const onForegroundRef = useRef(onForeground);

  // Keep refs current without recreating the subscription on every render.
  useEffect(() => { onBackgroundRef.current = onBackground; }, [onBackground]);
  useEffect(() => { onForegroundRef.current = onForeground; }, [onForeground]);

  const handleChange = useCallback((nextState: AppStateStatus) => {
    const prev = previousState.current;
    previousState.current = nextState;

    telemetry.info("app", "app_state_change", {
      data: { from: prev, to: nextState },
    });

    const wentToBackground = nextState === "background";
    const returnedToForeground =
      (prev === "background" || prev === "inactive") && nextState === "active";

    if (wentToBackground) {
      telemetry.info("app", "backgrounded", {
        message: "App backgrounded — releasing mic and suspending PTT",
      });
      onBackgroundRef.current();
    } else if (returnedToForeground) {
      telemetry.info("app", "foregrounded", {
        message: "App foregrounded — checking WebSocket and audio session",
      });
      onForegroundRef.current();
    }
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", handleChange);
    return () => subscription.remove();
  }, [handleChange]);
}
