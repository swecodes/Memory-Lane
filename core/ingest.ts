// ingestPhoto(path): hash -> compress -> EXIF -> caption -> embed -> insert.
// Logs go to stderr (console.error) so this is safe to call from the MCP
// server, where stdout is reserved for the protocol.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import sharp from "sharp";
import { captionImage, embedText } from "./ai";
import { insertPhoto, photoExistsByHash, resolveDataPath } from "./db";
import type { Caption } from "./types";

export type IngestResult =
  | { status: "added"; id: number; filename: string }
  | { status: "skipped"; filename: string }; // already in the library

const IMAGE_MAX_PX = 1600;
const THUMB_MAX_PX = 320;

// ---------- pipeline steps (exported so they can be tested on their own) ----------

export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Compressed copy (max 1600px) and thumbnail (max 320px), both JPEG, upright. */
export async function prepareImages(original: Buffer): Promise<{ image: Buffer; thumb: Buffer }> {
  try {
    // .rotate() with no argument applies the EXIF orientation, so phone photos
    // taken sideways come out upright. (The EXIF block itself is dropped.)
    const base = sharp(original).rotate();
    const [image, thumb] = await Promise.all([
      base
        .clone()
        .resize(IMAGE_MAX_PX, IMAGE_MAX_PX, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer(),
      base
        .clone()
        .resize(THUMB_MAX_PX, THUMB_MAX_PX, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer(),
    ]);
    return { image, thumb };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // sharp's prebuilt binaries can't decode HEVC-encoded HEIC (licensing), which
    // is the default iPhone format. Say so plainly instead of a libvips error.
    if (/heif|heic/i.test(message)) {
      throw new Error("HEIC photos aren't supported; export them as JPEG first");
    }
    throw new Error(`Not a readable image (${message})`);
  }
}

export interface PhotoExif {
  takenAt: Date | null;
  lat: number | null;
  lon: number | null;
}

/** Date taken and GPS position, if the file has them. Never throws. */
export async function readExif(original: Buffer): Promise<PhotoExif> {
  try {
    const data = (await exifr.parse(original, { gps: true })) as
      | { DateTimeOriginal?: unknown; CreateDate?: unknown; latitude?: unknown; longitude?: unknown }
      | undefined;
    const date = data?.DateTimeOriginal ?? data?.CreateDate;
    const takenAt = date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    const lat = typeof data?.latitude === "number" && Number.isFinite(data.latitude) ? data.latitude : null;
    const lon = typeof data?.longitude === "number" && Number.isFinite(data.longitude) ? data.longitude : null;
    return { takenAt, lat, lon };
  } catch {
    return { takenAt: null, lat: null, lon: null }; // no or broken EXIF is normal (screenshots, PNGs)
  }
}

export function buildEmbeddingText(caption: Caption, takenAt: string): string {
  const sentence = caption.caption.replace(/[.!?\s]+$/, ""); // the template adds its own period
  return `${sentence}. Labels: ${caption.labels.join(", ")}. Mood: ${caption.mood}. Taken: ${takenAt.slice(0, 10)}.`;
}

// ---------- the full pipeline ----------

// Every line is prefixed with the filename: with two photos in flight at once,
// unprefixed lines from different photos would interleave unreadably.
function log(filename: string, message: string): void {
  console.error(`  [${filename}] ${message}`);
}

async function timed<T>(filename: string, label: string, step: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await step();
  log(filename, `${label} ${Math.round(performance.now() - start)}ms`);
  return result;
}

export interface IngestOptions {
  /** Name to store (uploads arrive as temp files with meaningless names). */
  filename?: string;
  /** Date to use when the file has no EXIF date; defaults to the file's mtime. */
  fallbackTakenAt?: Date;
}

export async function ingestPhoto(filePath: string, options: IngestOptions = {}): Promise<IngestResult> {
  const filename = options.filename ?? path.basename(filePath);
  const original = await fs.readFile(filePath);
  const fileHash = hashBuffer(original);
  if (photoExistsByHash(fileHash)) {
    log(filename, "already in library, skipped");
    return { status: "skipped", filename };
  }

  const { image, thumb } = await timed(filename, "compress", () => prepareImages(original));
  const exif = await timed(filename, "exif", () => readExif(original));
  // EXIF has no date for screenshots, downloads, etc.: fall back to the caller's date or the file's mtime.
  const takenAt = (exif.takenAt ?? options.fallbackTakenAt ?? (await fs.stat(filePath)).mtime).toISOString();

  const caption = await timed(filename, "caption", () => captionImage(image));
  const embedding = await timed(filename, "embed", () => embedText(buildEmbeddingText(caption, takenAt)));

  // Files are written only now, after every step that can fail, so a failed
  // photo leaves nothing behind. Names come from the hash, so they never clash.
  const imagePath = `images/${fileHash.slice(0, 16)}.jpg`;
  const thumbPath = `thumbs/${fileHash.slice(0, 16)}.jpg`;
  await fs.mkdir(resolveDataPath("images"), { recursive: true });
  await fs.mkdir(resolveDataPath("thumbs"), { recursive: true });
  await fs.writeFile(resolveDataPath(imagePath), image);
  await fs.writeFile(resolveDataPath(thumbPath), thumb);

  const id = insertPhoto({
    fileHash,
    filename,
    imagePath,
    thumbPath,
    takenAt,
    lat: exif.lat,
    lon: exif.lon,
    caption: caption.caption,
    labels: caption.labels,
    mood: caption.mood,
    embedding,
  });
  log(filename, `saved as photo ${id}`);
  return { status: "added", id, filename };
}
