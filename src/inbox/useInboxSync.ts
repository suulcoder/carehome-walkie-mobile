import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { HistoryEntry } from "../network/protocol";
import { syncInboxFromServer as persistMergedInbox } from "./inboxRepository";
import { inboxQueryKey } from "./queryClient";
import { telemetry } from "../observability";

export function useInboxSync(displayName: string | null) {
  const queryClient = useQueryClient();

  const applyServerHistory = useCallback(
    async (entries: HistoryEntry[]) => {
      const merged = await persistMergedInbox(entries, displayName ?? undefined);
      queryClient.setQueryData(inboxQueryKey, merged);
      telemetry.info("app", "history_synced", {
        data: { serverCount: entries.length, mergedCount: merged.length },
      });
    },
    [displayName, queryClient]
  );

  return { applyServerHistory };
}
