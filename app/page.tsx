"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { PhotoSummary } from "@/core/types";
import { ChatPanel } from "./_components/ChatPanel";
import { usePhotoColors } from "./_components/colors";
import { ContactSheet, imageUrl } from "./_components/ContactSheet";
import { Lane } from "./_components/Lane";
import { PhotoDialog } from "./_components/PhotoDialog";

interface UploadState {
  total: number;
  done: number;
  current: string | null;
  added: number;
  skipped: number;
  failed: { name: string; reason: string }[];
  stoppedReason: string | null;
}

type IngestReply =
  | { status: "added"; photo: PhotoSummary }
  | { status: "skipped"; filename: string }
  | { error: string; dailyLimit?: boolean };

export default function Home() {
  const [photos, setPhotos] = useState<PhotoSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [cited, setCited] = useState<Set<number>>(new Set());
  const [citationRound, setCitationRound] = useState(0);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadPhotos = useCallback(async () => {
    try {
      const response = await fetch("/api/photos");
      if (!response.ok) throw new Error(`The server answered with ${response.status}`);
      setPhotos(((await response.json()) as { photos: PhotoSummary[] }).photos);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void loadPhotos();
  }, [loadPhotos]);

  const colors = usePhotoColors(photos, imageUrl);
  const photosById = useMemo(() => new Map((photos ?? []).map((p) => [p.id, p])), [photos]);

  async function addPhotos(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (images.length === 0 || upload?.current) return;
    const state: UploadState = { total: images.length, done: 0, current: null, added: 0, skipped: 0, failed: [], stoppedReason: null };

    // One file per request, in order, so progress is honest and the free-tier
    // limiter on the server paces the captions.
    for (const file of images) {
      setUpload({ ...state, current: file.name });
      const form = new FormData();
      form.append("file", file);
      form.append("lastModified", String(file.lastModified));
      try {
        const response = await fetch("/api/ingest", { method: "POST", body: form });
        const reply = (await response.json()) as IngestReply;
        if ("status" in reply && reply.status === "added") state.added++;
        else if ("status" in reply) state.skipped++;
        else if (reply.dailyLimit) {
          state.stoppedReason = reply.error;
          break;
        } else state.failed.push({ name: file.name, reason: reply.error });
      } catch (error) {
        state.failed.push({ name: file.name, reason: error instanceof Error ? error.message : String(error) });
      }
      state.done++;
    }
    setUpload({ ...state, current: null });
    await loadPhotos();
  }

  async function deletePhoto(id: number) {
    const response = await fetch(`/api/photos/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Couldn't delete the photo (server answered ${response.status})`);
    }
    setOpenId(null);
    setCited((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await loadPhotos();
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void addPhotos([...event.dataTransfer.files]);
  }

  const uploading = Boolean(upload?.current);

  return (
    <div
      className="min-h-screen lg:grid lg:grid-cols-[1fr_26rem]"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <main className="min-w-0">
        <header className="flex flex-wrap items-end justify-between gap-4 px-4 pb-4 pt-8 sm:px-6">
          <div>
            <h1 className="text-5xl font-extrabold tracking-tight sm:text-6xl">Memory Lane</h1>
            <p className="mt-1 text-lg text-muted">
              {photos === null
                ? "Loading your library…"
                : `${photos.length} ${photos.length === 1 ? "photo" : "photos"}, searchable by what's in them`}
            </p>
          </div>
          <div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              className="sr-only"
              onChange={(e) => {
                void addPhotos([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
              className="rounded-full bg-grape px-5 py-3 text-sm font-bold text-white shadow-[0_6px_16px_-6px_var(--grape)] hover:brightness-110 disabled:opacity-50"
            >
              {uploading ? "Adding photos…" : "Add photos"}
            </button>
          </div>
        </header>

        {upload && (
          <section aria-live="polite" className="mx-4 mb-6 rounded-2xl bg-surface px-5 py-4 text-sm shadow-[0_0_0_1px_var(--line)] sm:mx-6">
            {upload.current ? (
              <>
                <p>
                  Adding photo {upload.done + 1} of {upload.total}: <span className="font-medium">{upload.current}</span>
                </p>
                <p className="mt-0.5 text-muted">Each photo takes up to 30 seconds while the free tier paces requests.</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-grape-tint">
                  <div className="h-full rounded-full bg-grape transition-[width]" style={{ width: `${(upload.done / upload.total) * 100}%` }} />
                </div>
              </>
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p>
                    Added {upload.added} of {upload.total}.
                    {upload.skipped > 0 && ` ${upload.skipped} already in your library.`}
                  </p>
                  {upload.failed.map((f) => (
                    <p key={f.name} className="text-coral">
                      {f.name}: {f.reason}
                    </p>
                  ))}
                  {upload.stoppedReason && <p className="text-coral">Stopped early. {upload.stoppedReason}</p>}
                </div>
                <button type="button" onClick={() => setUpload(null)} className="text-muted hover:text-ink">
                  Dismiss
                </button>
              </div>
            )}
          </section>
        )}

        {loadError ? (
          <div role="alert" className="mx-4 rounded-2xl bg-[#ffe4e8] px-5 py-4 text-coral sm:mx-6">
            Couldn&apos;t load your photos ({loadError}). Is the dev server running?{" "}
            <button type="button" onClick={() => void loadPhotos()} className="font-bold underline">
              Try again
            </button>
          </div>
        ) : photos && photos.length === 0 ? (
          <div className="mx-4 flex flex-col items-start gap-3 rounded-3xl border-2 border-dashed border-grape/30 bg-surface px-6 py-14 sm:mx-6">
            <h2 className="text-xl font-bold">No photos yet</h2>
            <p className="max-w-prose text-muted">
              Add a few photos and they&apos;ll be captioned and indexed so you can ask about them. You can also drop
              them anywhere on this page, or bulk-import a folder with <code>npm run seed -- ./folder</code>.
            </p>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="rounded-full bg-grape px-5 py-3 text-sm font-bold text-white hover:brightness-110"
            >
              Add photos
            </button>
          </div>
        ) : photos ? (
          <>
            <Lane photos={photos} colors={colors} citedIds={cited} onOpen={setOpenId} />
            <ContactSheet
              photos={photos}
              colors={colors}
              citedIds={cited}
              citationRound={citationRound}
              highlightId={highlightId}
              onOpen={setOpenId}
            />
          </>
        ) : null}
      </main>

      <ChatPanel
        photosById={photosById}
        colors={colors}
        onOpen={setOpenId}
        onCited={(ids) => {
          setCited(new Set(ids));
          setCitationRound((n) => n + 1);
          if (ids.length > 0) {
            const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            document
              .getElementById(`frame-${ids[0]}`)
              ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
          }
        }}
        onHoverCitation={setHighlightId}
      />

      <PhotoDialog
        photo={openId === null ? null : (photosById.get(openId) ?? null)}
        color={openId === null ? undefined : colors.get(openId)}
        onClose={() => setOpenId(null)}
        onDelete={deletePhoto}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center bg-grape/80 text-3xl font-extrabold text-white">
          Drop to add photos
        </div>
      )}
    </div>
  );
}
