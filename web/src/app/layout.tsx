import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import { XLink } from "@/components/XLink";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";
import "./stakd.css";
import "./home.css";

const SITE = "https://www.stakd.tech";
const DESCRIPTION =
  "Launch a coin with its own leveraged portfolio on Robinhood Chain. Trading fees in ETH fund stock and crypto positions on Lighter; profits buy back and burn the coin.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Stakd", template: "%s · Stakd" },
  description: DESCRIPTION,
  openGraph: { title: "Stakd — coins with a leveraged portfolio", description: DESCRIPTION, url: SITE, siteName: "Stakd", type: "website" },
  twitter: { card: "summary_large_image", site: "@StakdOfficial", creator: "@StakdOfficial", title: "Stakd — coins with a leveraged portfolio", description: DESCRIPTION },
  alternates: { canonical: SITE },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700;900&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap"
        />
      </head>
      <body>
        <Providers>
          <Header />
          <main className="container main">{children}</main>
          <footer className="container footer">
            <div className="spread" style={{ flexWrap: "wrap" }}>
              <span>Stakd · live on Robinhood Chain mainnet · portfolios trade on Lighter</span>
              <span className="footer-links">
                <a href="/docs" style={{ color: "var(--blue-600)", fontWeight: 600 }}>Docs</a>
                <a href="/whitepaper" style={{ color: "var(--blue-600)", fontWeight: 600 }}>Whitepaper</a>
                <XLink label />
              </span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
