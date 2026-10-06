"use client";

import { useEffect, useRef, useState } from "react";
import type { PhotoSummary } from "@/core/types";
import { labelSwatch } from "./colors";
import { imageUrl } from "./ContactSheet";

function formatCoordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`;
}

/** The larger compressed image with everything known about it. Esc or a backdrop click closes it. */
export function PhotoDialog({
  photo,
  color,
  onClose,
  onDelete,
}: {
  photo: PhotoSummary | null;
  /** The photo's dominant color, used as the backdrop behind the image. */
  color?: string;
  onClose: () => void;
  /** Deletes the photo; rejects with an Error whose message is shown to the user. */
  onDelete: (id: number) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Deleting takes two clicks: "Delete photo", then "Delete permanently".
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Opening another photo starts from a clean state.
  useEffect(() => {
    setConfirming(false);
    setDeleting(false);
    setDeleteError(null);
  }, [photo?.id]);

  async function confirmDelete(id: number) {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(id);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
      setDeleting(false);
    }
  }

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (photo && !dialog.open) dialog.showModal();
    if (!photo && dialog.open) dialog.close();
  }, [photo]);

  const taken = photo ? new Date(photo.takenAt) : null;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()} // click on the backdrop
      className="m-auto max-h-[92vh] w-[min(68rem,94vw)] overflow-hidden rounded-3xl bg-surface p-0 text-ink"
      aria-label={photo ? `Photo ${photo.id}` : undefined}
    >
      {photo && taken && (
        <div className="grid max-h-[92vh] md:grid-cols-[1fr_20rem]">
          <div className="flex min-h-0 items-center justify-center p-3" style={{ backgroundColor: color ?? "var(--grape-tint)" }}>
            <img src={imageUrl(photo.imagePath)} alt={photo.caption} className="max-h-[58vh] w-auto rounded-2xl object-contain md:max-h-[calc(92vh-1.5rem)]" />
          </div>
          <div className="flex flex-col gap-5 overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm text-muted">
                Photo <span className="rounded-full bg-ink px-2 py-px font-bold text-surface tabular-nums">{photo.id}</span>
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-bg px-3 py-1 text-sm font-semibold text-muted hover:text-ink"
                aria-label="Close"
              >
                Close
              </button>
            </div>

            <p className="text-xl font-semibold leading-snug">{photo.caption}</p>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Taken</dt>
              <dd>
                {taken.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })},{" "}
                {taken.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </dd>

              <dt className="text-muted">Place</dt>
              <dd>
                {photo.lat !== null && photo.lon !== null ? (
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${photo.lat}&mlon=${photo.lon}#map=15/${photo.lat}/${photo.lon}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-grape underline decoration-grape/30 underline-offset-2 hover:decoration-grape"
                  >
                    {formatCoordinate(photo.lat, "N", "S")}, {formatCoordinate(photo.lon, "E", "W")}
                  </a>
                ) : (
                  <span className="text-muted">No location saved in this photo</span>
                )}
              </dd>

              <dt className="text-muted">Mood</dt>
              <dd>{photo.mood}</dd>

              <dt className="text-muted">File</dt>
              <dd className="break-all">{photo.filename}</dd>
            </dl>

            <ul className="flex flex-wrap gap-1.5" aria-label="Labels">
              {photo.labels.map((label) => {
                const swatch = labelSwatch(label);
                return (
                  <li
                    key={label}
                    className="rounded-full px-3 py-1 text-sm font-semibold"
                    style={{ backgroundColor: swatch.tint, color: swatch.text }}
                  >
                    {label}
                  </li>
                );
              })}
            </ul>

            <div className="mt-auto border-t border-line pt-4">
              {!confirming ? (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="rounded-full px-3 py-1.5 text-sm font-semibold text-coral hover:bg-[#ffe4e8]"
                >
                  Delete photo
                </button>
              ) : (
                <div className="space-y-3 rounded-2xl bg-[#ffe4e8] p-4 text-sm">
                  <p className="text-ink">
                    Delete this photo from your library? Its caption and search entry go too, and it leaves any albums
                    it&apos;s in. The original file on your computer isn&apos;t touched.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => void confirmDelete(photo.id)}
                      className="rounded-full bg-coral px-4 py-2 font-bold text-white hover:brightness-110 disabled:opacity-60"
                    >
                      {deleting ? "Deleting…" : "Delete permanently"}
                    </button>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => setConfirming(false)}
                      className="rounded-full bg-surface px-4 py-2 font-semibold text-ink hover:brightness-95"
                    >
                      Keep photo
                    </button>
                  </div>
                  {deleteError && (
                    <p role="alert" className="font-semibold text-coral">
                      {deleteError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
