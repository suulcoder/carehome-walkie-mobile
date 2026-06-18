/**
 * Carehome Walkie — calm healthcare design system
 *
 * Teal (trust/clarity) + sage neutrals + warm coral for live transmit.
 * Contrast ratios meet WCAG AA for body text on surfaces.
 */
export const colors = {
  background: "#F0F4F2",
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

  avatar: ["#2D6A6A", "#3D7A5C", "#4A7C8C", "#5C6F69", "#6B8E7B", "#7A9B8E"],

  debug: {
    background: "#1C2B28",
    title: "#7EB8B0",
    text: "#D4E0DC",
    trace: "#E8C97A",
    log: "#8A9B94",
  },

  overlay: "rgba(28, 43, 40, 0.55)",
  toast: "rgba(28, 43, 40, 0.94)",
  shadow: "#1C2B28",
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  full: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const typography = {
  caption: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.6 },
  label: { fontSize: 12, fontWeight: "600" as const, letterSpacing: 0.4 },
  body: { fontSize: 15, fontWeight: "400" as const, lineHeight: 22 },
  bodyStrong: { fontSize: 15, fontWeight: "600" as const, lineHeight: 22 },
  title: { fontSize: 20, fontWeight: "700" as const, letterSpacing: -0.3 },
  headline: { fontSize: 26, fontWeight: "800" as const, letterSpacing: -0.5 },
  section: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 1.4,
    textTransform: "uppercase" as const,
  },
} as const;

export const shadows = {
  sm: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 4,
  },
  lg: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 8,
  },
} as const;

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors.avatar[Math.abs(hash) % colors.avatar.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
