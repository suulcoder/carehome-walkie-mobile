import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";

import { ErrorBoundary } from "../components/ErrorBoundary";
import { appQueryClient } from "../features/inbox/queryClient";
import { WalkieScreen } from "../screens/WalkieScreen";

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={appQueryClient}>
        <ErrorBoundary>
          <WalkieScreen />
        </ErrorBoundary>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
