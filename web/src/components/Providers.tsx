"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, createConfig, http, injected } from "wagmi";
import { chain } from "@/lib/config";

const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected()],
  transports: { [chain.id]: http() } as Record<typeof chain.id, ReturnType<typeof http>>,
  ssr: true,
});

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const inner = (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
  // Privy is only needed to prove someone owns an X, GitHub or Discord account when claiming creator fees.
  // Without an app id configured the rest of the site still works; only the claim page goes quiet.
  if (!PRIVY_APP_ID) return inner;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["twitter", "github", "discord", "wallet"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        appearance: { theme: "light", accentColor: "#2563eb", logo: undefined },
      }}
    >
      {inner}
    </PrivyProvider>
  );
}
