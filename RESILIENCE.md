# Resilience Approach

This document explains how the Carehome Walkie-Talkie app handles unreliable networks, what UX decisions were made, and what would be improved with more time.

---

## 1. The Problem

Carehome Wi-Fi is unreliable. Phones are old, cheap Androids. Caregivers don't care about any of that — they just need to reach each other. The real challenge is building a walkie-talkie that holds up when the network and the hardware are working against it.

---

## 2. Architecture: Why WebSocket Relay (Not WebRTC)

I chose a simple WebSocket relay over WebRTC for two reasons:

**Zero cost**: WebRTC requires TURN servers for NAT traversal, which cost money. A WebSocket relay is a single Node.js process deployable for free on Render.

**Resilience-first design**: WebSocket gives us full control over the message lifecycle. Each audio chunk is a JSON message we can queue, sequence-number, and replay. WebRTC hides all of that inside the browser/OS ICE stack, making it much harder to detect and recover from partial failures.

Trade-off: ~200–400ms added latency vs. direct WebRTC peer-to-peer. Acceptable for push-to-talk in a carehome — nobody expects sub-100ms radio.

---

## 3. Never Losing a Message

Every PTT session has a `sessionId` (nanoid) and all chunks are numbered starting at `seq = 0`.

**Outbound path:**
1. On PTT press, `ptt_start` is sent.
2. Each ~20ms audio chunk is queued in memory and mirrored to AsyncStorage under `ptt_queue_<sessionId>`.
3. On `ptt_end`, the session is marked complete in AsyncStorage.
4. After a successful send (or server ack), the session is removed from the queue.

**On reconnect:**
- In-memory unsent sessions are replayed immediately after `joined` is received.
- AsyncStorage is checked for sessions that survived an app restart and those are resent too.

**Result**: a PTT message that was pressed while offline will be delivered once the connection is restored, even if the app was restarted in between.

---

## 4. Reconnection Logic

```
app start / network back → Connecting
  ↓ ws open + join ack → Connected
  ↓ ws close / error   → Reconnecting
  ↓ reconnect success  → Connected
  ↓ max retries        → Disconnected
```

- Exponential backoff: 1s → 2s → 4s → 8s → ... capped at 30s.
- Heartbeat: a `ping` is sent every 15s. If no `pong` arrives within 5s, the connection is force-closed so the OS can clean up the stale socket and reconnect from scratch.
- No "max retries" — the client will keep trying indefinitely because caregivers may be in an area with no Wi-Fi for extended periods.

---

## 5. Inbound Audio: Jitter Buffer

Incoming chunks are buffered per `sessionId` and sorted by `seq` before playback. A gap timer (500ms) allows the buffer to skip a lost chunk rather than stalling indefinitely, which gives smooth playback even under moderate packet loss.

---

## 6. UX Decisions

| Decision | Rationale |
|---|---|
| Colour-coded banner (green/amber/red) | Caregivers should never wonder if the app is working. Colour is faster to read than text alone. |
| Queue count in banner | "2 messages queued" tells the user their speech is not lost, just waiting. Reduces re-press anxiety. |
| Offline hint below PTT button | Explicitly says "press will be saved" so caregivers don't think the app is broken. |
| Haptic on PTT press/release | Physical confirmation without looking at the screen, like a real radio. |
| Red pulse animation while talking | Clear visual indicator that you're transmitting — avoids double-presses. |
| PTT button disabled when offline | Prevents confusion. Queuing works transparently; the button is re-enabled when the session was pressed after the connection dropped, but new presses are held until reconnect. |
| Display name (no login) | One-time name entry, persisted locally. No server-side accounts, no friction. |
| Active speaker list | Shows who is transmitting so caregivers know the message is from a colleague, not static noise. |
| Toast on peer join | Lightweight awareness of who is on the channel without interrupting the main flow. |

### What I'd do differently with more time

1. **Opus encoding** instead of raw PCM16: would reduce bandwidth by ~4–8x, critical for very slow networks.
2. **Server-side message persistence**: store the last N messages so a device joining mid-session can replay what it missed.
3. **Background audio** (foreground service on Android): currently the WS connection pauses when the app is backgrounded; a foreground service would keep it alive.
4. **iOS polish**: the app targets Android first per the challenge brief; iOS needs AVAudioSession handling for proper audio route switching (earpiece vs. speaker).
5. **Multi-channel support**: hardcoded `carehome-1` is intentional for the challenge; real deployment would need a channel picker.
6. **Automated E2E tests**: the simulator proxy covers network-level scenarios but a full Detox or Maestro test suite would close the loop on UI behaviour.
7. **Accessibility**: larger tap targets, screen reader labels for VoiceOver/TalkBack.
8. **Reconnect with exponential jitter**: the current backoff is deterministic; adding jitter would prevent reconnect storms after a server restart when many devices reconnect simultaneously.
