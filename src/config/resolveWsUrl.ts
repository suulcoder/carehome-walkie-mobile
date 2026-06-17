import Constants from "expo-constants";
import { Platform } from "react-native";

export type WsEnvironment = "production" | "network_simulator" | "local";

const WS_ENV_VALUES: readonly WsEnvironment[] = [
  "production",
  "network_simulator",
  "local",
];

const PRODUCTION_WS_URL = "wss://carehome-walkie-server.onrender.com/ws";
const NETWORK_SIMULATOR_PORT = 9090;
const LOCAL_SERVER_PORT = 8080;
const LOCAL_SERVER_PATH = "/ws";

/** Default when EXPO_PUBLIC_WS_ENV is not set. Change this for quick local toggles. */
export const DEFAULT_WS_ENV: WsEnvironment = "production";

export function parseWsEnvironment(
  value = process.env.EXPO_PUBLIC_WS_ENV?.trim()
): WsEnvironment {
  if (value && WS_ENV_VALUES.includes(value as WsEnvironment)) {
    return value as WsEnvironment;
  }
  return DEFAULT_WS_ENV;
}

/**
 * Host that reaches the dev machine from the running app.
 * - Android emulator → 10.0.2.2 (always; LAN IP does not work there)
 * - EXPO_PUBLIC_DEV_MACHINE_HOST → physical devices (and iOS sim if set)
 * - iOS Simulator fallback → localhost
 */
export function resolveDevMachineHost(): string {
  const configured = process.env.EXPO_PUBLIC_DEV_MACHINE_HOST?.trim();

  if (Platform.OS === "android" && !Constants.isDevice) {
    return "10.0.2.2";
  }

  if (configured) {
    return configured;
  }

  if (Platform.OS === "ios" && !Constants.isDevice) {
    return "localhost";
  }

  throw new Error(
    "Physical device requires EXPO_PUBLIC_DEV_MACHINE_HOST in .env.local " +
      "(your dev machine's LAN IP). Simulators/emulators do not need this. See .env.example."
  );
}

function buildDevWsUrl(port: number, path: string): string {
  const host = resolveDevMachineHost();
  return `ws://${host}:${port}${path}`;
}

export function resolveWsUrl(env: WsEnvironment): string {
  switch (env) {
    case "production":
      return PRODUCTION_WS_URL;
    case "network_simulator":
      return buildDevWsUrl(NETWORK_SIMULATOR_PORT, "");
    case "local":
      return buildDevWsUrl(LOCAL_SERVER_PORT, LOCAL_SERVER_PATH);
  }
}
