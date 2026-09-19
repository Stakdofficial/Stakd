const X_URL = "https://x.com/StakdOfficial";

export function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function XLink({ label = false, size = 16 }: { label?: boolean; size?: number }) {
  return (
    <a
      className="x-link"
      href={X_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Stakd on X"
      title="Stakd on X (@StakdOfficial)"
    >
      <XIcon size={size} />
      {label ? <span>@StakdOfficial</span> : null}
    </a>
  );
}
