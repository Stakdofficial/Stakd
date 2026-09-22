"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Keep the encoded logo comfortably under StakdMetadata's MAX_IMAGE (16,000 bytes). */
const MAX_CHARS = 12_000;
const SIZES = [128, 112, 96, 72, 56];
const QUALITIES = [0.85, 0.7, 0.55, 0.42, 0.3];

/** Draw the image centre-cropped to a square of `size`, then encode. */
function encode(bitmap: ImageBitmap, size: number, type: string, quality: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL(type, quality);
}

/**
 * Decode any image the browser can display. `createImageBitmap` rejects some formats a page can still show (SVG in
 * particular), so fall back to loading it through an <img> first.
 */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return await createImageBitmap(img, { resizeWidth: 256, resizeHeight: 256, resizeQuality: "high" });
    } catch {
      throw new Error("That image format can't be used. Try a PNG, JPG or WebP.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Shrink a picked image until its data URI fits on-chain.
 * WebP where the browser supports it, JPEG otherwise; a square crop either way.
 */
async function toDataUri(file: File): Promise<string> {
  const bitmap = await decode(file);
  try {
    const webpWorks = encode(bitmap, 8, "image/webp", 0.5).startsWith("data:image/webp");
    const type = webpWorks ? "image/webp" : "image/jpeg";
    for (const size of SIZES) {
      for (const quality of QUALITIES) {
        const uri = encode(bitmap, size, type, quality);
        if (uri && uri.length <= MAX_CHARS) return uri;
      }
    }
    throw new Error("Could not compress that image small enough — try a simpler one.");
  } finally {
    bitmap.close();
  }
}

/** A link that points at an image, as opposed to a profile or website link. */
const IMAGE_LINK = /^(data:image\/|ipfs:\/\/|https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|svg)(\?\S*)?$)/i;

/** True while the user is typing somewhere else on the page: their paste belongs to that field, not the logo. */
function isEditable(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

export function ImagePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError("That file is not an image.");
        return;
      }
      setError(null);
      setBusy(true);
      try {
        onChange(await toDataUri(file));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  // A pasted image link is downloaded and stored like an upload, so the logo can't break if that host goes away.
  // Hosts that refuse to share the file keep the link as-is; the preview then reports if it can't be shown.
  const acceptLink = useCallback(
    async (link: string) => {
      setError(null);
      if (/^https?:\/\//i.test(link)) {
        setBusy(true);
        try {
          const res = await fetch(link);
          const blob = await res.blob();
          if (res.ok && blob.type.startsWith("image/")) {
            await accept(new File([blob], "logo", { type: blob.type }));
            return;
          }
        } catch {
          // fall through to keeping the link
        } finally {
          setBusy(false);
        }
      }
      onChange(link);
    },
    [accept, onChange],
  );

  // Cmd/Ctrl+V drops an image straight in, unless the user is typing in another field (the X, website or
  // description boxes), where the paste belongs to that field.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData;
      if (!data) return;
      const file = Array.from(data.files).find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        void accept(file);
        return;
      }
      if (isEditable(e.target)) return;
      const text = data.getData("text").trim();
      if (IMAGE_LINK.test(text)) {
        e.preventDefault();
        void acceptLink(text);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [accept, acceptLink]);

  return (
    <div>
      <div
        ref={zoneRef}
        className="image-drop"
        data-over={over || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void accept(e.dataTransfer.files?.[0]);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            className="image-drop-preview"
            onError={() => {
              onChange("");
              setError("That image couldn't be loaded. Upload the file itself, or paste a different image.");
            }}
          />
        ) : (
          <div className="image-drop-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </div>
        )}
        <div className="image-drop-text">
          <strong>{busy ? "Processing…" : value ? "Logo added" : "Drop an image, paste, or click to choose"}</strong>
          <span className="muted small">
            {value ? "Click to replace · stored on-chain with your coin" : "PNG, JPG, GIF or WebP — squared and shrunk automatically"}
          </span>
        </div>
        {value && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
              setError(null);
            }}
          >
            Remove
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void accept(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && <div className="alert alert-error small" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
