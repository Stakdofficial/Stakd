"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, createConfig, http, injected } from "wagmi";
import { chain } from "@/lib/config";

const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected()],
  // Batch the JSON-RPC calls too, so what multicall cannot fold into one call still travels together.
  transports: { [chain.id]: http(undefined, { batch: { wait: 24 } }) } as Record<typeof chain.id, ReturnType<typeof http>>,
  batch: { multicall: { batchSize: 2_048, wait: 24 } },
  ssr: true,
});

/**
 * Chain access for the whole site.
 *
 * Privy deliberately is not here. It is only needed to prove someone owns a social account when claiming a
 * creator fee, and while it sat at the root its start-up could stall every read on every page — the coin list
 * hung on "Loading coins…" site-wide because wagmi never issued a single request. It now wraps the claim page
 * alone (see app/claim/layout.tsx), so a slow or broken third-party login can never take the site down again.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
