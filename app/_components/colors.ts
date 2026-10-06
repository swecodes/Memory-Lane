"use client";

// Color helpers: a fixed bright palette for labels, and each photo's own
// dominant color (read from its thumbnail in the browser) for frames and the lane.

import { useEffect, useRef, useState } from "react";
import type { PhotoSummary } from "@/core/types";

export interface Swatch {
  solid: string; // fills and borders
  tint: string; // chip backgrounds
  text: string; // text on the tint (meets WCAG AA contrast)
}

export const PALETTE: Swatch[] = [
  { solid: "#7c3aed", tint: "#efe7ff", text: "#5b21b6" }, // grape
  { solid: "#f43f5e", tint: "#ffe4e8", text: "#be123c" }, // coral
  { solid: "#f59e0b", tint: "#fff1d6", text: "#9a4a06" }, // sun
  { solid: "#10b981", tint: "#d9f8ec", text: "#04694f" }, // mint
  { solid: "#0ea5e9", tint: "#dcf2fd", text: "#035e8a" }, // sky
];

/** The same label always gets the same color. */
export function labelSwatch(label: string): Swatch {
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

/**
 * Turn a photo's average color into a lively one: averages are usually muddy,
 * so saturation is boosted and lightness kept mid-range. Near-grey photos have
 * no meaningful hue, so they borrow a palette color instead.
 */
function vivid(r: number, g: number, b: number, fallbackIndex: number): string {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.08) return PALETTE[fallbackIndex % PALETTE.length].solid;

  let h: number;
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = Math.round(h * 60 + 360) % 360;

  const sat = Math.min(0.85, Math.max(0.5, s * 1.5));
  const light = Math.min(0.62, Math.max(0.48, l));
  return `hsl(${h} ${Math.round(sat * 100)}% ${Math.round(light * 100)}%)`;
}

/**
 * Dominant color per photo id. Thumbnails are same-origin, so the canvas can
 * read their pixels. Results are batched into one state update per frame.
 */
export function usePhotoColors(photos: PhotoSummary[] | null, thumbUrl: (path: string) => string) {
  const [colors, setColors] = useState<Map<number, string>>(new Map());
  const started = useRef(new Set<number>());

  useEffect(() => {
    if (!photos) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let pending = new Map<number, string>();
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = pending;
      pending = new Map();
      setColors((prev) => new Map([...prev, ...batch]));
    };

    for (const photo of photos) {
      if (started.current.has(photo.id)) continue;
      started.current.add(photo.id);
      const img = new Image();
      img.onload = () => {
        // Average a 16x16 downscale (drawing straight to 1x1 samples, not averages).
        ctx.drawImage(img, 0, 0, 16, 16);
        const data = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
        const n = data.length / 4;
        pending.set(photo.id, vivid(r / n, g / n, b / n, photo.id));
        frame ||= requestAnimationFrame(flush);
      };
      img.src = thumbUrl(photo.thumbPath);
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [photos, thumbUrl]);

  return colors;
}
