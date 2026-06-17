# Resilience Approach

This document explains how the Carehome Walkie-Talkie app handles unreliable networks, what UX decisions were made, and what I'd do differently with more time.

---

## 1. The Problem

Carehome Wi-Fi is unreliable. Phones are old, cheap Androids. Caregivers don't know or care about any of that — they just need to reach each other. The real challenge is building a walkie-talkie that holds up when the network and the hardware are working against it.

---

## 2. Architecture: Why WebSocket Relay (Not WebRTC)

I chose a simple WebSocket relay over WebRTC for two reasons:

**Zero cost**: WebRTC requires TURN servers for NAT traversal, which cost money. A WebSocket relay is a single Node.js process deployable for free on Render.

**Resilience-first design**: WebSocket gives us full control over the message lifecycle. Each audio chunk is a JSON message we can sequence-number, queue, and replay. WebRTC hides all of that inside the browser/OS ICE stack, making it much harder to detect and recover from partial failures.

Trade-off: ~200–400ms added latency vs. direct WebRTC peer-to-peer. Acceptable for push-to-talk in a carehome — nobody expects sub-100ms radio.

---

## 3. Never Losing a Message

Every PTT session has a `sessionId` (nanoid) and all chunks are numbered starting at `seq = 0`.

**The PTT button is always enabled** — even when offline. This is the most important design decision: a caregiver can press and talk regardless of connectivity. Their message is queued and delivered automatically when the connection comes back.

**Outbound path:**
1. On PTT press, `ptt_start` is sent (best-effort; the session is tracked in memory even if the send fails).
2. Each ~20ms audio chunk is immediately emitted live via the WebSocket AND persisted to AsyncStorage under `ptt_queue_<sessionId>`.
3. On PTT release, `ptt_end` marks the session complete in AsyncStorage.
4. If the WS was connected throughout: the session is cleaned up from the queue immediately.
5. If the WS dropped during or before the session: on reconnect, `drainQueue` replays `ptt_start + all chunks + ptt_end` from AsyncStorage.

**Live streaming**: chunks are emitted during capture (not just on release). This means receivers start hearing audio before the sender releases the button — critical on slow networks. If `ptt_end` arrives before all chunks (due to reordering), the receiver waits up to 20s before playing what it has.

**On reconnect:**
- In-memory unsent sessions are replayed immediately after `joined` is received.
- AsyncStorage is also checked for sessions that survived an app restart.

**Result**: a PTT message pressed while offline — or even while the app was restarted — is delivered once connectivity is restored.

---

## 4. Reconnection Logic

```
app start / network back → Connecting
  ↓ ws open + join ack → Connected
  ↓ ws close / error   → Reconnecting
  ↓ reconnect success  → Connected
```

- Exponential backoff: 1s → 2s → 4s → 8s → … capped at 30s.
- Heartbeat: a `ping` is sent every 15s. If no `pong` arrives within 5s, the connection is force-closed so the OS can clean up the stale socket and reconnect from scratch.
- No "max retries" — the client keeps trying indefinitely because caregivers may be in a dead-zone for extended periods.

---

## 5. Inbound Audio: Jitter Buffer

Incoming chunks are buffered per `sessionId` and sorted by `seq` before playback. The buffer handles two timeout tiers:

- **Grace window (20s)**: waits for `ptt_end` which tells us how many chunks to expect.
- **Gap timeout (500ms)**: if a hole in the sequence isn't filled within 500ms of the last received chunk, the gap is filled with silence and playback proceeds.

This gives smooth, full-length audio even under moderate packet loss, without stalling indefinitely on a lost packet.

---

## 6. App Lifecycle: Background / Foreground

A care-facility app may be backgrounded unexpectedly (phone call, screen lock). We handle this explicitly via a `useAppLifecycle` hook:

- **Background**: any active PTT transmission is cancelled immediately. The WS connection degrades naturally (OS may suspend it), but the queue persists.
- **Foreground**: the WS client is nudged to reconnect if needed and the audio session is reconfigured.

This prevents the app from transmitting indefinitely if a caregiver accidentally presses the button and pockets the phone.

---

## 7. Error Boundaries

A production `ErrorBoundary` wraps the entire React tree. React render errors that would normally produce a blank white screen in production are caught, logged via the same structured telemetry pipeline as audio/WS events, and surfaced as a user-friendly recovery screen with a "Tap to restart" button. A TODO marks the hook-point for Sentry integration.

---

## 8. iOS Audio Session Management

On iOS, `AVAudioSession` must be switched between `record` (microphone) and `playback` (speaker) modes explicitly. We:

1. On PTT press: activate the `record` session (microphone route).
2. On PTT release / incoming audio: switch to `playback` mode (routes to the built-in speaker).
3. After playback: restore the `record` session so the next PTT press works immediately.

Without this, iOS routes audio to the earpiece instead of the speaker, or the microphone and speaker fight over the session.

---

## 9. UX Decisions

| Decision | Rationale |
|---|---|
| PTT always enabled (amber "WILL QUEUE" when offline) | Caregivers should never be blocked from speaking. If offline, the press is queued silently and delivered on reconnect. Amber colour signals "this will queue, not transmit live." |
| Colour-coded banner (green/amber/red) | Caregivers should never wonder if the app is working. Colour is faster to read than text alone. |
| Queue count in banner | "2 messages queued" tells the user their speech is not lost, just waiting. Reduces re-press anxiety. |
| Haptic on PTT press/release | Physical confirmation without looking at the screen, like a real radio. |
| Amber pulse animation while queued | Clear visual that this press will be stored, not live. |
| Red pulse animation while talking live | Clear that you're transmitting now. |
| Display name (no login) | One-time name entry, persisted locally. No server-side accounts, no friction. |
| Active speaker list | Shows who is transmitting so caregivers know the message is from a colleague. |
| Toast on peer join | Lightweight awareness of who is on the channel without interrupting the main flow. |
| Tap name to edit | Name is visible in the header and tappable to change — no buried settings screen. |

---

## 10. What I'd Do Differently With More Time

1. **Opus encoding** instead of raw PCM16: would reduce bandwidth by ~4–8×, critical for very slow networks.
2. **Server-side message persistence**: store the last N sessions so a device joining mid-conversation can replay what it missed.
3. **Android foreground service**: currently the WS connection pauses when the app is fully backgrounded on Android; a foreground service with a persistent notification would keep it alive for truly 24/7 operation.
4. **Multi-channel support**: the hardcoded `carehome-1` channel is intentional for the challenge; real deployment would need a channel picker and server-side rooms.
5. **Automated E2E tests**: the simulator proxy covers network-level scenarios, but a full Maestro or Detox test suite would close the loop on UI behaviour.
6. **Accessibility**: larger tap targets, VoiceOver/TalkBack labels, high-contrast mode for low-vision caregivers.
7. **Reconnect jitter**: the current backoff is deterministic; adding random jitter would prevent reconnect storms after a server restart when many devices reconnect simultaneously.
8. **Sentry / Datadog integration**: the telemetry pipeline is structured for this (every log has a level, module, and event name), but the actual forwarding hook is a TODO.
