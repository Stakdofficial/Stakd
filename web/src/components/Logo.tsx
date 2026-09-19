/** Stakd mark: three stacked layers on a deep-blue tile — positions stacked behind a coin. */
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Stakd" style={{ display: "block", flex: "none" }}>
      <defs>
        <linearGradient id="stakd-tile" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1e40af" />
          <stop offset="1" stopColor="#0b1f4d" />
        </linearGradient>
        <linearGradient id="stakd-top" x1="10" y1="8" x2="30" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#stakd-tile)" />
      <path d="M9 26.5 20 21l11 5.5L20 32z" fill="#3b82f6" />
      <path d="M9 20 20 14.5 31 20 20 25.5z" fill="#60a5fa" />
      <path d="M9 13.5 20 8l11 5.5L20 19z" fill="url(#stakd-top)" />
      <path d="M20 19v0" stroke="#fff" />
    </svg>
  );
}

export function Logo() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <LogoMark />
      <span style={{ fontWeight: 800, fontSize: 21, letterSpacing: "-0.04em", color: "var(--text)" }}>Stakd</span>
    </span>
  );
}
