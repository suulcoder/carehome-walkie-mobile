/**
 * WebSocket client with:
 *  - Exponential backoff reconnect (capped at RECONNECT_MAX_MS)
 *  - Heartbeat ping/pong to detect stale connections
 *  - Outbound queue drain on reconnect
 *  - Connection state observable via onStateChange callback
 */

import {
  WS_URL,
  CHANNEL,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
} from "../config";
import { ClientMessage, ServerMessage, PeerInfo } from "./protocol";
import {
  QueuedSession,
  enqueueChunk,
  markSessionEnded,
  removeSession,
  getPendingSessions,
} from "../queue/outboundQueue";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface WsClientCallbacks {
  onStateChange: (state: ConnectionState, queuedCount: number) => void;
  onMessage: (msg: ServerMessage) => void;
  onPeers: (peers: PeerInfo[]) => void;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private retryDelay = RECONNECT_BASE_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  // In-memory session tracking
  private activeSessions = new Map<string, QueuedSession>();
  private ackedSessions = new Set<string>();

  constructor(
    private displayName: string,
    private callbacks: WsClientCallbacks
  ) {}

  connect(): void {
    if (this.destroyed) return;
    this.setState("connecting");
    this.openSocket();
  }

  destroy(): void {
    this.destroyed = true;
    this.clearTimers();
    this.ws?.close();
  }

  private openSocket(): void {
    if (this.destroyed) return;
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.retryDelay = RECONNECT_BASE_MS;
      this.send({ type: "join", name: this.displayName, channel: CHANNEL });
      this.startPing();
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }

      if (msg.type === "pong") {
        this.clearPongTimer();
        return;
      }

      if (msg.type === "joined") {
        this.setState("connected");
        this.callbacks.onPeers(msg.peers);
        this.drainQueue();
        return;
      }

      if (msg.type === "ack") {
        this.handleAck(msg.sessionId);
        return;
      }

      this.callbacks.onMessage(msg);
    };

    ws.onclose = () => this.handleDisconnect();
    ws.onerror = () => this.handleDisconnect();
  }

  private handleDisconnect(): void {
    if (this.destroyed) return;
    this.clearTimers();
    const wasConnected = this.state === "connected";
    this.setState(wasConnected ? "reconnecting" : "connecting");
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
        // No pong — connection stale, force close to trigger reconnect
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
    }
  }

  // --- PTT public API ---

  sendPttStart(sessionId: string): void {
    const session: QueuedSession = { sessionId, chunks: [], ended: false };
    this.activeSessions.set(sessionId, session);
    this.send({ type: "ptt_start", sessionId });
  }

  sendAudioChunk(sessionId: string, seq: number, pcmBase64: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.chunks.push({ seq, pcmBase64 });
      enqueueChunk(session);
    }
    this.send({ type: "audio_chunk", sessionId, seq, pcmBase64 });
  }

  sendPttEnd(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.ended = true;
      markSessionEnded(sessionId, session.chunks);
    }
    this.send({ type: "ptt_end", sessionId });
    // If connected and ack not needed, clean up immediately
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

  private async drainQueue(): Promise<void> {
    // Drain in-memory sessions first
    for (const [sessionId, session] of this.activeSessions) {
      if (session.ended) {
        for (const chunk of session.chunks) {
          this.send({ type: "audio_chunk", sessionId, seq: chunk.seq, pcmBase64: chunk.pcmBase64 });
        }
        this.send({ type: "ptt_end", sessionId });
      }
    }

    // Also check persisted sessions from AsyncStorage (survived app restart)
    const persisted = await getPendingSessions();
    for (const session of persisted) {
      if (this.activeSessions.has(session.sessionId)) continue; // already handled above
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
        this.send({ type: "ptt_end", sessionId: session.sessionId });
        removeSession(session.sessionId);
      }
    }
  }

  getState(): ConnectionState {
    return this.state;
  }
}
