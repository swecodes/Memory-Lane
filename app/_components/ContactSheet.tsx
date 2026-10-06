"use client";

import type { PhotoSummary } from "@/core/types";
import { labelSwatch } from "./colors";
import { PencilMark } from "./PencilMark";

export const imageUrl = (relativePath: string) => `/api/image/${relativePath}`;

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

interface ContactSheetProps {
  photos: PhotoSummary[];
  /** Each photo's dominant color; frames use it as their mat. */
  colors: Map<number, string>;
  /** Photos cited by the latest chat answer; they get a hand-drawn circle. */
  citedIds: Set<number>;
  /** Bumped on every new answer so the circles redraw. */
  citationRound: number;
  /** Photo whose citation is being hovered in the chat. */
  highlightId: number | null;
  onOpen: (id: number) => void;
}

export function ContactSheet({ photos, colors, citedIds, citationRound, highlightId, onOpen }: ContactSheetProps) {
  return (
    <ol className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-4 gap-y-6 px-4 pb-10 sm:px-6">
      {photos.map((photo) => {
        const cited = citedIds.has(photo.id);
        const color = colors.get(photo.id) ?? "var(--line)";
        return (
          <li key={photo.id} id={`frame-${photo.id}`}>
            <div className="relative">
              <button
                type="button"
                onClick={() => onOpen(photo.id)}
                style={{ backgroundColor: color }}
                className={`group relative block w-full rounded-2xl p-1.5 transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none ${
                  highlightId === photo.id ? "-translate-y-1 ring-4 ring-ink/80" : ""
                }`}
                aria-label={`Photo ${photo.id}: ${photo.caption}`}
              >
                <span className="relative block aspect-square overflow-hidden rounded-xl bg-surface">
                  <img src={imageUrl(photo.thumbPath)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  {/* Caption on hover/focus; on touch screens a tap opens the full view instead. */}
                  <span className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/80 via-black/55 to-transparent p-2.5 pt-8 text-left text-[0.8rem] leading-snug text-white opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:transition-none">
                    <span className="line-clamp-3">{photo.caption}</span>
                  </span>
                </span>
              </button>
              {cited && <PencilMark key={citationRound} seed={photo.id} />}
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 px-0.5 text-[0.75rem] text-muted tabular-nums">
              <span
                className={`rounded-full px-2 py-px font-bold ${cited ? "bg-ink text-surface" : "bg-surface text-ink"}`}
                title="Photo number (the chat cites photos by this number)"
              >
                {photo.id}
              </span>
              <span>{formatDay(photo.takenAt)}</span>
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Labels">
              {photo.labels.slice(0, 3).map((label) => {
                const swatch = labelSwatch(label);
                return (
                  <li
                    key={label}
                    className="rounded-full px-2 py-0.5 text-[0.7rem] font-semibold"
                    style={{ backgroundColor: swatch.tint, color: swatch.text }}
                  >
                    {label}
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
