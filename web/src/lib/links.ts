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
