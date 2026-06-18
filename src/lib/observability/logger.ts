import { incrementMetric, pushLog, upsertSessionTrace, completeSessionTrace } from "./metrics";
import type { LogCategory, LogLevel } from "./types";

const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: "DBG",
  info: "INF",
  warn: "WRN",
  error: "ERR",
};

function formatConsoleMessage(
  category: LogCategory,
  level: LogLevel,
  event: string,
  sessionId?: string,
  data?: Record<string, unknown>
): string {
  const sid = sessionId ? ` sid=${sessionId}` : "";
  const payload = data && Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : "";
  return `[walkie:${category}] ${LEVEL_PREFIX[level]} ${event}${sid}${payload}`;
}

function write(
  category: LogCategory,
  level: LogLevel,
  event: string,
  options?: {
    sessionId?: string;
    data?: Record<string, unknown>;
    message?: string;
  }
): void {
  const { sessionId, data, message } = options ?? {};
  const line = formatConsoleMessage(category, level, event, sessionId, data);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }

  pushLog({ level, category, event, sessionId, data, message });
}

export const telemetry = {
  debug(category: LogCategory, event: string, options?: Parameters<typeof write>[3]) {
    write(category, "debug", event, options);
  },
  info(category: LogCategory, event: string, options?: Parameters<typeof write>[3]) {
    write(category, "info", event, options);
  },
  warn(category: LogCategory, event: string, options?: Parameters<typeof write>[3]) {
    write(category, "warn", event, options);
  },
  error(category: LogCategory, event: string, options?: Parameters<typeof write>[3]) {
    write(category, "error", event, options);
  },

  metric(name: keyof import("./types").MetricCounters, by = 1) {
    incrementMetric(name, by);
    write("metric", "debug", name, { data: { delta: by } });
  },

  session(role: "sender" | "receiver", sessionId: string, patch: Record<string, unknown>) {
    upsertSessionTrace(sessionId, { role, ...patch });
  },

  sessionDone(sessionId: string, ok: boolean, reason?: string) {
    completeSessionTrace(sessionId, ok ? "completed" : "failed", reason);
  },
};
