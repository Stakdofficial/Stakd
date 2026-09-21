"use client";

import Link from "next/link";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chain } from "@/lib/config";
import { Logo } from "@/components/Logo";
import { XLink } from "@/components/XLink";
import { ThemeToggle } from "@/components/ThemeToggle";

export function Header() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  return (
    <header className="header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <Logo />
          <span className="chip chip-live">
            <span className="live-dot" /> {chain.name} · Mainnet
          </span>
        </Link>
        <nav className="nav">
          <Link href="/#coins">Coins</Link>
          <Link href="/burns">Burns</Link>
          <Link href="/docs">Docs</Link>
          <XLink size={17} />
          <ThemeToggle />
          <Link href="/create" className="btn btn-primary btn-sm">
            Create coin
          </Link>
          {!isConnected ? (
            <button className="btn btn-outline btn-sm" disabled={isPending} onClick={() => connect({ connector: connectors[0] })}>
              {isPending ? "Connecting…" : "Connect wallet"}
            </button>
          ) : chainId !== chain.id ? (
            <button className="btn btn-outline btn-sm" onClick={() => switchChain({ chainId: chain.id })}>
              Switch to {chain.name}
            </button>
          ) : (
            <button className="btn btn-outline btn-sm mono" onClick={() => disconnect()} title="Disconnect">
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
