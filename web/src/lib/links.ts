/**
 * Turn what a creator typed into a safe link, or nothing. People often type `x.com/name`, `stakd.tech` or
 * `@name` instead of a full URL, so those are completed; anything that isn't a plain web address is dropped
 * (never `javascript:` or other schemes).
 */
export function profileLink(raw: string | undefined, kind: "x" | "telegram" | "website"): string | undefined {
  const v = (raw ?? "").trim();
  if (!v) return undefined;
  if (/^https?:\/\/[^\s]+$/i.test(v)) return v;
  const handle = v.match(/^@?([A-Za-z0-9_]{1,32})$/);
  if (handle && kind !== "website") return kind === "x" ? `https://x.com/${handle[1]}` : `https://t.me/${handle[1]}`;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(v)) return `https://${v}`;
  return undefined;
}

/** The @handle behind a coin's X link (`x.com/name`, `https://twitter.com/name`, `@name`), or nothing. */
export function xHandle(raw: string | undefined): string | undefined {
  const link = profileLink(raw, "x");
  const m = link?.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
  if (!m || /^(home|intent|search|i|share)$/i.test(m[1])) return undefined;
  return m[1];
}
