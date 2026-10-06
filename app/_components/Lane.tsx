"use client";

import type { PhotoSummary } from "@/core/types";
import { formatDay } from "./ContactSheet";

function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * The "memory lane": every photo as a stripe of its own color, oldest to
 * newest. Stripes for cited photos are marked; any stripe opens its photo.
 */
export function Lane({
  photos,
  colors,
  citedIds,
  onOpen,
}: {
  photos: PhotoSummary[];
  colors: Map<number, string>;
  citedIds: Set<number>;
  onOpen: (id: number) => void;
}) {
  if (photos.length === 0) return null;
  const chronological = [...photos].sort((a, b) => a.takenAt.localeCompare(b.takenAt) || a.id - b.id);
  const first = chronological[0].takenAt;
  const last = chronological[chronological.length - 1].takenAt;
  const sameMonth = formatMonth(first) === formatMonth(last);

  return (
    <div className="px-4 pb-6 sm:px-6">
      <div className="flex h-5 overflow-hidden rounded-full bg-surface shadow-[inset_0_0_0_1px_var(--line)]" role="list" aria-label="Your photos in date order">
        {chronological.map((photo) => (
          <button
            key={photo.id}
            type="button"
            role="listitem"
            onClick={() => onOpen(photo.id)}
            title={`Photo ${photo.id}, ${formatDay(photo.takenAt)}`}
            aria-label={`Photo ${photo.id}, ${formatDay(photo.takenAt)}`}
            className={`min-w-1 flex-1 transition-[flex-grow] duration-300 hover:grow-[3] motion-reduce:transition-none ${
              citedIds.has(photo.id) ? "grow-[3] shadow-[inset_0_0_0_3px_var(--ink)]" : ""
            }`}
            style={{ backgroundColor: colors.get(photo.id) ?? "var(--line)" }}
          />
        ))}
      </div>
      <p className="mt-2 text-sm text-muted">
        {sameMonth ? `All from ${formatMonth(first)}` : `From ${formatMonth(first)} to ${formatMonth(last)}`}
      </p>
    </div>
  );
}
