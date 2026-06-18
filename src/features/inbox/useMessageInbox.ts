import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loadInbox } from "./inboxRepository";
import { inboxQueryKey } from "./queryClient";
import { INBOX_MAX_AGE_MS } from "../../config";
import { StoredMessage } from "./types";
import { replayStoredMessage } from "../../services/audio/playback";

/** React hook that loads the inbox, filters expired messages, and exposes replay actions. */
export function useMessageInbox() {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tickMs = 30_000;
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, []);

  const query = useQuery({
    queryKey: inboxQueryKey,
    queryFn: loadInbox,
    refetchInterval: INBOX_MAX_AGE_MS / 6,
  });

  const replayMutation = useMutation({
    mutationFn: (message: StoredMessage) => replayStoredMessage(message),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inboxQueryKey });
    },
  });

  const messages = useMemo(
    () => (query.data ?? []).filter((message) => now - message.completedAt <= INBOX_MAX_AGE_MS),
    [now, query.data]
  );
  const unplayedCount = messages.filter((m) => m.playedAt == null && !m.isOutbound).length;

  return {
    messages,
    unplayedCount,
    isLoading: query.isLoading,
    replayMessage: (message: StoredMessage) => replayMutation.mutate(message),
    isReplaying: replayMutation.isPending,
  };
}
