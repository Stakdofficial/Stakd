import type { ReactNode } from "react";
import { Reveal } from "./motion";

const icon = (children: ReactNode) => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

const STEPS = [
  {
    n: "01",
    icon: icon(
      <>
        <path d="M12 3v12" />
        <path d="m7 8 5-5 5 5" />
        <path d="M5 21h14" />
        <path d="M8 17h8" />
      </>,
    ),
    title: "Launch",
    body: "Pick up to six markets and a 1–5% fee. Your coin goes live in a Uniswap v4 pool paired with ETH. No ETH needed, liquidity locked forever.",
  },
  {
    n: "02",
    icon: icon(
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v9l6.5 6.2" />
      </>,
    ),
    title: "Fund",
    body: "Every buy and sell pays the fee in ETH. 60% becomes margin on Lighter, on the same chain with no bridges; 40% goes to the platform.",
  },
  {
    n: "03",
    icon: icon(
      <>
        <path d="M3 3v18h18" />
        <path d="m7 15 4-4 3 3 6-6" />
        <path d="M16 8h4v4" />
      </>,
    ),
    title: "Trade",
    body: "The keeper opens the basket's perps at your weights and leverage, rebalances, and takes partial profits.",
  },
  {
    n: "04",
    icon: icon(
      <>
        <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5.5.5 1.5 1.5 2.5 2.5 2.5 0-2.5-1-4.5 0-7z" />
      </>,
    ),
    title: "Burn",
    body: "75% of realized profit comes back as ETH, buys the coin in the pool, and burns it. Supply only goes down.",
  },
];

export function Flywheel() {
  return (
    <div className="flywheel">
      <svg className="flow-line" viewBox="0 0 1000 20" preserveAspectRatio="none" aria-hidden>
        <path d="M60,10 L940,10" className="flow-track" />
        <path d="M60,10 L940,10" className="flow-dash" />
      </svg>
      {STEPS.map((s, i) => (
        <Reveal key={s.n} delay={i * 120} className="flow-step">
          <div className="flow-icon">{s.icon}</div>
          <div className="flow-n mono">{s.n}</div>
          <h3>{s.title}</h3>
          <p className="muted">{s.body}</p>
        </Reveal>
      ))}
    </div>
  );
}
