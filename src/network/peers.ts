import { PeerInfo } from "./protocol";

export function isSameDisplayName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** One entry per display name — keeps the most recently seen connection id. */
export function dedupePeersByName(peers: PeerInfo[]): PeerInfo[] {
  const byName = new Map<string, PeerInfo>();
  for (const peer of peers) {
    byName.set(peer.name.toLowerCase(), peer);
  }
  return [...byName.values()];
}
