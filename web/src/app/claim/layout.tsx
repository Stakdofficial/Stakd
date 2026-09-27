"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { TELEGRAM_ENABLED } from "@/lib/config";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Privy wraps the claim page only.
 *
 * Claiming is the one place that needs it: it proves someone really owns the X, GitHub, Discord or Telegram
 * account a coin's 1% was pointed at. Keeping it off the root means a slow start-up here cannot stop the rest
 * of the site reading the chain. Without an app id the page still renders; only the sign-in goes quiet.
 */
export default function ClaimLayout({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <>{children}</>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Telegram only appears once it is switched on in the Privy dashboard. Offering it earlier would let
        // someone point a fee at a handle nobody could ever prove they own.
        // Social logins only. Including "wallet" makes Privy wait on browser wallet connectors, and with no
        // extension installed that wait never finishes — the page sat on "Loading" forever. Claimers do not
        // need a wallet anyway: one is created for them below.
        loginMethods: ["twitter", "github", "discord", ...(TELEGRAM_ENABLED ? (["telegram"] as const) : [])],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        appearance: { theme: "light", accentColor: "#2563eb", logo: undefined },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
