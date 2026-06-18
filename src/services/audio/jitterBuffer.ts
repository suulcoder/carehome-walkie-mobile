/**
 * Adaptive playout delay estimation (RFC 3550 jitter + bounded playout window).
 * Used by VoIP/WebRTC stacks to balance latency vs smooth playback under network jitter.
 */

export interface PlayoutDelayConfig {
  minMs: number;
  maxMs: number;
  /** Multiplier applied to smoothed jitter when computing target buffer depth. */
  marginFactor: number;
}

export class JitterEstimator {
  private lastArrivalAt = 0;
  private smoothedJitter = 0;
  private readonly expectedIntervalMs: number;

  constructor(expectedIntervalMs: number) {
    this.expectedIntervalMs = expectedIntervalMs;
  }

  onChunkArrival(now = Date.now()): void {
    if (this.lastArrivalAt === 0) {
      this.lastArrivalAt = now;
      return;
    }
    const interArrivalMs = now - this.lastArrivalAt;
    this.lastArrivalAt = now;
    const deviation = Math.abs(interArrivalMs - this.expectedIntervalMs);
    this.smoothedJitter += (deviation - this.smoothedJitter) / 16;
  }

  getJitterMs(): number {
    return this.smoothedJitter;
  }

  reset(): void {
    this.lastArrivalAt = 0;
    this.smoothedJitter = 0;
  }
}

export function computePlayoutDelayMs(jitterMs: number, config: PlayoutDelayConfig): number {
  const target = config.minMs + jitterMs * config.marginFactor;
  return Math.min(config.maxMs, Math.max(config.minMs, Math.round(target)));
}
