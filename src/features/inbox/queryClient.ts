import { QueryClient } from "@tanstack/react-query";

export const inboxQueryKey = ["message-inbox"] as const;

export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: Infinity,
    },
  },
});

/** Marks the inbox query stale so UI refetches the latest messages from storage. */
export function invalidateInbox(): void {
  void appQueryClient.invalidateQueries({ queryKey: inboxQueryKey });
}
