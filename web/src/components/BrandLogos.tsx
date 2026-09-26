import type React from "react";

/** The three accounts a creator fee can be pointed at. */
export const XLogo = ({ s = 20 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.3 4.7H5.5l11.2 14.5Z" />
  </svg>
);

export const GhLogo = ({ s = 20 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.9 10.9c.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 1.7 2.7 1.2 3.3.9.1-.7.4-1.2.7-1.5-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
  </svg>
);

export const DcLogo = ({ s = 20 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.5c1.7.4 2.9 1 4 1.7a14.3 14.3 0 0 0-12.2 0c1.1-.7 2.4-1.3 4-1.7L10.6 3a19.8 19.8 0 0 0-4.9 1.4C2.6 9 1.8 13.5 2.2 17.9a19.9 19.9 0 0 0 6 3c.5-.7.9-1.4 1.3-2.2-.7-.3-1.4-.6-2-1l.5-.4a14.2 14.2 0 0 0 12.1 0l.5.4c-.6.4-1.3.7-2 1 .4.8.8 1.5 1.3 2.2a19.8 19.8 0 0 0 6-3c.5-5.1-.8-9.6-3.6-13.5ZM8.7 15.2c-1.2 0-2.1-1.1-2.1-2.4 0-1.3.9-2.4 2.1-2.4 1.2 0 2.2 1.1 2.1 2.4 0 1.3-.9 2.4-2.1 2.4Zm6.6 0c-1.2 0-2.1-1.1-2.1-2.4 0-1.3.9-2.4 2.1-2.4 1.2 0 2.2 1.1 2.1 2.4 0 1.3-.9 2.4-2.1 2.4Z" />
  </svg>
);

/** A wallet, for the "the fee just comes to me" option. */
export const WalletLogo = ({ s = 20 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H17a2 2 0 0 1 2 2v1h1.2c.99 0 1.8.81 1.8 1.8v6.4c0 .99-.81 1.8-1.8 1.8H19v.5a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 18V7.5Zm2 .5V18c0 .28.22.5.5.5H17v-.5h-3.2a1.8 1.8 0 0 1-1.8-1.8V9.8c0-.99.81-1.8 1.8-1.8H17V7H5.5a.5.5 0 0 0-.5.5V8Zm9 2v5h6v-5h-6Zm1.5 3.75a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z" />
  </svg>
);

export const LOGOS: Record<string, (p: { s?: number }) => React.ReactElement> = {
  x: XLogo,
  github: GhLogo,
  discord: DcLogo,
};
