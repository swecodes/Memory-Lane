import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { NewPhoto, Photo, PhotoRow, PhotoSummary } from "./types";

// ---------- paths ----------

/** Absolute path of the data directory (photos.db, images/, thumbs/). */
export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR ?? "./data");
}

/** Turn a path stored in the DB (relative to DATA_DIR) into an absolute one. */
export function resolveDataPath(relativePath: string): string {
  return path.join(dataDir(), relativePath);
}

// ---------- connection ----------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_hash   TEXT    NOT NULL UNIQUE,
  filename    TEXT    NOT NULL,
  image_path  TEXT    NOT NULL,
  thumb_path  TEXT    NOT NULL,
  taken_at    TEXT    NOT NULL,
  lat         REAL,
  lon         REAL,
  caption     TEXT    NOT NULL,
  labels      TEXT    NOT NULL DEFAULT '[]',
  mood        TEXT    NOT NULL,
  embedding   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_photos_taken_at ON photos(taken_at);

CREATE TABLE IF NOT EXISTS albums (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS album_photos (
  album_id    INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  photo_id    INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  PRIMARY KEY (album_id, photo_id)
);

-- One row per paid-API request, used by core/ratelimit.ts to stay inside the
-- free tier. Shared by every process (seed script, web app, MCP server).
CREATE TABLE IF NOT EXISTS ai_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,  -- unix epoch milliseconds
  model       TEXT    NOT NULL,
  tokens      INTEGER NOT NULL   -- estimate at reservation, actual once known
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_model_at ON ai_usage(model, at);
`;

// Next.js dev mode re-evaluates modules on hot reload; caching the connection
// on globalThis keeps us at one connection per process instead of leaking them.
const globalForDb = globalThis as unknown as { photoDb?: Database.Database };

/** The single shared connection. Creates the data dir and schema on first use. */
export function getDb(): Database.Database {
  if (globalForDb.photoDb) return globalForDb.photoDb;

  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(path.join(dir, "photos.db"));
  db.pragma("journal_mode = WAL"); // web app and MCP server can read/write concurrently
  db.pragma("foreign_keys = ON"); // off by default in SQLite; needed for ON DELETE CASCADE
  db.exec(SCHEMA);

  globalForDb.photoDb = db;
  return db;
}

// ---------- row mapping ----------

function toPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    fileHash: row.file_hash,
    filename: row.filename,
    imagePath: row.image_path,
    thumbPath: row.thumb_path,
    takenAt: row.taken_at,
    lat: row.lat,
    lon: row.lon,
    caption: row.caption,
    labels: JSON.parse(row.labels) as string[],
    mood: row.mood,
    embedding: JSON.parse(row.embedding) as number[],
    createdAt: row.created_at,
  };
}

// ---------- photo queries ----------

export function photoExistsByHash(fileHash: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM photos WHERE file_hash = ?")
    .get(fileHash);
  return row !== undefined;
}

/** Inserts a photo and returns its new id. */
export function insertPhoto(photo: NewPhoto): number {
  const result = getDb()
    .prepare(
      `INSERT INTO photos
         (file_hash, filename, image_path, thumb_path, taken_at, lat, lon,
          caption, labels, mood, embedding)
       VALUES
         (@fileHash, @filename, @imagePath, @thumbPath, @takenAt, @lat, @lon,
          @caption, @labels, @mood, @embedding)`,
    )
    .run({
      ...photo,
      labels: JSON.stringify(photo.labels),
      embedding: JSON.stringify(photo.embedding),
    });
  return Number(result.lastInsertRowid);
}

export function getPhoto(id: number): Photo | null {
  const row = getDb().prepare("SELECT * FROM photos WHERE id = ?").get(id) as
    | PhotoRow
    | undefined;
  return row ? toPhoto(row) : null;
}

/** All photos, newest first. */
export function listPhotos(): Photo[] {
  const rows = getDb()
    .prepare("SELECT * FROM photos ORDER BY taken_at DESC, id DESC")
    .all() as PhotoRow[];
  return rows.map(toPhoto);
}

export function countPhotos(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM photos").get() as {
    n: number;
  };
  return row.n;
}

/** Every photo without its embedding (much smaller), newest first. For the gallery. */
export function listPhotoSummaries(): PhotoSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT id, filename, image_path, thumb_path, taken_at, lat, lon, caption, labels, mood, created_at
       FROM photos ORDER BY taken_at DESC, id DESC`,
    )
    .all() as Omit<PhotoRow, "embedding" | "file_hash">[];
  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    imagePath: row.image_path,
    thumbPath: row.thumb_path,
    takenAt: row.taken_at,
    lat: row.lat,
    lon: row.lon,
    caption: row.caption,
    labels: JSON.parse(row.labels) as string[],
    mood: row.mood,
    createdAt: row.created_at,
  }));
}

export interface PhotoFilters {
  /** Inclusive, "YYYY-MM-DD" (or any ISO string; only the date part is used). */
  dateFrom?: string;
  /** Inclusive, "YYYY-MM-DD". */
  dateTo?: string;
  /** Exact label match, case-insensitive. */
  label?: string;
}

/** Photos matching the metadata filters, with embeddings, for vector ranking. */
export function listPhotosForSearch(filters: PhotoFilters): Photo[] {
  const where: string[] = [];
  const params: string[] = [];
  // taken_at is an ISO string, so comparing its first 10 characters compares dates.
  if (filters.dateFrom) {
    where.push("substr(taken_at, 1, 10) >= ?");
    params.push(filters.dateFrom.slice(0, 10));
  }
  if (filters.dateTo) {
    where.push("substr(taken_at, 1, 10) <= ?");
    params.push(filters.dateTo.slice(0, 10));
  }
  if (filters.label) {
    // labels is a JSON array; json_each turns it into rows we can match against.
    where.push("EXISTS (SELECT 1 FROM json_each(photos.labels) WHERE value = ?)");
    params.push(filters.label.trim().toLowerCase());
  }
  const sql = `SELECT * FROM photos ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;
  return (getDb().prepare(sql).all(...params) as PhotoRow[]).map(toPhoto);
}

// ---------- labels ----------

/** All labels with how many photos carry each, most common first. */
export function listLabels(): { label: string; count: number }[] {
  return getDb()
    .prepare(
      `SELECT value AS label, COUNT(*) AS count
       FROM photos, json_each(photos.labels)
       GROUP BY value ORDER BY count DESC, label ASC`,
    )
    .all() as { label: string; count: number }[];
}

/** Replace a photo's labels and embedding together (they must stay in sync). */
export function updateLabels(id: number, labels: string[], embedding: number[]): void {
  getDb()
    .prepare("UPDATE photos SET labels = ?, embedding = ? WHERE id = ?")
    .run(JSON.stringify(labels), JSON.stringify(embedding), id);
}

// ---------- albums ----------

export interface Album {
  id: number;
  name: string;
  createdAt: string;
  photoCount: number;
}

/** Ids from the list that exist in the library. */
export function existingPhotoIds(ids: number[]): number[] {
  if (ids.length === 0) return [];
  const rows = getDb()
    .prepare(`SELECT id FROM photos WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as { id: number }[];
  return rows.map((r) => r.id);
}

/** Creates an album holding the given (existing) photo ids; returns the album id. */
export function createAlbum(name: string, photoIds: number[]): number {
  const db = getDb();
  return db.transaction(() => {
    const albumId = Number(db.prepare("INSERT INTO albums (name) VALUES (?)").run(name).lastInsertRowid);
    const link = db.prepare("INSERT OR IGNORE INTO album_photos (album_id, photo_id) VALUES (?, ?)");
    for (const photoId of photoIds) link.run(albumId, photoId);
    return albumId;
  })();
}

export function listAlbums(): Album[] {
  return getDb()
    .prepare(
      `SELECT a.id, a.name, a.created_at AS createdAt, COUNT(ap.photo_id) AS photoCount
       FROM albums a LEFT JOIN album_photos ap ON ap.album_id = a.id
       GROUP BY a.id ORDER BY a.created_at DESC, a.id DESC`,
    )
    .all() as Album[];
}

/**
 * Delete a photo row (album links go with it via ON DELETE CASCADE).
 * Returns the deleted photo's file paths so the caller can remove the files,
 * or null if there was no such photo.
 */
export function deletePhoto(id: number): { imagePath: string; thumbPath: string } | null {
  const row = getDb()
    .prepare("DELETE FROM photos WHERE id = ? RETURNING image_path, thumb_path")
    .get(id) as { image_path: string; thumb_path: string } | undefined;
  return row ? { imagePath: row.image_path, thumbPath: row.thumb_path } : null;
}
