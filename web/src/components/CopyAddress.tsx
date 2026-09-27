"use client";

import { useEffect, useState } from "react";

/**
 * The contract address, shortened, with one click to copy the whole thing. People ask for the CA constantly and
 * selecting it by hand on a phone is painful, so the text itself is the button; the explorer link sits beside it.
 */
export function CopyAddress({ address, label = "Copy address" }: { address: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // Clipboard is blocked without https or permission: fall back to a hidden selection.
      const field = document.createElement("textarea");
      field.value = address;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      try {
        document.execCommand("copy");
      } catch {
        return;
      } finally {
        field.remove();
      }
    }
    setCopied(true);
  }

  return (
    <button type="button" onClick={copy} className="copy-addr mono" title={copied ? "Copied" : label} aria-label={label}>
      <span>
        {address.slice(0, 6)}…{address.slice(-4)}
      </span>
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10.5 3.5h-6a2 2 0 0 0-2 2v6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
      <span className="copy-addr-said" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
