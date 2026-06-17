/**
 * Carehome Walkie — calm healthcare palette
 *
 * Teal (trust/clarity) + sage neutrals + warm coral for live transmit.
 * Contrast ratios meet WCAG AA for body text on surfaces.
 */
export const colors = {
  background: "#F4F7F5",
  surface: "#FFFFFF",
  surfaceMuted: "#E8EFEB",
  surfaceElevated: "#FFFFFF",

  primary: "#2D6A6A",
  primaryLight: "#3D8484",
  primaryDark: "#1F4E4E",
  primaryMuted: "#C5DDD9",

  transmit: "#C45C3E",
  transmitDark: "#A64D34",
  transmitMuted: "#F5DDD4",

  success: "#3D7A5C",
  successMuted: "#D4E8DC",
  warning: "#B8860B",
  warningMuted: "#F5EACC",
  error: "#B84343",
  errorMuted: "#F5D4D4",

  text: {
    primary: "#1C2B28",
    secondary: "#5C6F69",
    muted: "#8A9B94",
    inverse: "#FFFFFF",
  },

  border: {
    default: "#D4DDD8",
    subtle: "#E8EFEB",
  },

  banner: {
    connected: "#3D7A5C",
    connecting: "#B8860B",
    disconnected: "#B84343",
  },

  debug: {
    background: "#1C2B28",
    title: "#7EB8B0",
    text: "#D4E0DC",
    trace: "#E8C97A",
    log: "#8A9B94",
  },

  overlay: "rgba(28, 43, 40, 0.55)",
  toast: "rgba(28, 43, 40, 0.92)",
  shadow: "#1C2B28",
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 20,
  full: 999,
} as const;
