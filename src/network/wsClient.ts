/**
 * WebSocket client with reconnect, heartbeat, outbound queue, and telemetry.
 */

import {
  WS_URL,
  WS_ENV,
  CHANNEL,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
} from "../config";
import { telemetry } from "../observability";
import { ClientMessage, ServerMessage, PeerInfo } from "./protocol";
import {
  QueuedSession,
  enqueueChunk,
  markSessionEnded,
  removeSession,
  getPendingSessions,
} from "../queue/outboundQueue";
import { getReceiveSince } from "../sync/receiveCursor";
import { registerOwnedSession } from "../audio/playback";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface WsClientCallbacks {
  onStateChange: (state: ConnectionState, queuedCount: number) => void;
  onMessage: (msg: ServerMessage) => void;
  onPeers: (peers: PeerInfo[]) => void;
}

function messageDataToString(data: string | ArrayBuffer | Blob): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) {
    return new TextDecoder("utf-8").decode(data);
  }
  return String(data);
}

export class WsClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private retryDelay = RECONNECT_BASE_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private activeSessions = new Map<string, QueuedSession>();
  private ackedSessions = new Set<string>();

  constructor(
    private displayName: string,
    private callbacks: WsClientCallbacks
  ) {}

  connect(): void {
    if (this.destroyed) return;
    telemetry.info("ws", "connecting", { data: { url: WS_URL, env: WS_ENV } });
    this.setState("connecting");
    this.openSocket();
  }

  destroy(): void {
    this.destroyed = true;
    this.clearTimers();
    this.ws?.close();
    telemetry.info("ws", "destroyed");
  }

  private parseIncomingMessage(
    raw: string | ArrayBuffer | Blob
  ): ServerMessage | "native_pong" | null {
    const text = messageDataToString(raw).trim();
    if (!text) return null;

    // Some RN/Android stacks surface protocol-level pong as a plain-text frame.
    if (text === "pong") return "native_pong";
    if (text === "ping") return null;

    try {
      return JSON.parse(text) as ServerMessage;
    } catch {
      return null;
    }
  }

  private onServerActivity(): void {
    this.clearPongTimer();
  }

  private openSocket(): void {
    if (this.destroyed) return;
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      telemetry.info("ws", "open");
      this.retryDelay = RECONNECT_BASE_MS;
      void this.sendJoin();
      this.startPing();
    };

    ws.onmessage = (event) => {
      const parsed = this.parseIncomingMessage(event.data);
      if (parsed === null) {
        const preview = messageDataToString(event.data).slice(0, 80);
        if (preview) {
          telemetry.warn("ws", "invalid_json", {
            data: { preview },
          });
        }
        return;
      }

      if (parsed === "native_pong") {
        this.onServerActivity();
        return;
      }

      const msg = parsed;
      this.onServerActivity();

      if (msg.type === "pong") {
        return;
      }

      if (msg.type === "joined") {
        telemetry.info("ws", "joined", {
          data: { clientId: msg.clientId, peerCount: msg.peers.length },
        });
        this.setState("connected");
        this.callbacks.onPeers(msg.peers);
        this.drainQueue();
        return;
      }

      if (msg.type === "ack") {
        telemetry.debug("ws", "ack", {
          sessionId: msg.sessionId,
          data: { lastSeq: msg.lastSeq },
        });
        this.handleAck(msg.sessionId);
        return;
      }

      this.callbacks.onMessage(msg);
    };

    ws.onclose = (event) => {
      telemetry.warn("ws", "closed", {
        data: { code: event.code, reason: event.reason || "none" },
      });
      this.handleDisconnect();
    };

    ws.onerror = () => {
      telemetry.error("ws", "socket_error");
      this.handleDisconnect();
    };
  }

  private handleDisconnect(): void {
    if (this.destroyed) return;
    this.clearTimers();
    const wasConnected = this.state === "connected";
    if (wasConnected) telemetry.metric("wsReconnects");
    this.setState(wasConnected ? "reconnecting" : "connecting");
    telemetry.info("ws", "reconnect_scheduled", { data: { delayMs: this.retryDelay } });
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.destroyed) return;
    this.retryTimer = setTimeout(() => {
      this.openSocket();
      this.retryDelay = Math.min(this.retryDelay * 2, RECONNECT_MAX_MS);
    }, this.retryDelay);
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ type: "ping" }));
      this.pongTimer = setTimeout(() => {
        telemetry.warn("ws", "ping_timeout");
        this.ws?.close();
      }, PING_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  private clearPongTimer(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.clearPongTimer();
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.callbacks.onStateChange(state, this.activeSessions.size);
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return;
    }
    telemetry.warn("ws", "send_while_not_open", {
      sessionId: "sessionId" in msg ? msg.sessionId : undefined,
      data: { type: msg.type, readyState: this.ws?.readyState ?? "null" },
    });
  }

  sendPttStart(sessionId: string): void {
    registerOwnedSession(sessionId);
    const session: QueuedSession = { sessionId, chunks: [], ended: false };
    this.activeSessions.set(sessionId, session);
    telemetry.metric("pttSessionsStarted");
    telemetry.session("sender", sessionId, { status: "active" });
    telemetry.info("ws", "ptt_start_sent", { sessionId });
    this.send({ type: "ptt_start", sessionId });
  }

  sendAudioChunk(sessionId: string, seq: number, pcmBase64: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.chunks.push({ seq, pcmBase64 });
      enqueueChunk(session);
    }
    telemetry.metric("audioChunksSent");
    telemetry.debug("ws", "audio_chunk_sent", {
      sessionId,
      data: { seq, base64Len: pcmBase64.length },
    });
    this.send({ type: "audio_chunk", sessionId, seq, pcmBase64 });
  }

  private async sendJoin(): Promise<void> {
    const since = await getReceiveSince();
    this.send({ type: "join", name: this.displayName, channel: CHANNEL, since });
  }

  sendPttEnd(sessionId: string, sampleRate?: number, chunkCount?: number): void {
    const session = this.activeSessions.get(sessionId);
    const chunks = session?.chunks.length ?? chunkCount ?? 0;
    if (session) {
      session.ended = true;
      session.sampleRate = sampleRate;
      session.chunkCount = chunks;
      void markSessionEnded(session);
    }
    telemetry.metric("pttSessionsSent");
    telemetry.info("ws", "ptt_end_sent", {
      sessionId,
      data: { chunkCount: chunks, sampleRate },
    });
    telemetry.session("sender", sessionId, { chunksSent: chunks, sampleRate });
    this.send({ type: "ptt_end", sessionId, sampleRate, chunkCount: chunks });

    if (this.state === "connected") {
      this.ackedSessions.add(sessionId);
      this.activeSessions.delete(sessionId);
      removeSession(sessionId);
      this.callbacks.onStateChange(this.state, this.activeSessions.size);
    }
  }

  private handleAck(sessionId: string): void {
    this.ackedSessions.add(sessionId);
    this.activeSessions.delete(sessionId);
    removeSession(sessionId);
    this.callbacks.onStateChange(this.state, this.activeSessions.size);
  }

  private sendPttEndForQueued(session: QueuedSession): void {
    this.send({
      type: "ptt_end",
      sessionId: session.sessionId,
      sampleRate: session.sampleRate,
      chunkCount: session.chunkCount ?? session.chunks.length,
    });
  }

  private async drainQueue(): Promise<void> {
    for (const [, session] of this.activeSessions) {
      if (session.ended) {
        telemetry.info("ws", "drain_session", {
          sessionId: session.sessionId,
          data: { chunks: session.chunks.length, chunkCount: session.chunkCount },
        });
        this.send({ type: "ptt_start", sessionId: session.sessionId });
        for (const chunk of session.chunks) {
          this.send({
            type: "audio_chunk",
            sessionId: session.sessionId,
            seq: chunk.seq,
            pcmBase64: chunk.pcmBase64,
          });
        }
        this.sendPttEndForQueued(session);
      }
    }

    const persisted = await getPendingSessions();
    for (const session of persisted) {
      if (this.activeSessions.has(session.sessionId)) continue;
      if (session.ended) {
        this.send({ type: "ptt_start", sessionId: session.sessionId });
        for (const chunk of session.chunks) {
          this.send({
            type: "audio_chunk",
            sessionId: session.sessionId,
            seq: chunk.seq,
            pcmBase64: chunk.pcmBase64,
          });
        }
        this.sendPttEndForQueued(session);
        removeSession(session.sessionId);
      }
    }
  }

  getState(): ConnectionState {
    return this.state;
  }
}
