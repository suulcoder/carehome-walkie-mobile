import type { LogEntry, MetricCounters, SessionTrace } from "./types";

const MAX_LOG_ENTRIES = 120;
const MAX_SESSION_TRACES = 20;

const counters: MetricCounters = {
  pttSessionsStarted: 0,
  pttSessionsSent: 0,
  pttSessionsReceived: 0,
  audioChunksSent: 0,
  audioChunksReceived: 0,
  playbackAttempts: 0,
  playbackSuccess: 0,
  playbackFailures: 0,
  playbackSilentReceived: 0,
  captureFailures: 0,
  wsReconnects: 0,
};

const logEntries: LogEntry[] = [];
const sessionTraces = new Map<string, SessionTrace>();
const listeners = new Set<() => void>();

let entryCounter = 0;

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeTelemetry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMetricCounters(): MetricCounters {
  return { ...counters };
}

export function getRecentLogs(limit = 40): LogEntry[] {
  return logEntries.slice(-limit);
}

export function getSessionTraces(): SessionTrace[] {
  return Array.from(sessionTraces.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function pushLog(entry: Omit<LogEntry, "id" | "ts">): LogEntry {
  const full: LogEntry = {
    ...entry,
    id: `${Date.now()}-${++entryCounter}`,
    ts: Date.now(),
  };

  logEntries.push(full);
  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries.splice(0, logEntries.length - MAX_LOG_ENTRIES);
  }

  notify();
  return full;
}

export function incrementMetric(key: keyof MetricCounters, by = 1): void {
  counters[key] += by;
  notify();
}

export function upsertSessionTrace(
  sessionId: string,
  patch: Partial<SessionTrace> & Pick<SessionTrace, "role">
): SessionTrace {
  const existing = sessionTraces.get(sessionId);
  const next: SessionTrace = {
    ...existing,
    ...patch,
    sessionId,
    role: patch.role,
    status: patch.status ?? existing?.status ?? "active",
    updatedAt: Date.now(),
  };
  sessionTraces.set(sessionId, next);

  const traces = Array.from(sessionTraces.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  if (traces.length > MAX_SESSION_TRACES) {
    for (const trace of traces.slice(MAX_SESSION_TRACES)) {
      sessionTraces.delete(trace.sessionId);
    }
  }

  notify();
  return next;
}

export function completeSessionTrace(
  sessionId: string,
  status: "completed" | "failed",
  failureReason?: string
): void {
  const existing = sessionTraces.get(sessionId);
  if (!existing) return;
  sessionTraces.set(sessionId, {
    ...existing,
    status,
    failureReason,
    updatedAt: Date.now(),
  });
  notify();
}
