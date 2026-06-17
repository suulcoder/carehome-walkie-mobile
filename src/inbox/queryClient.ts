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

export function invalidateInbox(): void {
  void appQueryClient.invalidateQueries({ queryKey: inboxQueryKey });
}
